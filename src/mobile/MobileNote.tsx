import { useMemo, useState } from 'react';
import { uid, useLoom } from '../store';

const NOTE_COLORS = ['#ffffff', '#f2f1ee', '#e6e4df', '#d8d6d0'];

/** 移动端快记:零摩擦捕获想法,落风暴板,空闲时到桌面端整理 */
export default function MobileNote() {
  const notes = useLoom((s) => s.project.brainstormNotes);
  const update = useLoom((s) => s.update);
  const [draft, setDraft] = useState('');

  const recent = useMemo(() => [...notes].reverse(), [notes]);

  const capture = () => {
    const text = draft.trim();
    if (!text) return;
    const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    update((p) => {
      p.brainstormNotes.push({
        id: uid(),
        text,
        color,
        position: { x: 80 + Math.random() * 120, y: 80 + Math.random() * 120 },
      });
    });
    setDraft('');
  };

  return (
    <div className="m-note">
      <div className="m-note-capture">
        <textarea
          value={draft}
          rows={3}
          placeholder="记下一个想法、一句台词、一个情节…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="primary" disabled={!draft.trim()} onClick={capture}>记下</button>
      </div>
      <div className="m-note-list">
        <div className="m-section-label">最近的想法({notes.length})</div>
        {recent.map((n) => (
          <div key={n.id} className="m-note-item" style={{ background: n.color }}>{n.text}</div>
        ))}
        {notes.length === 0 && (
          <div className="hint">还没有想法。写下的快记会同步到桌面端的「风暴」模块。</div>
        )}
      </div>
    </div>
  );
}
