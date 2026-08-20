import { useEffect, useMemo, useState } from 'react';
import { uid, useLoom } from '../store';
import { documentWordCount, folderPath, linearizeByFolders } from '../util';
import { dailyStatValue, writingDateKey, writingStreak } from '../writingProgress';
import type { Document } from '../types';
import BlocksEditor, { emptyBlock } from '../modules/document/BlocksEditor';
import Icon from '../components/Icon';
import { loadInbox, markUsed, saveInbox, visibleIdeas, type IdeaCard } from '../inbox';

/** 按槽位记:多项目共用一个 key 会在切项目后把别的作品的场景记串 */
function lastDocKey(): string {
  return `theloom-mobile-last-doc:${useLoom.getState().currentSlotId}`;
}

function readLastDocId(): string | null {
  try { return localStorage.getItem(lastDocKey()); } catch { return null; }
}

/** 上次写的场景 → 最近改过的场景;都不在了返回 null */
function pickFallbackId(documents: Document[]): string | null {
  const saved = readLastDocId();
  if (saved && documents.some((d) => d.id === saved)) return saved;
  return [...documents].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
}

/** 移动端写作:冷启动直达上次的场景,专注写作,可在场景间切换 */
export default function MobileWrite() {
  const documents = useLoom((s) => s.project.documents);
  const folders = useLoom((s) => s.project.folders);
  const categories = useLoom((s) => s.project.documentCategories);
  const progress = useLoom((s) => s.project.writingProgress);
  const currentSlotId = useLoom((s) => s.currentSlotId);
  const addDocument = useLoom((s) => s.addDocument);
  const updateDocument = useLoom((s) => s.updateDocument);
  const [selectedId, setSelectedId] = useState<string | null>(() => pickFallbackId(documents));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [inbox, setInbox] = useState<IdeaCard[]>(loadInbox);

  const doc = documents.find((d) => d.id === selectedId) ?? null;

  // 选中的场景不存在时重新归位:载入示例 / 切换项目 / 删除当前场景后
  // documents 才到位,只在挂载时初始化会永远停在「未选择场景」
  useEffect(() => {
    if (doc || documents.length === 0) return;
    setSelectedId(pickFallbackId(documents));
  }, [doc, documents, currentSlotId]);

  useEffect(() => {
    try { if (doc) localStorage.setItem(lastDocKey(), doc.id); } catch { /* 忽略 */ }
  }, [doc?.id]);

  // 按卷 / 章树序排,而不是按修改时间 —— 后者会让当前场景在打字时不断跳到列表顶
  const ordered = useMemo(
    () => linearizeByFolders(documents, folders, 'document'),
    [documents, folders],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((d) =>
      d.name.toLowerCase().includes(q)
      || folderPath(d.folderId, folders).toLowerCase().includes(q));
  }, [ordered, query, folders]);

  // 今日新增与连续天数:writingProgress 一直在记录,只是移动端从来没接出来
  const stats = useMemo(() => {
    const mode = progress?.countMode ?? 'characters';
    const bodyOnly = progress?.bodyOnly ?? false;
    return {
      today: dailyStatValue(progress?.daily?.find((s) => s.date === writingDateKey()), mode, bodyOnly),
      streak: writingStreak(progress, mode, bodyOnly),
    };
  }, [progress]);

  const index = doc ? ordered.findIndex((d) => d.id === doc.id) : -1;
  const prevDoc = index > 0 ? ordered[index - 1] : null;
  const nextDoc = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  const chapter = doc ? folderPath(doc.folderId, folders) : '';

  const recentIdeas = useMemo(() => visibleIdeas(inbox).slice(0, 12), [inbox]);

  /**
   * 把一条灵感插进当前场景末尾。灵感库是跨项目的,所以插入后记一笔去向
   * (标记「已用于本项目」),但**不删卡片** —— 同一个点子可能还要用在别处。
   */
  const insertIdea = (card: IdeaCard) => {
    if (!doc) return;
    updateDocument(doc.id, (d) => {
      const block = emptyBlock('paragraph');
      block.text = card.text;
      d.blocks.push(block);
    });
    const p = useLoom.getState().project;
    const next = markUsed(inbox, card.id, useLoom.getState().currentSlotId, p.name || '未命名项目');
    setInbox(next);
    saveInbox(next);
    setIdeasOpen(false);
  };

  const createScene = () => {
    const d: Document = {
      id: uid(),
      name: '新场景',
      category: categories[0] ?? '未分类',
      blocks: [emptyBlock('paragraph')],
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addDocument(d);
    setSelectedId(d.id);
    setPickerOpen(false);
  };

  return (
    <div className="m-write">
      <div className="m-write-head">
        <button className="m-doc-picker" onClick={() => setPickerOpen((o) => !o)} title="切换场景">
          <Icon name="chevronDown" size={14} />
          <span className="m-doc-main">
            <span className="m-doc-name">{doc ? doc.name : '未选择场景'}</span>
            {chapter && <span className="m-doc-chapter">{chapter}</span>}
          </span>
          {doc && <span className="m-doc-words">{documentWordCount(doc)}字</span>}
        </button>
        <button className="ghost icon-btn" onClick={createScene} title="新建场景" aria-label="新建场景">
          <Icon name="plus" size={16} />
        </button>
      </div>

      {doc && (
        <div className="m-write-bar">
          <button
            className="ghost icon-btn"
            disabled={!prevDoc}
            title={prevDoc ? `上一场:${prevDoc.name}` : '已是第一场'}
            aria-label="上一场"
            onClick={() => prevDoc && setSelectedId(prevDoc.id)}
          >‹</button>
          <button
            className="ghost icon-btn"
            disabled={!nextDoc}
            title={nextDoc ? `下一场:${nextDoc.name}` : '已是最后一场'}
            aria-label="下一场"
            onClick={() => nextDoc && setSelectedId(nextDoc.id)}
          >›</button>
          <span className="m-write-progress">
            今日 <strong>{stats.today}</strong>
            {stats.streak > 0 && <> · 连续 <strong>{stats.streak}</strong> 天</>}
          </span>
          <button
            className={`ghost m-idea-btn ${ideasOpen ? 'on' : ''}`}
            onClick={() => setIdeasOpen((o) => !o)}
            disabled={recentIdeas.length === 0}
            title="灵感抽屉"
          >灵感 {recentIdeas.length}</button>
        </div>
      )}

      {ideasOpen && doc && (
        <div className="m-idea-drawer">
          <div className="m-section-label">点一条插到这一场末尾</div>
          {recentIdeas.map((n) => (
            <button key={n.id} className="m-idea-item" onClick={() => insertIdea(n)}>
              {n.text}
            </button>
          ))}
        </div>
      )}
      {pickerOpen && (
        <div className="m-doc-list">
          {ordered.length > 8 && (
            <input
              className="m-doc-search"
              value={query}
              placeholder="搜索场景 / 章节…"
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {visible.map((d) => {
            const path = folderPath(d.folderId, folders);
            return (
              <button
                key={d.id}
                className={`m-doc-item ${d.id === selectedId ? 'on' : ''}`}
                onClick={() => { setSelectedId(d.id); setPickerOpen(false); setQuery(''); }}
              >
                <span className="m-doc-item-main">
                  <span className="m-doc-item-name">{d.name}</span>
                  {path && <span className="m-doc-item-path">{path}</span>}
                </span>
                <span className="m-doc-item-words">{documentWordCount(d)}字</span>
              </button>
            );
          })}
          {visible.length === 0 && <div className="hint" style={{ padding: '10px 12px' }}>没有匹配的场景。</div>}
          <button className="m-doc-item m-doc-new" onClick={createScene}>＋ 新建场景</button>
        </div>
      )}
      {doc ? (
        <div className="m-write-editor">
          <BlocksEditor doc={doc} variant="focus" />
        </div>
      ) : (
        <div className="m-empty">
          <p>还没有场景。写下第一个片段,碎片时间也能往前推一点。</p>
          <button className="primary" onClick={createScene}>写第一个场景</button>
        </div>
      )}
    </div>
  );
}
