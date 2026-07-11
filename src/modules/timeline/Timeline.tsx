import { useState } from 'react';
import { uid, useLoom } from '../../store';
import type { TimelineEvent } from '../../types';
import { PALETTE } from '../../types';

export default function Timeline() {
  const tracks = useLoom((s) => s.project.timelineTracks);
  const points = useLoom((s) => s.project.timelinePoints);
  const events = useLoom((s) => s.project.timelineEvents);
  const entities = useLoom((s) => s.project.entities);
  const update = useLoom((s) => s.update);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = events.find((e) => e.id === selectedId) ?? null;

  const addTrack = () => {
    const name = prompt('新轨道名称(例如:主线、某角色的暗线、世界大事)');
    if (!name) return;
    update((p) => {
      p.timelineTracks.push({ id: uid(), name, color: PALETTE[p.timelineTracks.length % PALETTE.length] });
    });
  };

  const addPoint = (afterId?: string) => {
    update((p) => {
      const pt = { id: uid(), label: '新时间点' };
      const i = afterId ? p.timelinePoints.findIndex((x) => x.id === afterId) : -1;
      if (i >= 0) p.timelinePoints.splice(i + 1, 0, pt);
      else p.timelinePoints.push(pt);
    });
  };

  const movePoint = (id: string, dir: -1 | 1) => {
    update((p) => {
      const i = p.timelinePoints.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.timelinePoints.length) return;
      const [pt] = p.timelinePoints.splice(i, 1);
      p.timelinePoints.splice(j, 0, pt);
    });
  };

  const removePoint = (id: string) => {
    const used = events.filter((e) => e.pointId === id).length;
    if (!confirm(used > 0 ? `该时间点上有 ${used} 个事件,将一并删除。继续?` : '删除该时间点?')) return;
    update((p) => {
      p.timelinePoints = p.timelinePoints.filter((x) => x.id !== id);
      p.timelineEvents = p.timelineEvents.filter((e) => e.pointId !== id);
    });
    setSelectedId(null);
  };

  const moveTrack = (id: string, dir: -1 | 1) => {
    update((p) => {
      const i = p.timelineTracks.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.timelineTracks.length) return;
      const [t] = p.timelineTracks.splice(i, 1);
      p.timelineTracks.splice(j, 0, t);
    });
  };

  const removeTrack = (id: string, name: string) => {
    const used = events.filter((e) => e.trackId === id).length;
    if (!confirm(used > 0 ? `轨道「${name}」上有 ${used} 个事件,将一并删除。继续?` : `删除轨道「${name}」?`)) return;
    update((p) => {
      p.timelineTracks = p.timelineTracks.filter((x) => x.id !== id);
      p.timelineEvents = p.timelineEvents.filter((e) => e.trackId !== id);
    });
    setSelectedId(null);
  };

  const addEvent = (trackId: string, pointId: string) => {
    const ev: TimelineEvent = { id: uid(), trackId, pointId, title: '新事件', text: '', entityIds: [] };
    update((p) => { p.timelineEvents.push(ev); });
    setSelectedId(ev.id);
  };

  const patchEvent = (id: string, patch: Partial<TimelineEvent>) => {
    update((p) => {
      const e = p.timelineEvents.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
    });
  };

  const removeEvent = (id: string) => {
    update((p) => { p.timelineEvents = p.timelineEvents.filter((x) => x.id !== id); });
    setSelectedId(null);
  };

  return (
    <>
      <div className="pane-col">
        <div className="toolbar">
          <button className="primary" onClick={() => addPoint()}>＋ 时间点(列)</button>
          <button onClick={addTrack}>＋ 轨道(行)</button>
          <span className="hint">按故事时间排布事件——每行一条线索的轨道,每列一个时间点;与大纲(叙述顺序)互补</span>
        </div>

        <div className="timeline-wrap">
          {points.length === 0 && tracks.length === 0 ? (
            <div className="empty-hint">
              先添加一条轨道和一个时间点。<br />
              轨道 = 谁的线(主线、暗线、世界大事);时间点 = 故事里的时刻(可以写"三年前""雨夜")。
            </div>
          ) : (
            <table className="timeline-table">
              <thead>
                <tr>
                  <th className="tl-corner"></th>
                  {points.map((pt, i) => (
                    <th key={pt.id}>
                      <div className="tl-point">
                        <div className="tl-point-tools">
                          <button className="ghost icon-btn" disabled={i === 0} onClick={() => movePoint(pt.id, -1)} title="左移">←</button>
                          <button className="ghost icon-btn" disabled={i === points.length - 1} onClick={() => movePoint(pt.id, 1)} title="右移">→</button>
                          <button className="ghost icon-btn" onClick={() => addPoint(pt.id)} title="在右侧插入时间点">＋</button>
                          <button className="ghost icon-btn" onClick={() => removePoint(pt.id)} title="删除时间点">×</button>
                        </div>
                        <input
                          value={pt.label}
                          onChange={(e) => update((p) => {
                            const x = p.timelinePoints.find((y) => y.id === pt.id);
                            if (x) x.label = e.target.value;
                          })}
                        />
                        <div className="tl-axis"><span className="tl-dot" /></div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tracks.map((tr, ti) => (
                  <tr key={tr.id}>
                    <th className="tl-track" style={{ borderLeft: `3px solid ${tr.color}` }}>
                      <input
                        value={tr.name}
                        onChange={(e) => update((p) => {
                          const x = p.timelineTracks.find((y) => y.id === tr.id);
                          if (x) x.name = e.target.value;
                        })}
                      />
                      <div className="tl-point-tools">
                        <button className="ghost icon-btn" disabled={ti === 0} onClick={() => moveTrack(tr.id, -1)} title="上移">↑</button>
                        <button className="ghost icon-btn" disabled={ti === tracks.length - 1} onClick={() => moveTrack(tr.id, 1)} title="下移">↓</button>
                        <button className="ghost icon-btn" onClick={() => removeTrack(tr.id, tr.name)} title="删除轨道">×</button>
                      </div>
                    </th>
                    {points.map((pt) => {
                      const cellEvents = events.filter((e) => e.trackId === tr.id && e.pointId === pt.id);
                      return (
                        <td key={pt.id} className="tl-cell">
                          {cellEvents.map((ev) => (
                            <div
                              key={ev.id}
                              className={`tl-event ${selectedId === ev.id ? 'selected' : ''}`}
                              style={{ borderLeftColor: ev.color || tr.color }}
                              onClick={() => setSelectedId(ev.id)}
                            >
                              <div className="tl-event-title">{ev.title || '(未命名)'}</div>
                              {ev.text && <div className="tl-event-text">{ev.text}</div>}
                              {ev.entityIds.length > 0 && (
                                <div className="card-tags">
                                  {ev.entityIds.map((eid) => {
                                    const ent = entities.find((x) => x.id === eid);
                                    return ent ? (
                                      <span key={eid} className="tag" style={{ color: ent.color }}>{ent.emoji} {ent.name}</span>
                                    ) : null;
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                          <button className="ghost tl-add" onClick={() => addEvent(tr.id, pt.id)}>＋</button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <aside className="inspector">
        {selected ? (
          <>
            <h3>事件属性</h3>
            <div className="field">
              <label>标题</label>
              <input value={selected.title} onChange={(e) => patchEvent(selected.id, { title: e.target.value })} />
            </div>
            <div className="field">
              <label>描述</label>
              <textarea rows={5} value={selected.text} onChange={(e) => patchEvent(selected.id, { text: e.target.value })} />
            </div>
            <div className="field">
              <label>时间点</label>
              <select value={selected.pointId} onChange={(e) => patchEvent(selected.id, { pointId: e.target.value })}>
                {points.map((pt) => <option key={pt.id} value={pt.id}>{pt.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>轨道</label>
              <select value={selected.trackId} onChange={(e) => patchEvent(selected.id, { trackId: e.target.value })}>
                {tracks.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>关联实体(点击切换)</label>
              <div className="card-tags">
                {entities.map((ent) => {
                  const on = selected.entityIds.includes(ent.id);
                  return (
                    <span
                      key={ent.id}
                      className={`tag clickable ${on ? 'active' : ''}`}
                      onClick={() => patchEvent(selected.id, {
                        entityIds: on
                          ? selected.entityIds.filter((x) => x !== ent.id)
                          : [...selected.entityIds, ent.id],
                      })}
                    >{ent.emoji} {ent.name}</span>
                  );
                })}
                {entities.length === 0 && <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>实体库为空</span>}
              </div>
            </div>
            <div className="field">
              <label>颜色(默认跟随轨道)</label>
              <div className="color-row">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    className={`color-swatch ${selected.color === c ? 'selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => patchEvent(selected.id, { color: selected.color === c ? undefined : c })}
                  />
                ))}
              </div>
            </div>
            <button className="danger" onClick={() => { if (confirm(`删除事件「${selected.title}」?`)) removeEvent(selected.id); }}>
              删除事件
            </button>
          </>
        ) : (
          <div className="empty-hint">
            点击事件卡查看和编辑<br /><br />
            时间线记录「故事实际发生的顺序」,<br />大纲记录「讲述的顺序」——<br />倒叙、插叙时两者对照特别有用
          </div>
        )}
      </aside>
    </>
  );
}
