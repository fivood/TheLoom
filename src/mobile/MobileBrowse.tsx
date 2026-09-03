import { useMemo, useState } from 'react';
import { uid, useLoom } from '../store';
import Icon from '../components/Icon';
import ThemeToggle from '../components/ThemeToggle';
import { readableInk } from '../theme';
import { confirmDialog, promptText } from '../dialog';
import type { Document, OutlineRow, TimelineEvent } from '../types';
import Q from '../components/Q';

type View = 'outline' | 'timeline';

const LANE_COLORS = ['#1b1b19', '#565550', '#8e8d86', '#aaa9a1'];

function nextColor(used: number): string {
  return LANE_COLORS[used % LANE_COLORS.length];
}

export default function MobileBrowse({ onOpenWrite }: { onOpenWrite?: () => void }) {
  const [view, setView] = useState<View>('outline');

  return (
    <div className="m-browse">
      {/* 极简顶栏 */}
      <div className="m-clean-topbar">
        <div className="m-seg">
          <button className={view === 'outline' ? 'on' : ''} onClick={() => setView('outline')}>
            <Icon name="grid" size={14} /> 大纲
          </button>
          <button className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>
            <Icon name="clock" size={14} /> 时间线
          </button>
        </div>
        <ThemeToggle />
      </div>
      {view === 'outline' ? <OutlineList onOpenWrite={onOpenWrite} /> : <TimelineList />}
    </div>
  );
}

/* ---------------- 大纲 ---------------- */

function OutlineList({ onOpenWrite }: { onOpenWrite?: () => void }) {
  const rows = useLoom((s) => s.project.outlineRows);
  const columns = useLoom((s) => s.project.outlineColumns);
  const addOutlineRow = useLoom((s) => s.addOutlineRow);
  const updateOutlineRow = useLoom((s) => s.updateOutlineRow);
  const setOutlineCell = useLoom((s) => s.setOutlineCell);
  const removeOutlineRow = useLoom((s) => s.removeOutlineRow);
  const addOutlineColumn = useLoom((s) => s.addOutlineColumn);

  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const hit = (r: OutlineRow) =>
      [r.no, r.time, r.title, r.main, ...Object.values(r.cells ?? {})]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    return rows.filter(hit);
  }, [rows, query]);

  const addRow = () => {
    addOutlineRow();
    // 新行追加在末尾,拿最新的 id 展开编辑
    const next = useLoom.getState().project.outlineRows;
    setOpenId(next[next.length - 1]?.id ?? null);
  };

  const addLane = async () => {
    const title = await promptText({ title: '新建剧情线', message: '例如:主角线 / 反派线 / 感情线', placeholder: '剧情线名称' });
    if (!title?.trim()) return;
    addOutlineColumn({ id: uid(), title: title.trim(), color: nextColor(columns.length) });
  };

  const writeChapter = (r: OutlineRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const docs = useLoom.getState().project.documents;
    let target = docs.find((d) => d.name === r.title || (r.title && d.name.includes(r.title)));
    if (!target) {
      target = {
        id: uid(),
        name: r.title ? `${r.no ? `ACT ${r.no} · ` : ''}${r.title}` : `第 ${r.no || 1} 场`,
        category: useLoom.getState().project.documentCategories[0] ?? '未分类',
        blocks: [{ id: uid(), type: 'paragraph', text: r.main || '', flowRole: 'none' }],
        notes: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      useLoom.getState().addDocument(target);
    }
    try { localStorage.setItem(`theloom-mobile-last-doc:${useLoom.getState().currentSlotId}`, target.id); } catch { /* 忽略 */ }
    onOpenWrite?.();
  };

  const onRemove = async (r: OutlineRow) => {
    const ok = await confirmDialog({
      title: `删除「${r.title || '未命名章节'}」?`,
      message: '这一章的大纲内容会一并删除(不影响正文场景)。',
      danger: true,
    });
    if (!ok) return;
    removeOutlineRow(r.id);
    setOpenId(null);
  };

  return (
    <>
      <div className="m-browse-bar">
        <button className="primary-ghost" onClick={addRow}>＋ 章节</button>
        <button className="ghost" onClick={() => void addLane()}>＋ 剧情线</button>
        <span style={{ flex: 1 }} />
        {rows.length > 5 && (
          <input
            className="m-browse-search"
            value={query}
            placeholder="搜索大纲…"
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>

      <div className="m-outline-list">
        {visible.map((r) => {
          const isOpen = openId === r.id;
          const filled = columns.filter((c) => (r.cells?.[c.id] ?? '').trim());
          return (
            <div key={r.id} className={`m-outline-card ${isOpen ? 'open' : ''}`}>
              <div className="m-outline-head" onClick={() => setOpenId(isOpen ? null : r.id)}>
                {r.no && <span className="m-outline-no">{r.no}</span>}
                <strong className="m-outline-title">{r.title || '未命名章节'}</strong>
                {r.time && <span className="m-outline-time">{r.time}</span>}
                <button
                  className="ghost icon-btn m-outline-write-btn"
                  title="写此章正文"
                  onClick={(e) => writeChapter(r, e)}
                >
                  <Icon name="doc" size={12} />
                  <span>写此章</span>
                </button>
                <span className="m-outline-arrow">{isOpen ? '▾' : '▸'}</span>
              </div>

              {isOpen ? (
                <div className="m-outline-edit">
                  <div className="m-outline-row-2">
                    <label>
                      <span>序号</span>
                      <input value={r.no} placeholder="如:1 / 序" onChange={(e) => updateOutlineRow(r.id, { no: e.target.value })} />
                    </label>
                    <label>
                      <span>时间</span>
                      <input value={r.time} placeholder="如:16:09" onChange={(e) => updateOutlineRow(r.id, { time: e.target.value })} />
                    </label>
                  </div>
                  <label>
                    <span>标题</span>
                    <input value={r.title} onChange={(e) => updateOutlineRow(r.id, { title: e.target.value })} />
                  </label>
                  <label>
                    <span>主线剧情</span>
                    <textarea rows={3} value={r.main} onChange={(e) => updateOutlineRow(r.id, { main: e.target.value })} />
                  </label>
                  {columns.map((c) => (
                    <label key={c.id}>
                      <span className="m-outline-col" style={{ background: c.color, color: readableInk(c.color) }}>{c.title}</span>
                      <textarea
                        rows={2}
                        value={r.cells?.[c.id] ?? ''}
                        onChange={(e) => setOutlineCell(r.id, c.id, e.target.value)}
                      />
                    </label>
                  ))}
                  {columns.length === 0 && (
                    <div className="hint">还没有剧情线。用上面的<Q>＋ 剧情线</Q>加一条,就能在每章下分栏记录。</div>
                  )}
                  <div className="m-edit-foot">
                    <button className="ghost m-del" onClick={() => void onRemove(r)}>删除本章</button>
                    <span style={{ flex: 1 }} />
                    <button className="primary-ghost" onClick={() => writeChapter(r)}>✍️ 写本章正文</button>
                    <button className="ghost" onClick={() => setOpenId(null)}>收起</button>
                  </div>
                </div>
              ) : (
                <>
                  {r.main && <p className="m-outline-main">{r.main}</p>}
                  {filled.map((c) => (
                    <div key={c.id} className="m-outline-cell">
                      <span className="m-outline-col" style={{ background: c.color, color: readableInk(c.color) }}>{c.title}</span>
                      <span>{r.cells[c.id]}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        })}
        {rows.length > 0 && visible.length === 0 && <div className="hint" style={{ textAlign: 'center', padding: 20 }}>没有匹配的章节。</div>}
      </div>
    </>
  );
}

/* ---------------- 时间线 ---------------- */

function TimelineList() {
  const points = useLoom((s) => s.project.timelinePoints);
  const tracks = useLoom((s) => s.project.timelineTracks);
  const events = useLoom((s) => s.project.timelineEvents);
  const entities = useLoom((s) => s.project.entities);
  const update = useLoom((s) => s.update);

  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  // 按时间点分组:时间点顺序就是作者排好的故事顺序
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (ev: TimelineEvent) => !q
      || ev.title.toLowerCase().includes(q)
      || (ev.text ?? '').toLowerCase().includes(q);
    return points.map((p) => ({
      point: p,
      events: events.filter((ev) => ev.pointId === p.id && match(ev)),
    })).filter((g) => !q || g.events.length > 0);
  }, [points, events, query]);

  const addPoint = async () => {
    const label = await promptText({ title: '新建时间点', message: '任意写法:雨夜 / 三年前 / 第 7 日 / 16:09', placeholder: '故事时间' });
    if (!label?.trim()) return;
    update((p) => { p.timelinePoints.push({ id: uid(), label: label.trim() }); });
  };

  /** 事件必须挂在某条轨道上,项目里一条都没有时先建一条默认轨 */
  const ensureTrack = (p: { timelineTracks: typeof tracks }): string => {
    if (p.timelineTracks.length === 0) {
      const t = { id: uid(), name: '主线', color: nextColor(0) };
      p.timelineTracks.push(t);
      return t.id;
    }
    return p.timelineTracks[0].id;
  };

  const addEvent = (pointId: string) => {
    const id = uid();
    update((p) => {
      p.timelineEvents.push({
        id, pointId, trackId: ensureTrack(p), title: '', text: '', entityIds: [],
      });
    });
    setOpenId(id);
  };

  const addTrack = async () => {
    const name = await promptText({ title: '新建轨道', message: '例如:明线 / 暗线 / 某个角色', placeholder: '轨道名称' });
    if (!name?.trim()) return;
    update((p) => { p.timelineTracks.push({ id: uid(), name: name.trim(), color: nextColor(p.timelineTracks.length) }); });
  };

  const patchEvent = (id: string, patch: Partial<TimelineEvent>) => {
    update((p) => {
      const ev = p.timelineEvents.find((x) => x.id === id);
      if (ev) Object.assign(ev, patch);
    });
  };

  const removeEvent = async (ev: TimelineEvent) => {
    const ok = await confirmDialog({
      title: `删除「${ev.title || '未命名事件'}」?`, message: '该事件会从时间线上移除。', danger: true,
    });
    if (!ok) return;
    update((p) => { p.timelineEvents = p.timelineEvents.filter((x) => x.id !== ev.id); });
    setOpenId(null);
  };

  const renamePoint = async (id: string, label: string) => {
    const next = await promptText({ title: '时间点', message: '改写这个时间点的名称', defaultValue: label });
    if (next === null || !next.trim()) return;
    update((p) => {
      const pt = p.timelinePoints.find((x) => x.id === id);
      if (pt) pt.label = next.trim();
    });
  };

  const removePoint = async (id: string, label: string) => {
    const n = events.filter((e) => e.pointId === id).length;
    const ok = await confirmDialog({
      title: `删除时间点「${label}」?`,
      message: n > 0 ? `该时刻的 ${n} 个事件也会一并删除。` : '该时间点下没有事件。',
      danger: true,
    });
    if (!ok) return;
    update((p) => {
      p.timelinePoints = p.timelinePoints.filter((x) => x.id !== id);
      p.timelineEvents = p.timelineEvents.filter((x) => x.pointId !== id);
    });
  };

  return (
    <>
      <div className="m-browse-actions">
        <button className="ghost" onClick={() => void addPoint()}>＋ 时间点</button>
        <button className="ghost" onClick={() => void addTrack()}>＋ 轨道</button>
      </div>

      {events.length > 6 && (
        <input
          className="m-browse-search"
          value={query}
          placeholder="搜索事件…"
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {points.length === 0 && (
        <div className="hint">还没有时间线。点<Q>＋ 时间点</Q>建一个故事时刻(雨夜 / 第 7 日 / 16:09),再往里加事件。</div>
      )}

      <div className="m-tl-list">
        {grouped.map(({ point, events: evs }) => (
          <div key={point.id} className="m-tl-point">
            <div className="m-tl-label">
              <button className="m-tl-label-btn" onClick={() => void renamePoint(point.id, point.label)}>
                {point.label || '未命名时间点'}
              </button>
              <button className="ghost icon-btn" title="添加事件" onClick={() => addEvent(point.id)}>＋</button>
              <button className="ghost icon-btn m-del" title="删除时间点" onClick={() => void removePoint(point.id, point.label)}>
                <Icon name="trash" size={13} />
              </button>
            </div>

            {evs.length === 0 && <div className="m-tl-empty">(无事件)</div>}

            {evs.map((ev) => {
              const track = trackById.get(ev.trackId);
              const open = openId === ev.id;
              const cast = (ev.entityIds ?? []).map((id) => entityById.get(id)?.name).filter(Boolean);
              return (
                <div key={ev.id} className={`m-tl-event ${open ? 'open' : ''}`}>
                  {open ? (
                    <div className="m-edit">
                      <label>
                        <span>事件标题</span>
                        <input value={ev.title} onChange={(e) => patchEvent(ev.id, { title: e.target.value })} />
                      </label>
                      <label>
                        <span>描述</span>
                        <textarea rows={3} value={ev.text} onChange={(e) => patchEvent(ev.id, { text: e.target.value })} />
                      </label>
                      <label>
                        <span>轨道</span>
                        <select value={ev.trackId} onChange={(e) => patchEvent(ev.id, { trackId: e.target.value })}>
                          {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </label>
                      <div className="m-edit-foot">
                        <button className="ghost m-del" onClick={() => void removeEvent(ev)}>删除事件</button>
                        <span style={{ flex: 1 }} />
                        <button className="ghost" onClick={() => setOpenId(null)}>收起</button>
                      </div>
                    </div>
                  ) : (
                    <button className="m-tl-event-btn" onClick={() => setOpenId(ev.id)}>
                      <span className="m-tl-event-head">
                        {track && (
                          <span className="m-tl-track" style={{ background: track.color, color: readableInk(track.color) }}>{track.name}</span>
                        )}
                        <strong>{ev.title || '未命名事件'}</strong>
                      </span>
                      {ev.text && <span className="m-tl-text">{ev.text}</span>}
                      {cast.length > 0 && <span className="m-tl-cast">{cast.join(' · ')}</span>}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {points.length > 0 && grouped.length === 0 && <div className="hint">没有匹配的事件。</div>}
      </div>
    </>
  );
}
