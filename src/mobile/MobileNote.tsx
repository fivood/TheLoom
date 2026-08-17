import { useMemo, useState } from 'react';
import { confirmDialog } from '../dialog';
import {
  addIdea, editIdea, loadInbox, removeIdea, saveInbox, visibleIdeas, type IdeaCard,
} from '../inbox';
import Icon from '../components/Icon';

/**
 * 移动端快记:零摩擦捕获想法。
 *
 * 写进**跨项目的灵感库**,而不是当前项目的风暴板 —— 点子产生时往往还不知道
 * 属于哪部作品,塞进当前项目等于替你做了一个可能错的归属决定。
 * 到桌面端再从灵感库「取用」到具体项目(转为便签 / 场景 / 大纲行)。
 */
export default function MobileNote() {
  const [cards, setCards] = useState<IdeaCard[]>(loadInbox);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const commit = (next: IdeaCard[]) => { setCards(next); saveInbox(next); };

  const list = useMemo(() => {
    const all = visibleIdeas(cards);
    const q = query.trim().toLowerCase();
    return q ? all.filter((c) => c.text.toLowerCase().includes(q)) : all;
  }, [cards, query]);

  const capture = () => {
    if (!draft.trim()) return;
    commit(addIdea(cards, draft));
    setDraft('');
  };

  const onRemove = async (c: IdeaCard) => {
    const ok = await confirmDialog({
      title: '删除这条灵感?',
      message: c.text.length > 40 ? `${c.text.slice(0, 40)}…` : c.text,
      danger: true,
    });
    if (ok) commit(removeIdea(cards, c.id));
  };

  const visibleCount = visibleIdeas(cards).length;

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
        <div className="m-section-label">灵感库({visibleCount})· 跨项目</div>
        {visibleCount > 6 && (
          <input
            className="m-note-search"
            value={query}
            placeholder="搜索想法…"
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {list.map((c) => (
          editingId === c.id ? (
            <div key={c.id} className="m-note-edit">
              <textarea value={editText} rows={3} autoFocus onChange={(e) => setEditText(e.target.value)} />
              <div className="m-note-edit-row">
                <button className="ghost" onClick={() => setEditingId(null)}>取消</button>
                <button
                  className="primary"
                  onClick={() => { commit(editIdea(cards, c.id, editText)); setEditingId(null); }}
                >保存</button>
              </div>
            </div>
          ) : (
            <div key={c.id} className="m-note-item">
              <button
                className="m-note-text"
                title="点击修改"
                onClick={() => { setEditingId(c.id); setEditText(c.text); }}
              >
                {c.text}
                {c.usedIn?.length ? (
                  <span className="m-idea-used">已用于 {c.usedIn.map((u) => u.projectName).join('、')}</span>
                ) : null}
              </button>
              <button
                className="ghost icon-btn m-note-del"
                aria-label="删除"
                onClick={() => void onRemove(c)}
              ><Icon name="trash" size={14} /></button>
            </div>
          )
        ))}
        {visibleCount > 0 && list.length === 0 && <div className="hint">没有匹配的想法。</div>}
        {visibleCount === 0 && (
          <div className="hint">
            还没有灵感。这里记的点子不属于任何项目,到桌面端可以取用到某部作品里。
          </div>
        )}
      </div>
    </div>
  );
}
