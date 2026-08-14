import { useMemo, useState } from 'react';
import { uid, useLoom } from '../store';
import { nextNotePosition } from '../brainstormLayout';
import { confirmDialog } from '../dialog';
import Icon from '../components/Icon';

const NOTE_COLORS = ['#ffffff', '#f2f1ee', '#e6e4df', '#d8d6d0'];

/** 移动端快记:零摩擦捕获想法,落风暴板,可就地改写与删除 */
export default function MobileNote() {
  const notes = useLoom((s) => s.project.brainstormNotes);
  const update = useLoom((s) => s.update);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const recent = useMemo(() => [...notes].reverse(), [notes]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recent;
    return recent.filter((n) => n.text.toLowerCase().includes(q));
  }, [recent, query]);

  const capture = () => {
    const text = draft.trim();
    if (!text) return;
    const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    update((p) => {
      p.brainstormNotes.push({
        id: uid(),
        text,
        color,
        // 占格排布:连着记也不会在桌面风暴板上叠成一摞
        position: nextNotePosition(p.brainstormNotes),
      });
    });
    setDraft('');
  };

  const startEdit = (id: string, text: string) => {
    setEditingId(id);
    setEditText(text);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const text = editText.trim();
    const id = editingId;
    setEditingId(null);
    if (!text) return;
    update((p) => {
      const n = p.brainstormNotes.find((x) => x.id === id);
      if (n) n.text = text;
    });
  };

  const removeNote = async (id: string, text: string) => {
    const ok = await confirmDialog({
      title: '删除这条快记?',
      message: text.length > 40 ? `${text.slice(0, 40)}…` : text,
      danger: true,
    });
    if (!ok) return;
    update((p) => {
      p.brainstormNotes = p.brainstormNotes.filter((n) => n.id !== id);
      p.brainstormEdges = p.brainstormEdges.filter((e) => e.source !== id && e.target !== id);
    });
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
        {notes.length > 6 && (
          <input
            className="m-note-search"
            value={query}
            placeholder="搜索想法…"
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {visible.map((n) => (
          editingId === n.id ? (
            <div key={n.id} className="m-note-edit">
              <textarea
                value={editText}
                rows={3}
                autoFocus
                onChange={(e) => setEditText(e.target.value)}
              />
              <div className="m-note-edit-row">
                <button className="ghost" onClick={() => setEditingId(null)}>取消</button>
                <button className="primary" onClick={commitEdit}>保存</button>
              </div>
            </div>
          ) : (
            <div key={n.id} className="m-note-item" style={{ background: n.color }}>
              <button
                className="m-note-text"
                onClick={() => startEdit(n.id, n.text)}
                title="点击修改"
              >{n.text}</button>
              <button
                className="ghost icon-btn m-note-del"
                aria-label="删除"
                onClick={() => void removeNote(n.id, n.text)}
              ><Icon name="trash" size={14} /></button>
            </div>
          )
        ))}
        {notes.length > 0 && visible.length === 0 && <div className="hint">没有匹配的想法。</div>}
        {notes.length === 0 && (
          <div className="hint">还没有想法。写下的快记会同步到桌面端的「风暴」模块。</div>
        )}
      </div>
    </div>
  );
}
