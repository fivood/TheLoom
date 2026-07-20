import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { fileToDataUrl } from './util';
import { useNav } from '../../search';
import { confirmDialog, promptText, alertDialog } from '../../dialog';
import type { MapDoc, MapMarker, MapRegion, MapShape, MapShapeType, MapLayer } from '../../types';
import Icon from '../../components/Icon';
import ObjectTemplateSection from '../../components/ObjectTemplateSection';
import ColorPicker from '../../components/ColorPicker';
import Inspector from '../../components/Inspector';

type Mode = 'view' | 'marker' | 'region' | 'shape-polyline' | 'shape-rect' | 'shape-ellipse' | 'shape-text';
type Selection =
  | { kind: 'marker'; id: string }
  | { kind: 'region'; id: string }
  | { kind: 'shape'; id: string }
  | null;

const SHAPE_MODE_TO_TYPE: Record<'shape-polyline' | 'shape-rect' | 'shape-ellipse' | 'shape-text', MapShapeType> = {
  'shape-polyline': 'polyline',
  'shape-rect': 'rect',
  'shape-ellipse': 'ellipse',
  'shape-text': 'text',
};
const SHAPE_LABEL: Record<MapShapeType, string> = {
  polyline: '路径', rect: '矩形', ellipse: '椭圆', text: '文字',
};

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
  const renameMap = async (id: string, current: string) => {
    const name = await promptText({ message: '地图名称', defaultValue: current });
    if (name) update((p) => { const m = p.maps.find((x) => x.id === id); if (m) m.name = name; });
  };
  const deleteMap = async (id: string) => {
    if (!await confirmDialog({ message: '删除该地图及全部标记与区域?', danger: true, confirmText: '删除' })) return;
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
  // R14 正在绘制的多点路径(共用 draftRegion 逻辑,polyline 走这个)
  const [draftPolyline, setDraftPolyline] = useState<{ x: number; y: number }[]>([]);
  // R14 拖拽绘制中的形状(rect / ellipse 用两点)
  const [dragShape, setDragShape] = useState<{ type: 'rect' | 'ellipse'; start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
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
    } catch { await alertDialog('无法读取该图片'); }
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
    const layerId = activeLayerId ?? undefined;
    if (mode === 'marker') {
      const nm: MapMarker = { id: uid(), x, y, label: '', layerId };
      patch((m) => { m.markers.push(nm); });
      setSelection({ kind: 'marker', id: nm.id });
      setMode('view');
    } else if (mode === 'region') {
      setDraftRegion((d) => [...d, { x, y }]);
    } else if (mode === 'shape-polyline') {
      setDraftPolyline((d) => [...d, { x, y }]);
    } else if (mode === 'shape-text') {
      const ns: MapShape = { id: uid(), type: 'text', points: [{ x, y }], text: '文字', color: '#1b1b19', layerId };
      patch((m) => { (m.shapes ??= []).push(ns); });
      setSelection({ kind: 'shape', id: ns.id });
      setMode('view');
    } else if (mode !== 'shape-rect' && mode !== 'shape-ellipse') {
      // rect / ellipse 用拖拽,不在 click 里处理
      setSelection(null);
    }
  };

  const finishRegion = () => {
    if (draftRegion.length < 3) { setDraftRegion([]); return; }
    const nr: MapRegion = { id: uid(), points: draftRegion, label: '', color: '#565550', layerId: activeLayerId ?? undefined };
    patch((m) => { m.regions.push(nr); });
    setDraftRegion([]);
    setSelection({ kind: 'region', id: nr.id });
    setMode('view');
  };

  const finishPolyline = () => {
    if (draftPolyline.length < 2) { setDraftPolyline([]); return; }
    const ns: MapShape = {
      id: uid(), type: 'polyline', points: draftPolyline,
      color: '#1b1b19', strokeWidth: 2, layerId: activeLayerId ?? undefined,
    };
    patch((m) => { (m.shapes ??= []).push(ns); });
    setDraftPolyline([]);
    setSelection({ kind: 'shape', id: ns.id });
    setMode('view');
  };

  // rect / ellipse 拖拽绘制:mouseDown 在空白 → 记录起点,进入 dragShape 状态
  const onCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'shape-rect' && mode !== 'shape-ellipse') return;
    if (e.button !== 0) return;
    const type = mode === 'shape-rect' ? 'rect' : 'ellipse';
    const p = clientToNormalized(e.clientX, e.clientY);
    setDragShape({ type, start: p, end: p });
  };
  // 用 ref 追踪最新的 dragShape,避免 setState 回调里做副作用被 StrictMode 双调用
  const dragShapeRef = useRef(dragShape);
  useEffect(() => { dragShapeRef.current = dragShape; }, [dragShape]);
  useEffect(() => {
    if (!dragShape) return;
    const onMove = (e: MouseEvent) => {
      const p = clientToNormalized(e.clientX, e.clientY);
      setDragShape((cur) => cur ? { ...cur, end: p } : null);
    };
    const onUp = () => {
      const cur = dragShapeRef.current;
      setDragShape(null);
      if (!cur) return;
      const dx = Math.abs(cur.end.x - cur.start.x), dy = Math.abs(cur.end.y - cur.start.y);
      if (dx < 0.005 && dy < 0.005) return; // 太小视为误操作
      const x1 = Math.min(cur.start.x, cur.end.x), y1 = Math.min(cur.start.y, cur.end.y);
      const x2 = Math.max(cur.start.x, cur.end.x), y2 = Math.max(cur.start.y, cur.end.y);
      const ns: MapShape = {
        id: uid(), type: cur.type, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        color: '#1b1b19', strokeWidth: 2, fill: false, layerId: activeLayerId ?? undefined,
      };
      patch((m) => { (m.shapes ??= []).push(ns); });
      setSelection({ kind: 'shape', id: ns.id });
      setMode('view');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragShape, activeLayerId]);

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
  const selShape = selection?.kind === 'shape' ? (map.shapes ?? []).find((s) => s.id === selection.id) : null;

  const patchMarker = (id: string, p: Partial<MapMarker>) =>
    patch((m) => { const mk = m.markers.find((x) => x.id === id); if (mk) Object.assign(mk, p); });
  const patchRegion = (id: string, p: Partial<MapRegion>) =>
    patch((m) => { const r = m.regions.find((x) => x.id === id); if (r) Object.assign(r, p); });
  const patchShape = (id: string, p: Partial<MapShape>) =>
    patch((m) => { const s = (m.shapes ?? []).find((x) => x.id === id); if (s) Object.assign(s, p); });
  const removeMarker = (id: string) => { patch((m) => { m.markers = m.markers.filter((x) => x.id !== id); }); setSelection(null); };
  const removeRegion = (id: string) => { patch((m) => { m.regions = m.regions.filter((x) => x.id !== id); }); setSelection(null); };
  const removeShape = (id: string) => { patch((m) => { m.shapes = (m.shapes ?? []).filter((x) => x.id !== id); }); setSelection(null); };

  // R14 图层辅助:显隐 / 锁定过滤
  const layerById = useMemo(() => new Map((map.layers ?? []).map((l) => [l.id, l])), [map.layers]);
  const isLayerVisible = (layerId?: string) => !layerId || (layerById.get(layerId)?.visible !== false);
  const isLayerLocked = (layerId?: string) => !!(layerId && layerById.get(layerId)?.locked);

  const ensureLayer = () => {
    // 需要归属图层时(如新建 shape / marker),项目里若无图层则先建一个默认
    if ((map.layers ?? []).length > 0) return activeLayerId ?? map.layers![0].id;
    const id = uid();
    patch((m) => { (m.layers ??= []).push({ id, name: '默认', visible: true, locked: false, order: 0 }); });
    setActiveLayerId(id);
    return id;
  };

  // 切换到需要归属图层的绘制模式时:确保有图层
  const setDrawMode = (m: Mode) => {
    if (m !== 'view') ensureLayer();
    setMode(m);
    setDraftRegion([]);
    setDraftPolyline([]);
  };

  const exportPng = async () => {
    if (!map.image) { await alertDialog('先上传底图'); return; }
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
          <button className={mode === 'view' ? 'primary' : ''} onClick={() => setDrawMode('view')}>浏览</button>
          <button className={mode === 'marker' ? 'primary' : ''} onClick={() => setDrawMode('marker')} title="点击画布放置标记">＋ 标记</button>
          <button className={mode === 'region' ? 'primary' : ''} onClick={() => setDrawMode('region')} title="依次点击落点,右键 / 双击完成">＋ 区域</button>
          <span style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <button className={mode === 'shape-polyline' ? 'primary' : ''} onClick={() => setDrawMode('shape-polyline')} title="路径 / 河流 / 边界:依次点击落点,右键 / 双击完成">＋ 路径</button>
          <button className={mode === 'shape-rect' ? 'primary' : ''} onClick={() => setDrawMode('shape-rect')} title="矩形:按住鼠标拖出">＋ 矩形</button>
          <button className={mode === 'shape-ellipse' ? 'primary' : ''} onClick={() => setDrawMode('shape-ellipse')} title="椭圆:按住鼠标拖出">＋ 椭圆</button>
          <button className={mode === 'shape-text' ? 'primary' : ''} onClick={() => setDrawMode('shape-text')} title="文字:点击放置">＋ 文字</button>
          {mode === 'region' && (
            <>
              <button className="ghost" onClick={finishRegion} disabled={draftRegion.length < 3}>完成({draftRegion.length} 点)</button>
              <button className="ghost" onClick={() => setDraftRegion([])}>取消</button>
            </>
          )}
          {mode === 'shape-polyline' && (
            <>
              <button className="ghost" onClick={finishPolyline} disabled={draftPolyline.length < 2}>完成({draftPolyline.length} 点)</button>
              <button className="ghost" onClick={() => setDraftPolyline([])}>取消</button>
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
                onMouseDown={onCanvasMouseDown}
                onContextMenu={(e) => {
                  if (mode === 'region') { e.preventDefault(); finishRegion(); }
                  else if (mode === 'shape-polyline') { e.preventDefault(); finishPolyline(); }
                }}
                style={{ cursor: mode === 'view' ? 'default' : 'crosshair' }}
              >
                {/* 已有区域 */}
                {map.regions.map((r) => {
                  if (!isVisibleAtFilter(r.fromPointId, r.toPointId)) return null;
                  if (!isLayerVisible(r.layerId)) return null;
                  const locked = isLayerLocked(r.layerId);
                  const pts = r.points.map((p) => `${p.x * S},${p.y * S}`).join(' ');
                  const active = selection?.kind === 'region' && selection.id === r.id;
                  const col = r.color || '#565550';
                  return (
                    <g key={r.id}>
                      <polygon
                        points={pts}
                        fill={col} fillOpacity={active ? 0.35 : 0.22}
                        stroke={col} strokeWidth={active ? 3 : 1.5}
                        style={{ cursor: locked ? 'not-allowed' : 'pointer', pointerEvents: locked ? 'none' : undefined }}
                        onClick={(e) => { e.stopPropagation(); setSelection({ kind: 'region', id: r.id }); }}
                      />
                      {active && !locked && r.points.map((v, i) => (
                        <rect
                          key={i}
                          x={v.x * S - 6} y={v.y * S - 6} width={12} height={12}
                          fill="#fff" stroke="#1b1b19" strokeWidth={2}
                          style={{ cursor: 'grab' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setDraggingVertex({ regionId: r.id, idx: i });
                          }}
                          onContextMenu={async (e) => {
                            e.preventDefault(); e.stopPropagation();
                            if (r.points.length <= 3) { await alertDialog('多边形至少 3 顶点'); return; }
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

                {/* R14 已有矢量形状 */}
                {(map.shapes ?? []).map((s) => {
                  if (!isVisibleAtFilter(s.fromPointId, s.toPointId)) return null;
                  if (!isLayerVisible(s.layerId)) return null;
                  const locked = isLayerLocked(s.layerId);
                  const active = selection?.kind === 'shape' && selection.id === s.id;
                  const col = s.color || '#1b1b19';
                  const sw = s.strokeWidth ?? 2;
                  const onSel = (e: React.MouseEvent) => { e.stopPropagation(); setSelection({ kind: 'shape', id: s.id }); };
                  const cursor = locked ? 'not-allowed' : 'pointer';
                  const pointerEvents = locked ? 'none' as const : undefined;
                  if (s.type === 'polyline') {
                    const pts = s.points.map((p) => `${p.x * S},${p.y * S}`).join(' ');
                    return (
                      <polyline key={s.id} points={pts} fill="none" stroke={col}
                        strokeWidth={active ? sw + 2 : sw} strokeLinejoin="round" strokeLinecap="round"
                        style={{ cursor, pointerEvents }} onClick={onSel} />
                    );
                  }
                  if (s.type === 'rect' && s.points.length >= 2) {
                    const [a, b] = s.points;
                    const x = Math.min(a.x, b.x) * S, y = Math.min(a.y, b.y) * S;
                    const w = Math.abs(b.x - a.x) * S, h = Math.abs(b.y - a.y) * S;
                    return (
                      <rect key={s.id} x={x} y={y} width={w} height={h}
                        fill={s.fill ? col : 'none'} fillOpacity={s.fill ? 0.2 : 0}
                        stroke={col} strokeWidth={active ? sw + 2 : sw}
                        style={{ cursor, pointerEvents }} onClick={onSel} />
                    );
                  }
                  if (s.type === 'ellipse' && s.points.length >= 2) {
                    const [a, b] = s.points;
                    const cx = (a.x + b.x) / 2 * S, cy = (a.y + b.y) / 2 * S;
                    const rx = Math.abs(b.x - a.x) / 2 * S, ry = Math.abs(b.y - a.y) / 2 * S;
                    return (
                      <ellipse key={s.id} cx={cx} cy={cy} rx={rx} ry={ry}
                        fill={s.fill ? col : 'none'} fillOpacity={s.fill ? 0.2 : 0}
                        stroke={col} strokeWidth={active ? sw + 2 : sw}
                        style={{ cursor, pointerEvents }} onClick={onSel} />
                    );
                  }
                  if (s.type === 'text' && s.points.length >= 1) {
                    const [p] = s.points;
                    return (
                      <text key={s.id} x={p.x * S} y={p.y * S} fill={col}
                        stroke="#fff" strokeWidth={active ? 5 : 3.5} paintOrder="stroke"
                        style={{ font: `${active ? 'bold ' : ''}14px sans-serif`, cursor, pointerEvents }}
                        onClick={onSel}>
                        {s.text || '文字'}
                      </text>
                    );
                  }
                  return null;
                })}

                {/* 已有标记 */}
                {map.markers.map((mk) => {
                  if (!isVisibleAtFilter(mk.fromPointId, mk.toPointId)) return null;
                  if (!isLayerVisible(mk.layerId)) return null;
                  const locked = isLayerLocked(mk.layerId);
                  const ent = entities.find((e) => e.id === mk.entityId);
                  const color = mk.color || ent?.color || '#1b1b19';
                  const active = selection?.kind === 'marker' && selection.id === mk.id;
                  const label = mk.label || ent?.name || '';
                  return (
                    <g
                      key={mk.id}
                      transform={`translate(${mk.x * S}, ${mk.y * S})`}
                      style={{
                        cursor: locked ? 'not-allowed' : (mode === 'view' ? 'grab' : 'pointer'),
                        pointerEvents: locked ? 'none' : undefined,
                      }}
                      onMouseDown={(e) => {
                        if (mode !== 'view' || locked) return;
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

                {/* R14 正在绘制的路径草稿 */}
                {draftPolyline.length > 0 && (
                  <>
                    {draftPolyline.length >= 2 && (
                      <polyline
                        points={draftPolyline.map((p) => `${p.x * S},${p.y * S}`).join(' ')}
                        fill="none" stroke="#1b1b19" strokeDasharray="6 4" strokeWidth={2}
                      />
                    )}
                    {draftPolyline.map((p, i) => (
                      <circle key={i} cx={p.x * S} cy={p.y * S} r={5} fill="#1b1b19" stroke="#fff" strokeWidth={2} />
                    ))}
                  </>
                )}

                {/* R14 正在拖拽的矩形 / 椭圆预览 */}
                {dragShape && (() => {
                  const { start, end, type } = dragShape;
                  const x1 = Math.min(start.x, end.x), y1 = Math.min(start.y, end.y);
                  const x2 = Math.max(start.x, end.x), y2 = Math.max(start.y, end.y);
                  const w = (x2 - x1) * S, h = (y2 - y1) * S;
                  return type === 'rect'
                    ? <rect x={x1 * S} y={y1 * S} width={w} height={h} fill="none" stroke="#1b1b19" strokeDasharray="6 4" strokeWidth={2} pointerEvents="none" />
                    : <ellipse cx={(x1 + x2) / 2 * S} cy={(y1 + y2) / 2 * S} rx={w / 2} ry={h / 2} fill="none" stroke="#1b1b19" strokeDasharray="6 4" strokeWidth={2} pointerEvents="none" />;
                })()}
              </svg>
            </div>
          )}
        </div>
      </div>

      <Inspector>
        {selMarker ? (
          <MarkerInspector marker={selMarker} layers={map.layers ?? []} onChange={(p) => patchMarker(selMarker.id, p)} onDelete={() => removeMarker(selMarker.id)} />
        ) : selRegion ? (
          <RegionInspector region={selRegion} layers={map.layers ?? []} onChange={(p) => patchRegion(selRegion.id, p)} onDelete={() => removeRegion(selRegion.id)} />
        ) : selShape ? (
          <ShapeInspector shape={selShape} layers={map.layers ?? []} onChange={(p) => patchShape(selShape.id, p)} onDelete={() => removeShape(selShape.id)} />
        ) : (
          <>
            <ObjectTemplateSection
              module="map"
              object={map}
              onFieldsChange={(fields) => patch((m) => { m.fields = fields; })}
            />
            <div className="empty-hint">
              切换工具栏模式并点画布来添加。<br /><br />
              <b>标记 / 区域</b>:关联实体 / 时间线<br />
              <b>路径 / 矩形 / 椭圆 / 文字</b>:自由标注,归入图层<br /><br />
              选中已有对象后可编辑与删除。
            </div>
          </>
        )}
        <LayerPanel
          map={map}
          activeLayerId={activeLayerId}
          setActiveLayerId={setActiveLayerId}
          patch={patch}
        />
      </Inspector>
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

function LayerPicker({ layers, value, onChange }: { layers: MapLayer[]; value?: string; onChange: (id?: string) => void }) {
  if (layers.length === 0) return null;
  return (
    <div className="field">
      <label>图层</label>
      <select value={value ?? layers[0].id} onChange={(e) => onChange(e.target.value || undefined)}>
        {layers.map((l) => <option key={l.id} value={l.id}>{l.name}{l.locked ? ' 🔒' : ''}{!l.visible ? ' 👁' : ''}</option>)}
      </select>
    </div>
  );
}

function MarkerInspector({ marker, layers, onChange, onDelete }: {
  marker: MapMarker;
  layers: MapLayer[];
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
        <ColorPicker value={marker.color} onChange={(c) => onChange({ color: c })} />
      </div>
      <LayerPicker layers={layers} value={marker.layerId} onChange={(id) => onChange({ layerId: id })} />
      <TimeRangeFields from={marker.fromPointId} to={marker.toPointId} onChange={onChange} />
      <button className="danger" onClick={onDelete}>删除标记</button>
    </>
  );
}

function RegionInspector({ region, layers, onChange, onDelete }: {
  region: MapRegion;
  layers: MapLayer[];
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
        <ColorPicker value={region.color} onChange={(c) => onChange({ color: c })} allowClear={false} />
      </div>
      <LayerPicker layers={layers} value={region.layerId} onChange={(id) => onChange({ layerId: id })} />
      <TimeRangeFields from={region.fromPointId} to={region.toPointId} onChange={onChange} />
      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
        顶点数:{region.points.length}。拖拽白色方块调整位置,右键删除(至少保留 3 顶点)。
      </div>
      <button className="danger" onClick={onDelete}>删除区域</button>
    </>
  );
}

function ShapeInspector({ shape, layers, onChange, onDelete }: {
  shape: MapShape;
  layers: MapLayer[];
  onChange: (patch: Partial<MapShape>) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <h3>{SHAPE_LABEL[shape.type]}属性</h3>
      {shape.type === 'text' ? (
        <div className="field">
          <label>文字内容</label>
          <input value={shape.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
        </div>
      ) : (
        <div className="field">
          <label>标签(可选,仅供项目内检索)</label>
          <input value={shape.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
        </div>
      )}
      <div className="field">
        <label>{shape.type === 'text' ? '文字颜色' : '描边颜色'}</label>
        <ColorPicker value={shape.color} onChange={(c) => onChange({ color: c })} allowClear={false} />
      </div>
      {shape.type !== 'text' && (
        <div className="field">
          <label>描边粗细</label>
          <input
            type="number" min={1} max={20} step={1} style={{ width: 80 }}
            value={shape.strokeWidth ?? 2}
            onChange={(e) => onChange({ strokeWidth: Math.max(1, Math.min(20, Math.floor(Number(e.target.value) || 2))) })}
          />
        </div>
      )}
      {(shape.type === 'rect' || shape.type === 'ellipse') && (
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={shape.fill === true} onChange={(e) => onChange({ fill: e.target.checked })} />
            半透明填充
          </label>
        </div>
      )}
      <LayerPicker layers={layers} value={shape.layerId} onChange={(id) => onChange({ layerId: id })} />
      <TimeRangeFields from={shape.fromPointId} to={shape.toPointId} onChange={onChange} />
      <button className="danger" onClick={onDelete}>删除{SHAPE_LABEL[shape.type]}</button>
    </>
  );
}

function LayerPanel({ map, activeLayerId, setActiveLayerId, patch }: {
  map: MapDoc;
  activeLayerId: string | null;
  setActiveLayerId: (id: string | null) => void;
  patch: (fn: (m: MapDoc) => void) => void;
}) {
  const layers = [...(map.layers ?? [])].sort((a, b) => a.order - b.order);
  const shapes = map.shapes ?? [];
  // 每图层已使用数量(marker + region + shape)
  const counts = new Map<string, number>();
  for (const item of [...map.markers, ...map.regions, ...shapes]) {
    const id = item.layerId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const addLayer = () => {
    const id = uid();
    const maxOrder = layers.reduce((n, l) => Math.max(n, l.order), -1);
    patch((m) => { (m.layers ??= []).push({ id, name: `图层 ${(m.layers?.length ?? 0) + 1}`, visible: true, locked: false, order: maxOrder + 1 }); });
    setActiveLayerId(id);
  };
  const patchLayer = (id: string, p: Partial<MapLayer>) =>
    patch((m) => { const l = (m.layers ?? []).find((x) => x.id === id); if (l) Object.assign(l, p); });
  const removeLayer = async (id: string) => {
    const used = counts.get(id) ?? 0;
    const msg = used > 0
      ? `删除该图层?图层上有 ${used} 个对象,它们会归入未指定图层(可以重新分配)。`
      : '删除该图层?';
    if (!await confirmDialog({ message: msg, danger: true, confirmText: '删除' })) return;
    patch((m) => {
      m.layers = (m.layers ?? []).filter((x) => x.id !== id);
      for (const mk of m.markers) if (mk.layerId === id) delete mk.layerId;
      for (const r of m.regions) if (r.layerId === id) delete r.layerId;
      for (const s of m.shapes ?? []) if (s.layerId === id) delete s.layerId;
    });
    if (activeLayerId === id) setActiveLayerId(null);
  };
  const move = (id: string, delta: -1 | 1) => {
    const idx = layers.findIndex((l) => l.id === id);
    const swap = layers[idx + delta];
    if (!swap) return;
    patch((m) => {
      const a = (m.layers ?? []).find((l) => l.id === id);
      const b = (m.layers ?? []).find((l) => l.id === swap.id);
      if (a && b) { const t = a.order; a.order = b.order; b.order = t; }
    });
  };
  const rename = async (id: string, cur: string) => {
    const name = await promptText({ message: '图层名称', defaultValue: cur });
    if (name) patchLayer(id, { name });
  };
  return (
    <details className="field inspector-fold" open={layers.length > 0}>
      <summary>图层({layers.length})</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {layers.map((l, i) => {
          const isActive = (activeLayerId ?? layers[0]?.id) === l.id;
          return (
            <div key={l.id}
              className={`layer-row ${isActive ? 'active' : ''}`}
              onClick={() => setActiveLayerId(l.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px',
                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                background: isActive ? 'var(--bg-hover)' : 'transparent',
              }}
            >
              <button
                className="ghost icon-btn" title={l.visible ? '隐藏' : '显示'}
                onClick={(e) => { e.stopPropagation(); patchLayer(l.id, { visible: !l.visible }); }}
                style={{ opacity: l.visible ? 1 : 0.4 }}
              >{l.visible ? '👁' : '⨯'}</button>
              <button
                className="ghost icon-btn" title={l.locked ? '解锁' : '锁定'}
                onClick={(e) => { e.stopPropagation(); patchLayer(l.id, { locked: !l.locked }); }}
              >{l.locked ? '🔒' : '🔓'}</button>
              <span
                style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}
                onDoubleClick={(e) => { e.stopPropagation(); rename(l.id, l.name); }}
                title="双击重命名"
              >{l.name}<span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>({counts.get(l.id) ?? 0})</span></span>
              <button className="ghost icon-btn" title="上移" disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(l.id, -1); }}>↑</button>
              <button className="ghost icon-btn" title="下移" disabled={i === layers.length - 1} onClick={(e) => { e.stopPropagation(); move(l.id, 1); }}>↓</button>
              <button className="ghost icon-btn" title="删除" onClick={(e) => { e.stopPropagation(); removeLayer(l.id); }}>×</button>
            </div>
          );
        })}
        <button className="ghost" onClick={addLayer} style={{ marginTop: 4 }}>＋ 新图层</button>
        {layers.length > 0 && (
          <div className="hint" style={{ fontSize: 11 }}>
            当前图层:<b>{layers.find((l) => l.id === (activeLayerId ?? layers[0]?.id))?.name}</b> —— 新建标记 / 区域 / 形状会归入这一层
          </div>
        )}
      </div>
    </details>
  );
}
