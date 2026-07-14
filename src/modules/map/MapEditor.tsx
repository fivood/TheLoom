import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { fileToDataUrl } from './util';
import { useNav } from '../../search';
import type { MapDoc, MapMarker, MapRegion } from '../../types';
import { PALETTE } from '../../types';
import Icon from '../../components/Icon';

type Mode = 'view' | 'marker' | 'region';
type Selection =
  | { kind: 'marker'; id: string }
  | { kind: 'region'; id: string }
  | null;

/** 把归一化坐标 [0..1] 映射为 svg viewBox 内的像素(1000 单位) */
const S = 1000;

export default function MapEditor() {
  const project = useLoom((s) => s.project);
  const update = useLoom((s) => s.update);
  const maps = project.maps;
  const [activeId, setActiveId] = useState<string | null>(maps[0]?.id ?? null);
  const [pendingMarker, setPendingMarker] = useState<string | null>(null);
  const active = maps.find((m) => m.id === activeId) ?? null;

  // 消费搜索/反向引用跳转
  const navSeq = useNav((s) => s.seq);
  useEffect(() => {
    const t = useNav.getState().target;
    if (t?.tab === 'map' && t.mapId) {
      setActiveId(t.mapId);
      setPendingMarker(t.markerId ?? null);
      useNav.getState().clear();
    }
  }, [navSeq]);

  const addMap = () => {
    const id = uid();
    update((p) => { p.maps.push({ id, name: `新地图 ${p.maps.length + 1}`, markers: [], regions: [] }); });
    setActiveId(id);
  };
  const renameMap = (id: string, current: string) => {
    const name = prompt('地图名称', current);
    if (name) update((p) => { const m = p.maps.find((x) => x.id === id); if (m) m.name = name; });
  };
  const deleteMap = (id: string) => {
    if (!confirm('删除该地图及全部标记与区域?')) return;
    update((p) => { p.maps = p.maps.filter((x) => x.id !== id); });
    if (activeId === id) setActiveId(null);
  };

  return (
    <>
      <div className="side-list">
        <div className="side-head">
          <span>地图</span>
          <button className="ghost icon-btn" onClick={addMap} title="新建地图">＋</button>
        </div>
        <div className="items">
          {maps.map((m) => (
            <div
              key={m.id}
              className={`side-item ${activeId === m.id ? 'active' : ''}`}
              onClick={() => setActiveId(m.id)}
              onDoubleClick={() => renameMap(m.id, m.name)}
              title="双击重命名"
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              <button className="ghost icon-btn" onClick={(e) => { e.stopPropagation(); deleteMap(m.id); }} title="删除">×</button>
            </div>
          ))}
        </div>
      </div>

      {active ? (
        <MapCanvas key={active.id} map={active} initialMarker={pendingMarker} />
      ) : (
        <div className="pane-col">
          <div className="empty-hint" style={{ marginTop: 80 }}>
            还没有地图<br />点击左上角「＋」新建<br /><br />
            推荐流程:在 Inkarnate / Azgaar / Wonderdraft 里画完导出 PNG,<br />上传到这里作为底图,再叠加地点标记与阵营领地
          </div>
        </div>
      )}
    </>
  );
}

function MapCanvas({ map, initialMarker }: { map: MapDoc; initialMarker?: string | null }) {
  const project = useLoom((s) => s.project);
  const update = useLoom((s) => s.update);
  const entities = project.entities;
  const points = project.timelinePoints;

  const [mode, setMode] = useState<Mode>('view');
  const [selection, setSelection] = useState<Selection>(
    initialMarker ? { kind: 'marker', id: initialMarker } : null,
  );
  const [draftRegion, setDraftRegion] = useState<{ x: number; y: number }[]>([]);
  const [pointFilter, setPointFilter] = useState<string>('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [draggingVertex, setDraggingVertex] = useState<{ regionId: string; idx: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);

  const patch = (m: (m: MapDoc) => void) => update((p) => {
    const x = p.maps.find((y) => y.id === map.id);
    if (x) m(x);
  });

  const uploadImage = async (file: File) => {
    try {
      const { dataUrl, width, height } = await fileToDataUrl(file);
      patch((m) => { m.image = dataUrl; m.imageWidth = width; m.imageHeight = height; });
    } catch { alert('无法读取该图片'); }
  };

  const clientToNormalized = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const onCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // 只有点击 svg 空白处才触发新建;点击已有元素时事件被 stopPropagation 拦住
    const { x, y } = clientToNormalized(e.clientX, e.clientY);
    if (mode === 'marker') {
      const nm: MapMarker = { id: uid(), x, y, label: '' };
      patch((m) => { m.markers.push(nm); });
      setSelection({ kind: 'marker', id: nm.id });
      setMode('view');
    } else if (mode === 'region') {
      setDraftRegion((d) => [...d, { x, y }]);
    } else {
      setSelection(null);
    }
  };

  const finishRegion = () => {
    if (draftRegion.length < 3) { setDraftRegion([]); return; }
    const nr: MapRegion = { id: uid(), points: draftRegion, label: '', color: '#565550' };
    patch((m) => { m.regions.push(nr); });
    setDraftRegion([]);
    setSelection({ kind: 'region', id: nr.id });
    setMode('view');
  };

  // 拖拽已有标记
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const { x, y } = clientToNormalized(e.clientX, e.clientY);
      patch((m) => { const mk = m.markers.find((k) => k.id === dragging); if (mk) { mk.x = x; mk.y = y; } });
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  // 拖拽区域顶点
  useEffect(() => {
    if (!draggingVertex) return;
    const onMove = (e: MouseEvent) => {
      const { x, y } = clientToNormalized(e.clientX, e.clientY);
      patch((m) => {
        const r = m.regions.find((x) => x.id === draggingVertex.regionId);
        if (r && r.points[draggingVertex.idx]) { r.points[draggingVertex.idx] = { x, y }; }
      });
    };
    const onUp = () => setDraggingVertex(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingVertex]);

  // 时间线自动播放
  useEffect(() => {
    if (!playing || points.length === 0) return;
    let idx = pointFilter ? (points.findIndex((p) => p.id === pointFilter)) : -1;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      idx++;
      if (idx >= points.length) { setPlaying(false); return; }
      setPointFilter(points[idx].id);
      setTimeout(step, 1200);
    };
    setTimeout(step, 1200);
    return () => { cancelled = true; };
  }, [playing]);

  const pointIndex = useMemo(() => new Map(points.map((p, i) => [p.id, i])), [points]);
  const filterIndex = pointFilter ? pointIndex.get(pointFilter) ?? -1 : -1;
  const isVisibleAtFilter = (from?: string, to?: string) => {
    if (filterIndex < 0) return true;
    const f = from ? pointIndex.get(from) ?? -1 : -1;
    const t = to ? pointIndex.get(to) ?? Infinity : Infinity;
    return f <= filterIndex && filterIndex <= t;
  };

  const aspect = map.imageWidth && map.imageHeight ? map.imageWidth / map.imageHeight : 16 / 9;

  const selMarker = selection?.kind === 'marker' ? map.markers.find((m) => m.id === selection.id) : null;
  const selRegion = selection?.kind === 'region' ? map.regions.find((r) => r.id === selection.id) : null;

  const patchMarker = (id: string, p: Partial<MapMarker>) =>
    patch((m) => { const mk = m.markers.find((x) => x.id === id); if (mk) Object.assign(mk, p); });
  const patchRegion = (id: string, p: Partial<MapRegion>) =>
    patch((m) => { const r = m.regions.find((x) => x.id === id); if (r) Object.assign(r, p); });
  const removeMarker = (id: string) => { patch((m) => { m.markers = m.markers.filter((x) => x.id !== id); }); setSelection(null); };
  const removeRegion = (id: string) => { patch((m) => { m.regions = m.regions.filter((x) => x.id !== id); }); setSelection(null); };

  const exportPng = async () => {
    if (!map.image) { alert('先上传底图'); return; }
    const svg = svgRef.current!;
    const w = map.imageWidth ?? 1600, h = map.imageHeight ?? 900;
    const svgClone = svg.cloneNode(true) as SVGSVGElement;
    // 序列化 svg 与底图叠加渲染到 canvas
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const bg = new Image();
    bg.src = map.image;
    await new Promise<void>((r, j) => { bg.onload = () => r(); bg.onerror = () => j(new Error('底图加载失败')); });
    ctx.drawImage(bg, 0, 0, w, h);
    const svgStr = new XMLSerializer().serializeToString(svgClone);
    const svgImg = new Image();
    svgImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    await new Promise<void>((r, j) => { svgImg.onload = () => r(); svgImg.onerror = () => j(new Error('叠层渲染失败')); });
    ctx.drawImage(svgImg, 0, 0, w, h);
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = `${map.name}.png`; a.click();
  };

  return (
    <>
      <div className="pane-col">
        <div className="toolbar">
          <button className={mode === 'view' ? 'primary' : ''} onClick={() => { setMode('view'); setDraftRegion([]); }}>浏览</button>
          <button className={mode === 'marker' ? 'primary' : ''} onClick={() => { setMode('marker'); setDraftRegion([]); }} title="点击画布放置标记">＋ 标记</button>
          <button className={mode === 'region' ? 'primary' : ''} onClick={() => { setMode('region'); }} title="依次点击落点,右键 / 双击完成">＋ 区域</button>
          {mode === 'region' && (
            <>
              <button className="ghost" onClick={finishRegion} disabled={draftRegion.length < 3}>完成({draftRegion.length} 点)</button>
              <button className="ghost" onClick={() => setDraftRegion([])}>取消</button>
            </>
          )}
          <span style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <button onClick={() => imgFileRef.current?.click()}>
            <Icon name="image" /> {map.image ? '替换底图' : '上传底图'}
          </button>
          <input
            ref={imgFileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(f);
              e.target.value = '';
            }}
          />
          <button onClick={exportPng}><Icon name="download" /> 导出 PNG</button>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {points.length > 0 && (
              <button
                className="ghost icon-btn"
                title={playing ? '停止播放' : '从当前时间点开始扫过所有时间点(约 1.2 秒/帧)'}
                onClick={() => setPlaying((v) => !v)}
              >
                {playing ? '■' : '▶'}
              </button>
            )}
            <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>时间线滤镜</label>
            <select value={pointFilter} onChange={(e) => { setPointFilter(e.target.value); setPlaying(false); }}>
              <option value="">全部时间</option>
              {points.map((pt) => <option key={pt.id} value={pt.id}>{pt.label}</option>)}
            </select>
          </span>
        </div>

        <div className="map-canvas-wrap">
          {!map.image && (
            <div className="empty-hint" style={{ padding: 60 }}>
              还没有底图。<br />点击工具栏「上传底图」选一张 PNG/JPG,<br />来自 Inkarnate 导出、手绘扫描或 Azgaar 生成都行。
            </div>
          )}
          {map.image && (
            <div className="map-canvas" style={{ aspectRatio: aspect }}>
              <img src={map.image} alt="" draggable={false} />
              <svg
                ref={svgRef}
                viewBox={`0 0 ${S} ${S}`}
                preserveAspectRatio="none"
                onClick={onCanvasClick}
                onContextMenu={(e) => { if (mode === 'region') { e.preventDefault(); finishRegion(); } }}
                style={{ cursor: mode === 'view' ? 'default' : 'crosshair' }}
              >
                {/* 已有区域 */}
                {map.regions.map((r) => {
                  if (!isVisibleAtFilter(r.fromPointId, r.toPointId)) return null;
                  const pts = r.points.map((p) => `${p.x * S},${p.y * S}`).join(' ');
                  const active = selection?.kind === 'region' && selection.id === r.id;
                  const col = r.color || '#565550';
                  return (
                    <g key={r.id}>
                      <polygon
                        points={pts}
                        fill={col} fillOpacity={active ? 0.35 : 0.22}
                        stroke={col} strokeWidth={active ? 3 : 1.5}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); setSelection({ kind: 'region', id: r.id }); }}
                      />
                      {/* 选中时显示可拖拽顶点 */}
                      {active && r.points.map((v, i) => (
                        <rect
                          key={i}
                          x={v.x * S - 6} y={v.y * S - 6} width={12} height={12}
                          fill="#fff" stroke="#1b1b19" strokeWidth={2}
                          style={{ cursor: 'grab' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setDraggingVertex({ regionId: r.id, idx: i });
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            if (r.points.length <= 3) { alert('多边形至少 3 顶点'); return; }
                            patch((m) => {
                              const rr = m.regions.find((x) => x.id === r.id);
                              if (rr) rr.points.splice(i, 1);
                            });
                          }}
                        >
                          <title>拖拽移动 · 右键删除</title>
                        </rect>
                      ))}
                    </g>
                  );
                })}

                {/* 已有标记 */}
                {map.markers.map((mk) => {
                  if (!isVisibleAtFilter(mk.fromPointId, mk.toPointId)) return null;
                  const ent = entities.find((e) => e.id === mk.entityId);
                  const color = mk.color || ent?.color || '#1b1b19';
                  const active = selection?.kind === 'marker' && selection.id === mk.id;
                  const label = mk.label || ent?.name || '';
                  return (
                    <g
                      key={mk.id}
                      transform={`translate(${mk.x * S}, ${mk.y * S})`}
                      style={{ cursor: mode === 'view' ? 'grab' : 'pointer' }}
                      onMouseDown={(e) => {
                        if (mode !== 'view') return;
                        e.stopPropagation();
                        setSelection({ kind: 'marker', id: mk.id });
                        setDragging(mk.id);
                      }}
                      onClick={(e) => { e.stopPropagation(); setSelection({ kind: 'marker', id: mk.id }); }}
                    >
                      <circle r={active ? 10 : 7} fill={color} stroke="#fff" strokeWidth={2} />
                      {label && (
                        <text x={12} y={4} fill="#1b1b19" stroke="#fff" strokeWidth={4}
                          paintOrder="stroke" style={{ font: 'bold 13px sans-serif' }}>
                          {label}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* 正在绘制的区域草稿 */}
                {draftRegion.length > 0 && (
                  <>
                    {draftRegion.length >= 3 && (
                      <polygon
                        points={draftRegion.map((p) => `${p.x * S},${p.y * S}`).join(' ')}
                        fill="#1b1b19" fillOpacity={0.15} stroke="#1b1b19" strokeDasharray="6 4" strokeWidth={2}
                      />
                    )}
                    {draftRegion.length >= 2 && draftRegion.length < 3 && (
                      <polyline
                        points={draftRegion.map((p) => `${p.x * S},${p.y * S}`).join(' ')}
                        fill="none" stroke="#1b1b19" strokeDasharray="6 4" strokeWidth={2}
                      />
                    )}
                    {draftRegion.map((p, i) => (
                      <circle key={i} cx={p.x * S} cy={p.y * S} r={5} fill="#1b1b19" stroke="#fff" strokeWidth={2} />
                    ))}
                  </>
                )}
              </svg>
            </div>
          )}
        </div>
      </div>

      <aside className="inspector">
        {selMarker ? (
          <MarkerInspector marker={selMarker} onChange={(p) => patchMarker(selMarker.id, p)} onDelete={() => removeMarker(selMarker.id)} />
        ) : selRegion ? (
          <RegionInspector region={selRegion} onChange={(p) => patchRegion(selRegion.id, p)} onDelete={() => removeRegion(selRegion.id)} />
        ) : (
          <div className="empty-hint">
            切换工具栏模式并点画布来添加。<br /><br />
            <b>标记</b>:关联「地点」实体、指定时间线区间<br />
            <b>区域</b>:多边形圈一块地(常用于阵营领地)<br /><br />
            选中已有标记/区域后可编辑与删除。
          </div>
        )}
      </aside>
    </>
  );
}

function EntityPicker({ value, kindPreferred, onChange }: {
  value?: string;
  kindPreferred: 'location' | 'faction';
  onChange: (id: string | undefined) => void;
}) {
  const entities = useLoom((s) => s.project.entities);
  const preferred = entities.filter((e) => e.kind === kindPreferred);
  const others = entities.filter((e) => e.kind !== kindPreferred);
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">(不关联)</option>
      {preferred.length > 0 && <optgroup label={kindPreferred === 'location' ? '地点' : '阵营'}>
        {preferred.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </optgroup>}
      {others.length > 0 && <optgroup label="其他实体">
        {others.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </optgroup>}
    </select>
  );
}

function TimeRangeFields({ from, to, onChange }: {
  from?: string;
  to?: string;
  onChange: (patch: { fromPointId?: string; toPointId?: string }) => void;
}) {
  const points = useLoom((s) => s.project.timelinePoints);
  if (points.length === 0) return null;
  return (
    <>
      <div className="field">
        <label>从(时间线) — 空表示始终存在</label>
        <select value={from ?? ''} onChange={(e) => onChange({ fromPointId: e.target.value || undefined })}>
          <option value="">(始终)</option>
          {points.map((pt) => <option key={pt.id} value={pt.id}>{pt.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label>到(在此之后不显示) — 空表示永远存在</label>
        <select value={to ?? ''} onChange={(e) => onChange({ toPointId: e.target.value || undefined })}>
          <option value="">(永远)</option>
          {points.map((pt) => <option key={pt.id} value={pt.id}>{pt.label}</option>)}
        </select>
      </div>
    </>
  );
}

function MarkerInspector({ marker, onChange, onDelete }: {
  marker: MapMarker;
  onChange: (patch: Partial<MapMarker>) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <h3>标记属性</h3>
      <div className="field">
        <label>标签(留空则用实体名)</label>
        <input value={marker.label} onChange={(e) => onChange({ label: e.target.value })} />
      </div>
      <div className="field">
        <label>关联实体</label>
        <EntityPicker value={marker.entityId} kindPreferred="location" onChange={(id) => onChange({ entityId: id })} />
      </div>
      <div className="field">
        <label>颜色(默认跟随实体)</label>
        <div className="color-row">
          {PALETTE.map((c) => (
            <button key={c} className={`color-swatch ${marker.color === c ? 'selected' : ''}`} style={{ background: c }}
              onClick={() => onChange({ color: marker.color === c ? undefined : c })} />
          ))}
        </div>
      </div>
      <TimeRangeFields from={marker.fromPointId} to={marker.toPointId} onChange={onChange} />
      <button className="danger" onClick={onDelete}>删除标记</button>
    </>
  );
}

function RegionInspector({ region, onChange, onDelete }: {
  region: MapRegion;
  onChange: (patch: Partial<MapRegion>) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <h3>区域属性</h3>
      <div className="field">
        <label>标签</label>
        <input value={region.label} onChange={(e) => onChange({ label: e.target.value })} />
      </div>
      <div className="field">
        <label>关联实体(通常是阵营)</label>
        <EntityPicker value={region.entityId} kindPreferred="faction" onChange={(id) => onChange({ entityId: id })} />
      </div>
      <div className="field">
        <label>填色</label>
        <div className="color-row">
          {PALETTE.map((c) => (
            <button key={c} className={`color-swatch ${region.color === c ? 'selected' : ''}`} style={{ background: c }}
              onClick={() => onChange({ color: c })} />
          ))}
        </div>
      </div>
      <TimeRangeFields from={region.fromPointId} to={region.toPointId} onChange={onChange} />
      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
        顶点数:{region.points.length}。拖拽白色方块调整位置,右键删除(至少保留 3 顶点)。
      </div>
      <button className="danger" onClick={onDelete}>删除区域</button>
    </>
  );
}
