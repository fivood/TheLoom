import { useEffect, useMemo, useState } from 'react';
import { uid, useLoom } from '../../store';
import { useNav } from '../../search';
import { confirmDialog, promptText } from '../../dialog';
import Icon from '../../components/Icon';
import AttachmentEditor from '../../components/AttachmentEditor';
import type { ResearchCard } from '../../types';
import { PALETTE } from '../../types';
import { activePaletteColors } from '../../util';
import ColorPicker from '../../components/ColorPicker';
import NavigatorTree, { FolderSelect } from '../../components/NavigatorTree';

export default function ResearchCards() {
  const cards = useLoom((s) => s.project.researchCards);
  const categories = useLoom((s) => s.project.researchCategories);
  const { addCard, updateCard, removeCard, update } = useLoom();
  const [catFilter, setCatFilter] = useState<string | 'all'>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const navSeq = useNav((s) => s.seq);
  useEffect(() => {
    const t = useNav.getState().target;
    if (t?.tab === 'research' && t.cardId) {
      setCatFilter('all');
      setTagFilter(null);
      setQuery('');
      setSelectedId(t.cardId);
      useNav.getState().clear();
    }
  }, [navSeq]);

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
    const cols = activePaletteColors(useLoom.getState().project);
    const c: ResearchCard = {
      id: uid(), title: '新资料卡片', content: '',
      folderId: selected?.folderId,
      category: catFilter === 'all' ? (categories[0] ?? '未分类') : catFilter,
      tags: [], color: cols[cards.length % cols.length] ?? PALETTE[0],
      source: '', pinned: false, createdAt: Date.now(),
    };
    addCard(c);
    setSelectedId(c.id);
  };

  const addCategory = async () => {
    const name = await promptText({ message: '新分类名称(例如:世界观 / 人物原型 / 地理 / 历史考据)', placeholder: '分类名称' });
    if (!name) return;
    update((p) => { if (!p.researchCategories.includes(name)) p.researchCategories.push(name); });
    setCatFilter(name);
  };

  const removeCategory = async (name: string) => {
    const used = cards.filter((c) => c.category === name).length;
    if (!await confirmDialog({
      message: used > 0 ? `分类「${name}」下有 ${used} 张卡片,删除后它们将变为「未分类」。继续?` : `删除分类「${name}」?`,
      danger: true,
      confirmText: '删除',
    })) return;
    update((p) => {
      p.researchCategories = p.researchCategories.filter((c) => c !== name);
      for (const c of p.researchCards) if (c.category === name) c.category = '未分类';
    });
    if (catFilter === name) setCatFilter('all');
  };

  return (
    <>
      <NavigatorTree
        module="research"
        title="资料"
        items={filtered}
        selectedId={selectedId}
        getLabel={(card) => card.title}
        getDetail={(card) => card.pinned ? '置顶' : card.category}
        onSelect={setSelectedId}
        onMove={(id, folderId) => updateCard(id, { folderId })}
        onMoveMany={(ids, folderId) => update((p) => {
          const set = new Set(ids);
          for (const c of p.researchCards) if (set.has(c.id)) { c.folderId = folderId; delete c.order; }
        })}
        onReorder={(_parentId, orderedIds) => update((p) => {
          const map = new Map(orderedIds.map((id, i) => [id, i]));
          for (const c of p.researchCards) if (map.has(c.id)) c.order = map.get(c.id);
        })}
        onCreate={createCard}
        createLabel="新建资料卡"
        emptyLabel="还没有资料卡"
      />

      <div className="pane-col">
        <div className="toolbar">
          <button className="primary" onClick={createCard}>＋ 新卡片</button>
          <select value={catFilter} onChange={(event) => setCatFilter(event.target.value)} style={{ width: 120 }}>
            <option value="all">全部分类</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <button className="ghost icon-btn" onClick={addCategory} title="新建分类">＋</button>
          {catFilter !== 'all' && <button className="ghost icon-btn" onClick={() => removeCategory(catFilter)} title="删除当前分类">×</button>}
          {allTags.length > 0 && (
            <select value={tagFilter ?? ''} onChange={(event) => setTagFilter(event.target.value || null)} style={{ width: 120 }}>
              <option value="">全部标签</option>
              {allTags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
            </select>
          )}
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
                {c.pinned && <span className="pin"><Icon name="pin" size={13} /></span>}
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
              <label>文件夹</label>
              <FolderSelect module="research" value={selected.folderId} onChange={(folderId) => updateCard(selected.id, { folderId })} />
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
              <ColorPicker
                value={selected.color}
                onChange={(c) => updateCard(selected.id, { color: c ?? PALETTE[0] })}
                allowClear={false}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => updateCard(selected.id, { pinned: !selected.pinned })}>
                <Icon name="pin" size={13} /> {selected.pinned ? '取消置顶' : '置顶'}
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (await confirmDialog({ message: `删除卡片「${selected.title}」?`, danger: true, confirmText: '删除' })) {
                    removeCard(selected.id);
                    setSelectedId(null);
                  }
                }}
              >删除</button>
            </div>
            <AttachmentEditor ownerId={selected.id} />
          </>
        ) : (
          <div className="empty-hint">点击卡片查看和编辑<br /><br />左侧可按分类和标签筛选</div>
        )}
      </aside>
    </>
  );
}
