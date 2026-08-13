import { useEffect, useMemo, useState } from 'react';
import { uid, useLoom } from '../store';
import { documentWordCount } from '../util';
import type { Document } from '../types';
import BlocksEditor, { emptyBlock } from '../modules/document/BlocksEditor';
import Icon from '../components/Icon';

const LAST_DOC_KEY = 'theloom-mobile-last-doc';

/** 移动端写作:冷启动直达上次的场景,专注写作,可在场景间切换 */
export default function MobileWrite() {
  const documents = useLoom((s) => s.project.documents);
  const categories = useLoom((s) => s.project.documentCategories);
  const addDocument = useLoom((s) => s.addDocument);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(LAST_DOC_KEY);
      if (saved && documents.some((d) => d.id === saved)) return saved;
    } catch { /* 忽略 */ }
    return [...documents].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  const doc = documents.find((d) => d.id === selectedId) ?? null;

  useEffect(() => {
    try { if (doc) localStorage.setItem(LAST_DOC_KEY, doc.id); } catch { /* 忽略 */ }
  }, [doc?.id]);

  const ordered = useMemo(
    () => [...documents].sort((a, b) => b.updatedAt - a.updatedAt),
    [documents],
  );

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
          <span className="m-doc-name">{doc ? doc.name : '未选择场景'}</span>
          {doc && <span className="m-doc-words">{documentWordCount(doc)}字</span>}
        </button>
        <button className="ghost icon-btn" onClick={createScene} title="新建场景" aria-label="新建场景">
          <Icon name="plus" size={16} />
        </button>
      </div>
      {pickerOpen && (
        <div className="m-doc-list">
          {ordered.map((d) => (
            <button
              key={d.id}
              className={`m-doc-item ${d.id === selectedId ? 'on' : ''}`}
              onClick={() => { setSelectedId(d.id); setPickerOpen(false); }}
            >
              <span className="m-doc-item-name">{d.name}</span>
              <span className="m-doc-item-words">{documentWordCount(d)}字</span>
            </button>
          ))}
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
