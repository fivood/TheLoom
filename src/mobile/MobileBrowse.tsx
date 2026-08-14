import { useMemo, useState } from 'react';
import { useLoom } from '../store';
import Icon from '../components/Icon';
import { readableInk } from '../theme';
import type { OutlineRow, TimelineEvent } from '../types';

type View = 'outline' | 'timeline';

/**
 * 移动端查阅:大纲与时间线的竖排只读视图。
 *
 * 桌面端这两个模块都是宽表格(大纲 = 章节 × 剧情线,时间线 = 轨道 × 时间点),
 * 在手机上横着看没有意义。这里把它们**按主轴展开成竖排**:
 * 大纲以章节为单位,把各剧情线折进章节卡片;时间线以时间点为单位,把各轨道的事件折进去。
 * 编辑仍在桌面端 —— 这里解决的是「写到一半想查下一章该写什么」。
 */
export default function MobileBrowse() {
  const [view, setView] = useState<View>('outline');

  return (
    <div className="m-browse">
      <div className="m-seg">
        <button className={view === 'outline' ? 'on' : ''} onClick={() => setView('outline')}>
          <Icon name="grid" size={14} /> 大纲
        </button>
        <button className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>
          <Icon name="clock" size={14} /> 时间线
        </button>
      </div>
      {view === 'outline' ? <OutlineList /> : <TimelineList />}
    </div>
  );
}

function OutlineList() {
  const rows = useLoom((s) => s.project.outlineRows);
  const columns = useLoom((s) => s.project.outlineColumns);
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const hit = (r: OutlineRow) =>
      [r.no, r.time, r.title, r.main, ...Object.values(r.cells ?? {})]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    return rows.filter(hit);
  }, [rows, query]);

  if (rows.length === 0) {
    return <div className="hint">还没有大纲。在桌面端「大纲」模块里按章节 × 剧情线填好后,这里可以随时查阅。</div>;
  }

  return (
    <>
      {rows.length > 6 && (
        <input
          className="m-browse-search"
          value={query}
          placeholder="搜索章节 / 剧情…"
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="m-outline-list">
        {visible.map((r) => {
          // 只展示填了内容的剧情线,否则手机上全是空标签
          const filled = columns.filter((c) => (r.cells?.[c.id] ?? '').trim());
          return (
            <div key={r.id} className="m-outline-row">
              <div className="m-outline-head">
                {r.no && <span className="m-outline-no">{r.no}</span>}
                <strong>{r.title || '未命名章节'}</strong>
                {r.time && <span className="m-outline-time">{r.time}</span>}
              </div>
              {r.main && <p className="m-outline-main">{r.main}</p>}
              {filled.map((c) => (
                <div key={c.id} className="m-outline-cell">
                  <span className="m-outline-col" style={{ background: c.color, color: readableInk(c.color) }}>{c.title}</span>
                  <span>{r.cells[c.id]}</span>
                </div>
              ))}
            </div>
          );
        })}
        {visible.length === 0 && <div className="hint">没有匹配的章节。</div>}
      </div>
    </>
  );
}

function TimelineList() {
  const points = useLoom((s) => s.project.timelinePoints);
  const tracks = useLoom((s) => s.project.timelineTracks);
  const events = useLoom((s) => s.project.timelineEvents);
  const entities = useLoom((s) => s.project.entities);
  const [query, setQuery] = useState('');

  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  // 按时间点分组:时间点顺序就是作者在桌面端排好的故事顺序
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

  if (points.length === 0) {
    return <div className="hint">还没有时间线。在桌面端「时间线」模块里建时间点与事件后,这里可以按故事时间顺序查阅。</div>;
  }

  return (
    <>
      {events.length > 6 && (
        <input
          className="m-browse-search"
          value={query}
          placeholder="搜索事件…"
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="m-tl-list">
        {grouped.map(({ point, events: evs }) => (
          <div key={point.id} className="m-tl-point">
            <div className="m-tl-label">{point.label || '未命名时间点'}</div>
            {evs.length === 0 && <div className="m-tl-empty">(无事件)</div>}
            {evs.map((ev) => {
              const track = trackById.get(ev.trackId);
              const cast = (ev.entityIds ?? []).map((id) => entityById.get(id)?.name).filter(Boolean);
              return (
                <div key={ev.id} className="m-tl-event">
                  <div className="m-tl-event-head">
                    {track && (
                      <span className="m-tl-track" style={{ background: track.color, color: readableInk(track.color) }}>{track.name}</span>
                    )}
                    <strong>{ev.title || '未命名事件'}</strong>
                  </div>
                  {ev.text && <p className="m-tl-text">{ev.text}</p>}
                  {cast.length > 0 && <div className="m-tl-cast">{cast.join(' · ')}</div>}
                </div>
              );
            })}
          </div>
        ))}
        {grouped.length === 0 && <div className="hint">没有匹配的事件。</div>}
      </div>
    </>
  );
}
