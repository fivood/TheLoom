import { useEffect, useMemo, useState } from 'react';
import { uid, useLoom } from '../store';
import { documentWordCount, folderPath, linearizeByFolders } from '../util';
import { dailyStatValue, writingDateKey, writingStreak } from '../writingProgress';
import type { Document } from '../types';
import BlocksEditor, { emptyBlock } from '../modules/document/BlocksEditor';
import Icon from '../components/Icon';
import { confirmDialog, promptText } from '../dialog';
import { loadInbox, markUsed, saveInbox, visibleIdeas, type IdeaCard } from '../inbox';

function lastDocKey(): string {
  return `theloom-mobile-last-doc:${useLoom.getState().currentSlotId}`;
}

function readLastDocId(): string | null {
  try { return localStorage.getItem(lastDocKey()); } catch { return null; }
}

function pickFallbackId(documents: Document[]): string | null {
  const saved = readLastDocId();
  if (saved && documents.some((d) => d.id === saved)) return saved;
  return [...documents].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
}

export default function MobileWrite() {
  const documents = useLoom((s) => s.project.documents);
  const folders = useLoom((s) => s.project.folders);
  const categories = useLoom((s) => s.project.documentCategories);
  const progress = useLoom((s) => s.project.writingProgress);
  const currentSlotId = useLoom((s) => s.currentSlotId);
  const addDocument = useLoom((s) => s.addDocument);
  const updateDocument = useLoom((s) => s.updateDocument);
  const removeDocument = useLoom((s) => s.removeDocument);

  const [selectedId, setSelectedId] = useState<string | null>(() => pickFallbackId(documents));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [inbox, setInbox] = useState<IdeaCard[]>(loadInbox);

  const doc = documents.find((d) => d.id === selectedId) ?? documents[0] ?? null;

  useEffect(() => {
    if (documents.length > 0 && (!selectedId || !documents.some((d) => d.id === selectedId))) {
      const fallback = pickFallbackId(documents) ?? documents[0]?.id ?? null;
      if (fallback) setSelectedId(fallback);
    }
  }, [documents, selectedId, currentSlotId]);

  useEffect(() => {
    try { if (doc) localStorage.setItem(lastDocKey(), doc.id); } catch { /* 忽略 */ }
  }, [doc?.id]);

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

  const createScene = (folderId?: string) => {
    const d: Document = {
      id: uid(),
      name: '新场景',
      folderId,
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

  const renameScene = async (d: Document, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = await promptText({ message: '修改场景名称', defaultValue: d.name });
    if (next && next.trim() && next !== d.name) {
      updateDocument(d.id, (doc) => { doc.name = next.trim(); });
    }
  };

  const deleteScene = async (d: Document, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: `删除场景「${d.name}」?`,
      message: '该场景的正文块将一并删除。',
      danger: true,
    });
    if (!ok) return;
    removeDocument(d.id);
  };

  return (
    <div className="m-write">
      {/* 极简 Obsidian 级单行顶栏 */}
      <div className="m-clean-topbar">
        <button
          className="ghost icon-btn m-top-btn"
          onClick={() => setPickerOpen(true)}
          title="场景目录"
          aria-label="场景目录"
        >
          <Icon name="folder" size={18} />
        </button>

        <div className="m-top-stats">
          {doc ? (
            <span>
              <strong>{documentWordCount(doc)}</strong> 字
              {stats.today > 0 && <span className="m-top-today"> · 今日 +{stats.today}</span>}
            </span>
          ) : (
            <span>未选择场景</span>
          )}
        </div>

        <div className="m-top-actions">
          {doc && (
            <>
              <button
                className="ghost icon-btn m-nav-step-btn"
                disabled={!prevDoc}
                title={prevDoc ? `上一场:${prevDoc.name}` : '第一场'}
                onClick={() => prevDoc && setSelectedId(prevDoc.id)}
              >‹</button>
              <button
                className="ghost icon-btn m-nav-step-btn"
                disabled={!nextDoc}
                title={nextDoc ? `下一场:${nextDoc.name}` : '最后一场'}
                onClick={() => nextDoc && setSelectedId(nextDoc.id)}
              >›</button>
            </>
          )}
          <button
            className={`ghost icon-btn m-idea-icon-btn ${ideasOpen ? 'on' : ''}`}
            onClick={() => setIdeasOpen((o) => !o)}
            title="灵感抽屉"
            aria-label="灵感抽屉"
          >
            <Icon name="bulb" size={17} />
            {recentIdeas.length > 0 && <span className="m-idea-badge">{recentIdeas.length}</span>}
          </button>
        </div>
      </div>

      {/* 灵感抽屉 */}
      {ideasOpen && doc && (
        <div className="m-idea-sheet">
          <div className="m-sheet-head">
            <span>灵感库 ({recentIdeas.length}) · 点一条插到末尾</span>
            <button className="ghost icon-btn" onClick={() => setIdeasOpen(false)}>×</button>
          </div>
          <div className="m-sheet-body">
            {recentIdeas.map((n) => (
              <button key={n.id} className="m-idea-item" onClick={() => insertIdea(n)}>
                {n.text}
              </button>
            ))}
            {recentIdeas.length === 0 && <div className="hint">灵感库是空的，可在「快记」中添加想法。</div>}
          </div>
        </div>
      )}

      {/* 场景目录侧滑抽屉 (Scene Drawer) */}
      {pickerOpen && (
        <div className="m-drawer-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="m-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="m-drawer-head">
              <div className="m-drawer-title">
                <Icon name="doc" size={16} />
                <span>场景目录 ({ordered.length})</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="primary-ghost" onClick={() => createScene()}>＋ 新场景</button>
                <button className="ghost icon-btn" onClick={() => setPickerOpen(false)}>×</button>
              </div>
            </div>

            {ordered.length > 5 && (
              <div className="m-drawer-search-wrap">
                <input
                  className="m-drawer-search"
                  value={query}
                  placeholder="搜索场景 / 章节…"
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}

            <div className="m-drawer-list">
              {visible.map((d) => {
                const path = folderPath(d.folderId, folders);
                const isActive = d.id === selectedId;
                return (
                  <div
                    key={d.id}
                    className={`m-drawer-item ${isActive ? 'active' : ''}`}
                    onClick={() => { setSelectedId(d.id); setPickerOpen(false); setQuery(''); }}
                  >
                    <div className="m-drawer-item-main">
                      <span className="m-drawer-item-name">{d.name}</span>
                      {path && <span className="m-drawer-item-path">{path}</span>}
                    </div>
                    <div className="m-drawer-item-meta">
                      <span className="m-drawer-item-words">{documentWordCount(d)}字</span>
                      <button
                        className="ghost icon-btn m-drawer-action"
                        title="重命名"
                        onClick={(ev) => renameScene(d, ev)}
                      ><Icon name="pencil" size={13} /></button>
                      <button
                        className="ghost icon-btn m-drawer-action m-del"
                        title="删除"
                        onClick={(ev) => deleteScene(d, ev)}
                      ><Icon name="trash" size={13} /></button>
                    </div>
                  </div>
                );
              })}
              {visible.length === 0 && <div className="hint" style={{ padding: 20, textAlign: 'center' }}>没有匹配的场景</div>}
            </div>
          </div>
        </div>
      )}

      {/* 写作正文稿纸 (Obsidian-Style Novel Sheet) */}
      {doc ? (
        <div className="m-write-editor">
          {chapter && <div className="m-scene-chapter-tag">{chapter}</div>}
          <input
            className="m-scene-title-input"
            value={doc.name}
            placeholder="场景标题"
            onChange={(e) => updateDocument(doc.id, (d) => { d.name = e.target.value; })}
          />
          <BlocksEditor doc={doc} variant="focus" />
        </div>
      ) : (
        <div className="m-empty">
          <p>还没有场景。写下第一个片段,碎片时间也能往前推一点。</p>
          <button className="primary" onClick={() => createScene()}>写第一个场景</button>
        </div>
      )}
    </div>
  );
}
