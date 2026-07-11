import { useMemo, useState } from 'react';
import { uid, useLoom } from '../../store';
import type { ResearchCard } from '../../types';
import { PALETTE } from '../../types';

export default function ResearchCards() {
  const cards = useLoom((s) => s.project.researchCards);
  const categories = useLoom((s) => s.project.researchCategories);
  const { addCard, updateCard, removeCard, update } = useLoom();

  const [catFilter, setCatFilter] = useState<string | 'all'>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) for (const t of c.tags) set.add(t);
    return [...set].sort();
  }, [cards]);

  const filtered = useMemo(() => {
    const list = cards.filter((c) =>
      (catFilter === 'all' || c.category === catFilter) &&
      (!tagFilter || c.tags.includes(tagFilter)) &&
      (!query || c.title.includes(query) || c.content.includes(query) || c.tags.some((t) => t.includes(query))),
    );
    return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
  }, [cards, catFilter, tagFilter, query]);

  const selected = cards.find((c) => c.id === selectedId) ?? null;

  const createCard = () => {
    const c: ResearchCard = {
      id: uid(), title: '新资料卡片', content: '',
      category: catFilter === 'all' ? (categories[0] ?? '未分类') : catFilter,
      tags: [], color: PALETTE[cards.length % PALETTE.length],
      source: '', pinned: false, createdAt: Date.now(),
    };
    addCard(c);
    setSelectedId(c.id);
  };

  const addCategory = () => {
    const name = prompt('新分类名称(例如:世界观 / 人物原型 / 地理 / 历史考据)');
    if (!name) return;
    update((p) => { if (!p.researchCategories.includes(name)) p.researchCategories.push(name); });
    setCatFilter(name);
  };

  const removeCategory = (name: string) => {
    const used = cards.filter((c) => c.category === name).length;
    if (!confirm(used > 0 ? `分类「${name}」下有 ${used} 张卡片,删除后它们将变为「未分类」。继续?` : `删除分类「${name}」?`)) return;
    update((p) => {
      p.researchCategories = p.researchCategories.filter((c) => c !== name);
      for (const c of p.researchCards) if (c.category === name) c.category = '未分类';
    });
    if (catFilter === name) setCatFilter('all');
  };

  return (
    <>
      <div className="side-list">
        <div className="side-head">
          <span>分类</span>
          <button className="ghost icon-btn" onClick={addCategory} title="新建分类">＋</button>
        </div>
        <div className="items">
          <div className={`side-item ${catFilter === 'all' ? 'active' : ''}`} onClick={() => setCatFilter('all')}>
            全部 <span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>{cards.length}</span>
          </div>
          {categories.map((cat) => (
            <div key={cat} className={`side-item ${catFilter === cat ? 'active' : ''}`} onClick={() => setCatFilter(cat)}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
              <span style={{ color: 'var(--text-faint)' }}>{cards.filter((c) => c.category === cat).length}</span>
              <button className="ghost icon-btn" onClick={(e) => { e.stopPropagation(); removeCategory(cat); }}>×</button>
            </div>
          ))}
          {allTags.length > 0 && (
            <>
              <div className="side-head" style={{ borderTop: '1px solid var(--border)', marginTop: 8 }}><span>标签</span></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 4px' }}>
                {allTags.map((t) => (
                  <span
                    key={t}
                    className={`tag clickable ${tagFilter === t ? 'active' : ''}`}
                    onClick={() => setTagFilter(tagFilter === t ? null : t)}
                  >#{t}</span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="pane-col">
        <div className="toolbar">
          <button className="primary" onClick={createCard}>＋ 新卡片</button>
          <input placeholder="搜索标题、内容或标签…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 240 }} />
          {tagFilter && <span className="tag active clickable" onClick={() => setTagFilter(null)}>#{tagFilter} ×</span>}
          <span className="hint">动笔前把设定、考据、灵感来源都归档到这里</span>
        </div>
        <div className="card-grid">
          {filtered.map((c) => (
            <div
              key={c.id}
              className={`info-card ${selectedId === c.id ? 'selected' : ''}`}
              style={{ borderTopColor: c.color }}
              onClick={() => setSelectedId(c.id)}
            >
              <div className="card-title">
                <span>{c.title}</span>
                {c.pinned && <span className="pin">📌</span>}
              </div>
              <div className="card-body">{c.content || '(空白卡片)'}</div>
              <div className="card-tags">
                <span className="tag" style={{ background: `${c.color}26`, color: c.color }}>{c.category}</span>
                {c.tags.map((t) => <span key={t} className="tag">#{t}</span>)}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="empty-hint" style={{ gridColumn: '1/-1' }}>没有匹配的卡片</div>}
        </div>
      </div>

      <aside className="inspector">
        {selected ? (
          <>
            <h3>卡片内容</h3>
            <div className="field">
              <label>标题</label>
              <input value={selected.title} onChange={(e) => updateCard(selected.id, { title: e.target.value })} />
            </div>
            <div className="field">
              <label>正文</label>
              <textarea rows={10} value={selected.content} onChange={(e) => updateCard(selected.id, { content: e.target.value })} />
            </div>
            <div className="field">
              <label>分类</label>
              <select value={selected.category} onChange={(e) => updateCard(selected.id, { category: e.target.value })}>
                {!categories.includes(selected.category) && <option value={selected.category}>{selected.category}</option>}
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label>标签(用逗号分隔)</label>
              <input
                value={selected.tags.join(', ')}
                onChange={(e) => updateCard(selected.id, {
                  tags: e.target.value.split(/[,,]/).map((t) => t.trim()).filter(Boolean),
                })}
                placeholder="例如:核心设定, 考据"
              />
            </div>
            <div className="field">
              <label>来源 / 出处</label>
              <input value={selected.source} onChange={(e) => updateCard(selected.id, { source: e.target.value })} placeholder="书名、链接、访谈…" />
            </div>
            <div className="field">
              <label>颜色</label>
              <div className="color-row">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    className={`color-swatch ${selected.color === c ? 'selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => updateCard(selected.id, { color: c })}
                  />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => updateCard(selected.id, { pinned: !selected.pinned })}>
                {selected.pinned ? '取消置顶' : '📌 置顶'}
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm(`删除卡片「${selected.title}」?`)) {
                    removeCard(selected.id);
                    setSelectedId(null);
                  }
                }}
              >删除</button>
            </div>
          </>
        ) : (
          <div className="empty-hint">点击卡片查看和编辑<br /><br />左侧可按分类和标签筛选</div>
        )}
      </aside>
    </>
  );
}
