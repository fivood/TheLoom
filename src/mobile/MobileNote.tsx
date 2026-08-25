import { useMemo, useState } from 'react';
import { confirmDialog } from '../dialog';
import {
  addIdea, editIdea, loadInbox, removeIdea, saveInbox, visibleIdeas, type IdeaCard, markUsed,
} from '../inbox';
import Icon from '../components/Icon';
import ThemeToggle from '../components/ThemeToggle';
import { uid, useLoom } from '../store';
import type { Document } from '../types';

export default function MobileNote({ onOpenWrite }: { onOpenWrite?: () => void }) {
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
    commit(addIdea(cards, draft.trim()));
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

  const convertToScene = (c: IdeaCard) => {
    const title = c.text.split('\n')[0].trim().slice(0, 20) || '灵感场景';
    const d: Document = {
      id: uid(),
      name: title,
      category: useLoom.getState().project.documentCategories[0] ?? '未分类',
      blocks: [{ id: uid(), type: 'paragraph', text: c.text, flowRole: 'none' }],
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    useLoom.getState().addDocument(d);
    const p = useLoom.getState().project;
    const next = markUsed(cards, c.id, useLoom.getState().currentSlotId, p.name || '未命名项目');
    commit(next);
    try { localStorage.setItem(`theloom-mobile-last-doc:${useLoom.getState().currentSlotId}`, d.id); } catch { /* 忽略 */ }
    onOpenWrite?.();
  };

  const copyText = (text: string) => {
    try {
      navigator.clipboard.writeText(text);
    } catch { /* 忽略 */ }
  };

  const visibleCount = visibleIdeas(cards).length;

  return (
    <div className="m-note">
      {/* 极简顶栏 */}
      <div className="m-clean-topbar">
        <div className="m-top-title-wrap">
          <Icon name="bulb" size={17} />
          <span className="m-top-title">灵感快记</span>
          <span className="m-top-badge">{visibleCount}</span>
        </div>
        <ThemeToggle />
      </div>

      {/* 秒开即写无边框输入区 */}
      <div className="m-note-capture-card">
        <textarea
          className="m-note-textarea"
          value={draft}
          rows={3}
          placeholder="记下一个想法、一句台词、一个情节…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              capture();
            }
          }}
        />
        <div className="m-note-capture-foot">
          <span className="m-note-tip">跨项目存储 · 手机与桌面同步</span>
          <button className="primary m-note-submit" disabled={!draft.trim()} onClick={capture}>
            记下
          </button>
        </div>
      </div>

      {/* 灵感便签流 */}
      <div className="m-note-list">
        {visibleCount > 5 && (
          <div className="m-note-search-wrap">
            <input
              className="m-note-search"
              value={query}
              placeholder="搜索灵感…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
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
              <div
                className="m-note-text"
                title="点击修改"
                onClick={() => { setEditingId(c.id); setEditText(c.text); }}
              >
                {c.text}
                {c.usedIn?.length ? (
                  <span className="m-idea-used">已用于 {c.usedIn.map((u) => u.projectName).join('、')}</span>
                ) : null}
              </div>
              <div className="m-note-actions">
                <button
                  className="ghost icon-btn"
                  title="转为正文场景"
                  onClick={() => convertToScene(c)}
                >
                  <Icon name="doc" size={13} />
                  <span>写成场景</span>
                </button>
                <button
                  className="ghost icon-btn"
                  title="复制文字"
                  onClick={() => copyText(c.text)}
                >
                  <Icon name="copy" size={13} />
                </button>
                <button
                  className="ghost icon-btn m-del"
                  title="删除"
                  aria-label="删除"
                  onClick={() => void onRemove(c)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </div>
          )
        ))}
        {visibleCount > 0 && list.length === 0 && <div className="hint" style={{ textAlign: 'center', padding: 20 }}>没有匹配的想法</div>}
        {visibleCount === 0 && (
          <div className="hint" style={{ textAlign: 'center', padding: '36px 20px' }}>
            还没有灵感。这里记下的点子不属于任何项目，可以在写作时随时插进场景，或点击「写成场景」直接开篇。
          </div>
        )}
      </div>
    </div>
  );
}
