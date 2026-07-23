import { useEffect, useMemo, useState } from 'react';
import { uid, useLoom } from '../../store';
import { findDocumentRefs, useNav } from '../../search';
import { confirmDialog, promptText, alertDialog } from '../../dialog';
import Icon from '../../components/Icon';
import ObjectTemplateSection from '../../components/ObjectTemplateSection';
import TechNameField from '../../components/TechNameField';
import type { DocStatus, Document } from '../../types';
import { DOC_STATUS_LABEL, DOC_STATUS_ORDER, DOC_WRITING_TYPES } from '../../types';
import { documentToFlow } from './convert';
import { documentWordCount, linearizeByFolders } from '../../util';
import { downloadMarkdown, documentToMarkdown } from '../../export';
import NavigatorTree, { FolderSelect } from '../../components/NavigatorTree';
import BlocksEditor, { emptyBlock } from './BlocksEditor';
import Manuscript from './Manuscript';
import RevisionDiff from './RevisionDiff';
import Inspector from '../../components/Inspector';
import DocumentStructureDialog from './DocumentStructureDialog';
import {
  countDocumentReferences,
  mergeAdjacentDocuments,
  nextAdjacentDocument,
  previewDocumentMerge,
  splitDocumentAfterBlock,
} from '../../documentOperations';

export default function DocumentView() {
  const project = useLoom((s) => s.project);
  const documents = useLoom((s) => s.project.documents);
  const categories = useLoom((s) => s.project.documentCategories);
  const entities = useLoom((s) => s.project.entities);
  const flows = useLoom((s) => s.project.flows);
  const folders = useLoom((s) => s.project.folders);
  const annotations = useLoom((s) => s.project.annotations);
  const docSnapshots = useLoom((s) => s.project.docSnapshots);
  const {
    addDocument, updateDocument, removeDocument, update,
    addAnnotation, updateAnnotation, removeAnnotation,
    createDocSnapshot, removeDocSnapshot, restoreDocSnapshot,
  } = useLoom();
  const go = useNav((s) => s.go);

  const [catFilter, setCatFilter] = useState<string | 'all'>('all');
  const [revFilter, setRevFilter] = useState<'all' | 'none' | number>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(documents[0]?.id ?? null);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [annoDraft, setAnnoDraft] = useState('');
  const [diffOpen, setDiffOpen] = useState<{ leftId?: string } | null>(null);
  const [mode, setMode] = useState<'writing' | 'structure' | 'manuscript'>('writing');
  const [focusMode, setFocusMode] = useState(false);
  const [structureToolsOpen, setStructureToolsOpen] = useState(false);

  const navSeq = useNav((s) => s.seq);
  useEffect(() => {
    const t = useNav.getState().target;
    if (t?.tab === 'documents' && t.docId) {
      setCatFilter('all');
      setRevFilter('all');
      setQuery('');
      setSelectedId(t.docId);
      setFocusBlockId(t.blockId ?? null);
      useNav.getState().clear();
    }
  }, [navSeq]);

  // 切换文档时清空批注锚点与草稿
  useEffect(() => {
    setActiveBlockId(null);
    setAnnoDraft('');
  }, [selectedId]);

  const revisionsInUse = useMemo(() => {
    const set = new Set<number>();
    for (const d of documents) if (typeof d.revision === 'number') set.add(d.revision);
    return [...set].sort((a, b) => a - b);
  }, [documents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = documents.filter((d) =>
      (catFilter === 'all' || d.category === catFilter) &&
      (revFilter === 'all' || (revFilter === 'none' ? d.revision === undefined : d.revision === revFilter)) &&
      (!q ||
        d.name.toLowerCase().includes(q) ||
        d.notes.toLowerCase().includes(q) ||
        d.blocks.some((b) =>
          b.text.toLowerCase().includes(q) ||
          (b.items ?? []).some((item) => item.toLowerCase().includes(q)),
        )),
    );
    return list;
  }, [documents, catFilter, revFilter, query]);

  // 连续稿顺序:与 Navigator 树一致(卷 / 章文件夹递归,场景按 order)
  const manuscriptDocs = useMemo(
    () => linearizeByFolders(filtered, folders, 'document'),
    [filtered, folders],
  );

  const selected = documents.find((d) => d.id === selectedId) ?? null;
  const nextDocument = useMemo(
    () => selected ? nextAdjacentDocument(project, selected.id) : undefined,
    [project, selected],
  );
  const linkedFlow = selected
    ? flows.find((f) => f.id === selected.linkedFlowId || f.documentId === selected.id)
    : undefined;
  const documentRefs = useMemo(
    () => selected ? findDocumentRefs(project, selected) : [],
    [project, selected],
  );
  useEffect(() => {
    if (selected) useNav.getState().visit({ tab: 'documents', docId: selected.id }, `场景 · ${selected.name}`);
  }, [selected?.id, selected?.name]);

  // R5:当前文档的批注与快照
  const docAnnotations = useMemo(
    () => (annotations ?? []).filter((a) => a.docId === selectedId)
      .sort((a, b) => Number(!!a.resolved) - Number(!!b.resolved) || b.createdAt - a.createdAt),
    [annotations, selectedId],
  );
  const docSnaps = useMemo(
    () => (docSnapshots ?? []).filter((s) => s.docId === selectedId)
      .sort((a, b) => b.createdAt - a.createdAt),
    [docSnapshots, selectedId],
  );
  const annotationCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of docAnnotations) {
      if (a.blockId && !a.resolved) map.set(a.blockId, (map.get(a.blockId) ?? 0) + 1);
    }
    return map;
  }, [docAnnotations]);

  const blockExcerpt = (blockId?: string): string => {
    if (!blockId || !selected) return '';
    const b = selected.blocks.find((x) => x.id === blockId);
    if (!b) return '';
    const text = b.text || b.condition || b.instruction || (b.items ?? []).join(' ') || '(空块)';
    return text.slice(0, 18);
  };

  const addAnno = () => {
    if (!selectedId || !annoDraft.trim()) return;
    addAnnotation({
      id: uid(), docId: selectedId,
      blockId: activeBlockId && selected?.blocks.some((b) => b.id === activeBlockId) ? activeBlockId : undefined,
      text: annoDraft.trim(), createdAt: Date.now(),
    });
    setAnnoDraft('');
  };

  const saveSnapshot = async () => {
    if (!selected) return;
    const label = await promptText({
      message: '快照名称(存档当前正文,之后可对比差异或恢复)',
      defaultValue: selected.revision ? `第 ${selected.revision} 稿` : `${new Date().toLocaleDateString()} 存档`,
      confirmText: '保存快照',
    });
    if (label === null) return;
    createDocSnapshot(selected.id, label.trim() || new Date().toLocaleString());
  };

  const createDoc = (folderId = selected?.folderId) => {
    const d: Document = {
      id: uid(),
      folderId,
      name: '新场景',
      category: catFilter === 'all' ? (categories[0] ?? '未分类') : catFilter,
      blocks: [emptyBlock('paragraph')],
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addDocument(d);
    setSelectedId(d.id);
    setFocusBlockId(d.blocks[0].id);
  };

  const addCategory = async (): Promise<string | null> => {
    const name = await promptText({ message: '新分类名称(例如:剧本草稿 / 设计文档 / 处理)', placeholder: '分类名称' });
    const clean = name?.trim();
    if (!clean) return null;
    update((p) => { if (!p.documentCategories.includes(clean)) p.documentCategories.push(clean); });
    setCatFilter(clean);
    return clean;
  };

  const renameCategory = async (name: string) => {
    const next = await promptText({ message: `重命名分类「${name}」`, defaultValue: name, confirmText: '重命名' });
    const clean = next?.trim();
    if (!clean || clean === name) return;
    update((p) => {
      if (!p.documentCategories.includes(clean)) p.documentCategories.push(clean);
      p.documentCategories = p.documentCategories.filter((c) => c !== name);
      for (const d of p.documents) if (d.category === name) d.category = clean;
    });
    setCatFilter(clean);
  };

  const removeCategory = async (name: string) => {
    const used = documents.filter((d) => d.category === name).length;
    if (!await confirmDialog({
      message: used > 0 ? `分类「${name}」下有 ${used} 篇文档,删除后它们将变为「未分类」。继续?` : `删除分类「${name}」?`,
      danger: true,
      confirmText: '删除',
    })) return;
    update((p) => {
      p.documentCategories = p.documentCategories.filter((c) => c !== name);
      for (const d of p.documents) if (d.category === name) d.category = '未分类';
    });
    if (catFilter === name) setCatFilter('all');
  };

  const patchDoc = (fn: (d: Document) => void) => {
    if (!selectedId) return;
    updateDocument(selectedId, fn);
  };

  const splitSelected = async () => {
    if (!selected || !activeBlockId) return;
    const index = selected.blocks.findIndex((block) => block.id === activeBlockId);
    if (index < 0 || index >= selected.blocks.length - 1) {
      await alertDialog('请先把光标放在拆分位置的前一个正文块中；最后一个块之后没有可拆分的内容。');
      return;
    }
    const movedAnnotations = (annotations ?? []).filter((annotation) =>
      annotation.docId === selected.id
      && !!annotation.blockId
      && selected.blocks.slice(index + 1).some((block) => block.id === annotation.blockId)).length;
    const name = await promptText({
      title: '拆分场景',
      message: `将在“${blockExcerpt(activeBlockId)}”之后拆分：前半 ${index + 1} 块，后半 ${selected.blocks.length - index - 1} 块。\n\n`
        + `后半正文的 ${movedAnnotations} 条块级批注会随块移动；${countDocumentReferences(project, selected.id)} 处跨模块引用和关联流程保留在前半场景，不会丢失。`,
      defaultValue: `${selected.name}（后半）`,
      confirmText: '拆分场景',
    });
    if (!name?.trim()) return;
    const newId = uid();
    update((next) => splitDocumentAfterBlock(next, selected.id, activeBlockId, name.trim(), { newId }));
    setSelectedId(newId);
    setFocusBlockId(null);
  };

  const formatConflictValue = (field: string, value: unknown): string => {
    if (value === undefined || value === '') return '未设置';
    if (field === 'status') return DOC_STATUS_LABEL[value as DocStatus] ?? String(value);
    if (field === 'povId' || field === 'locationId') return entities.find((entity) => entity.id === value)?.name ?? String(value);
    if (field === 'templateId') return (project.templates ?? []).find((template) => template.id === value)?.name ?? String(value);
    if (field === 'linkedFlowId') return flows.find((flow) => flow.id === value)?.name ?? String(value);
    if (field === 'fields') return `${Array.isArray(value) ? value.length : 0} 个字段`;
    return String(value);
  };

  const mergeNext = async () => {
    if (!selected || !nextDocument) return;
    const preview = previewDocumentMerge(project, selected.id, nextDocument.id);
    const conflictLines = preview.conflicts.slice(0, 7).map((conflict) =>
      `• ${conflict.label}：保留“${formatConflictValue(conflict.field, conflict.first)}”，舍弃“${formatConflictValue(conflict.field, conflict.second)}”`);
    const hiddenCount = Math.max(0, preview.conflicts.length - conflictLines.length);
    const conflictText = conflictLines.length
      ? `\n\n元数据冲突（保留前场景）：\n${conflictLines.join('\n')}${hiddenCount ? `\n• 另有 ${hiddenCount} 项` : ''}`
      : '\n\n两场景元数据一致。';
    if (!await confirmDialog({
      title: '合并相邻场景',
      message: `把下一场“${nextDocument.name}”合并进“${selected.name}”？`
        + `${conflictText}\n\n第二场景的 ${preview.migratedReferenceCount} 处跨模块引用、批注和快照会迁到第一场景。正文与附件不会丢失。`,
      confirmText: '合并并迁移引用',
    })) return;
    update((next) => mergeAdjacentDocuments(next, selected.id, nextDocument.id));
    setFocusBlockId(null);
  };

  const convertToFlow = async () => {
    if (!selected) return;
    const flowable = selected.blocks.filter((b) =>
      b.flowRole !== 'none'
      && (!DOC_WRITING_TYPES.has(b.type) || (b.type === 'paragraph' && (b.flowRole === 'beat' || b.flowRole === 'node'))));
    if (flowable.length === 0) {
      await alertDialog('当前场景没有参与流程的结构块。普通正文默认不进入流程；可在「结构」视图把正文标为节拍，或添加动作、对白与逻辑块。');
      return;
    }
    const flow = documentToFlow(selected);
    update((p) => {
      p.flows.push(flow);
      const d = p.documents.find((x) => x.id === selected.id);
      if (d) d.linkedFlowId = flow.id;
    });
    go({ tab: 'flow', flowId: flow.id });
  };

  const refreshLinkedFlow = async () => {
    if (!selected || !linkedFlow) return;
    const next = documentToFlow(selected);
    if (!await confirmDialog({
      message: `用当前场景结构更新关联流程「${linkedFlow.name}」？\n\n`
        + `节点 ${linkedFlow.nodes.length} → ${next.nodes.length}，连线 ${linkedFlow.edges.length} → ${next.edges.length}。\n`
        + '流程里的手工布局与未在文档中表达的连线会被替换；正文内容仍由叙事单元共享。',
      confirmText: '更新并打开',
    })) return;
    update((p) => {
      const flow = p.flows.find((f) => f.id === linkedFlow.id);
      const doc = p.documents.find((d) => d.id === selected.id);
      if (!flow || !doc) return;
      flow.nodes = next.nodes;
      flow.edges = next.edges;
      flow.documentId = doc.id;
      doc.linkedFlowId = flow.id;
    });
    go({ tab: 'flow', flowId: linkedFlow.id });
  };

  const stats = useMemo(() => {
    if (!selected) return null;
    const words = documentWordCount(selected);
    let dialogues = 0;
    const speakers = new Map<string, number>();
    for (const b of selected.blocks) {
      if (b.type === 'dialogue') {
        dialogues++;
        if (b.speakerId) {
          const sp = entities.find((e) => e.id === b.speakerId)?.name ?? '(未知)';
          speakers.set(sp, (speakers.get(sp) ?? 0) + 1);
        }
      }
    }
    return { words, dialogues, speakers: [...speakers.entries()].sort((a, b) => b[1] - a[1]) };
  }, [selected, entities]);

  const characters = useMemo(() => entities.filter((e) => e.kind === 'character'), [entities]);
  const locations = useMemo(() => entities.filter((e) => e.kind === 'location'), [entities]);

  return (
    <>
      {!focusMode && <NavigatorTree
        module="document"
        title="文档"
        items={filtered}
        selectedId={selectedId}
        getLabel={(document) => document.name}
        getDetail={(document) => document.category}
        renderItemMeta={(document) => (
          <span className="doc-nav-meta">
            {document.status && (
              <span className={`ms-status ms-status-${document.status}`} title={`状态:${DOC_STATUS_LABEL[document.status]}`}>
                {DOC_STATUS_LABEL[document.status]}
              </span>
            )}
            <span className="doc-nav-words">{documentWordCount(document)}字</span>
          </span>
        )}
        onSelect={(id) => { setSelectedId(id); setFocusBlockId(null); }}
        onMove={(id, folderId) => updateDocument(id, (document) => { document.folderId = folderId; })}
        onMoveMany={(ids, folderId) => update((p) => {
          const set = new Set(ids);
          for (const d of p.documents) if (set.has(d.id)) { d.folderId = folderId; delete d.order; }
        })}
        onReorder={(_parentId, orderedIds) => update((p) => {
          const map = new Map(orderedIds.map((id, i) => [id, i]));
          for (const d of p.documents) if (map.has(d.id)) d.order = map.get(d.id);
        })}
        onMoveAndReorder={(ids, parentId, orderedIds) => update((p) => {
          const moved = new Set(ids);
          const order = new Map(orderedIds.map((id, index) => [id, index]));
          for (const document of p.documents) {
            if (moved.has(document.id)) document.folderId = parentId ?? undefined;
            if (order.has(document.id)) document.order = order.get(document.id);
          }
        })}
        onCreate={createDoc}
        onCreateInFolder={createDoc}
        createLabel="新建场景"
        emptyLabel="还没有场景"
      />}

      <div className="pane-col">
        <div className="toolbar">
          <button className="btn-create" onClick={() => createDoc()}>＋ 新场景</button>
          <div className="doc-mode-switch">
            <button className={mode === 'writing' ? 'primary' : 'ghost'} onClick={() => setMode('writing')}>写作</button>
            <button className={mode === 'structure' ? 'primary' : 'ghost'} onClick={() => setMode('structure')}>结构</button>
            <button className={mode === 'manuscript' ? 'primary' : 'ghost'} onClick={() => setMode('manuscript')}>
              <Icon name="book" size={13} /> 连续稿
            </button>
          </div>
          <button
            className={focusMode ? 'primary' : 'ghost'}
            title="隐藏导航与属性栏，专注正文"
            onClick={() => setFocusMode((value) => !value)}
          >{focusMode ? '退出专注' : '专注'}</button>
          <button className="ghost" onClick={() => setStructureToolsOpen(true)}>长篇工具</button>
          <select value={catFilter} onChange={(event) => setCatFilter(event.target.value)} style={{ width: 120 }}>
            <option value="all">全部分类</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <button className="ghost" onClick={() => addCategory()} title="新建场景分类" style={{ fontSize: 12 }}>＋ 分类</button>
          {catFilter !== 'all' && (
            <>
              <button className="ghost" onClick={() => renameCategory(catFilter)} style={{ fontSize: 12 }}>重命名</button>
              <button className="ghost" onClick={() => removeCategory(catFilter)} title={`删除分类「${catFilter}」`} style={{ fontSize: 12 }}>× 删除</button>
            </>
          )}
          {(revisionsInUse.length > 0 || revFilter !== 'all') && (
            <select
              value={String(revFilter)}
              title="按修订轮次筛选场景(轮次在右侧场景元数据里设置)"
              onChange={(e) => {
                const v = e.target.value;
                setRevFilter(v === 'all' ? 'all' : v === 'none' ? 'none' : Number(v));
              }}
              style={{ width: 110 }}
            >
              <option value="all">全部轮次</option>
              {revisionsInUse.map((r) => <option key={r} value={r}>第 {r} 稿</option>)}
              <option value="none">未设轮次</option>
            </select>
          )}
          <input
            placeholder="搜索文档…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 260 }}
          />
          <span className="hint">
            {mode === 'manuscript'
              ? '按卷 / 章顺序通读全文'
              : mode === 'structure'
                ? '整理块类型、流程参与方式与顺序'
                : 'Enter 新段，Shift+Enter 换行，空段首输入 / 切换块类型'}
          </span>
        </div>

        {mode === 'manuscript' ? (
          <Manuscript
            docs={manuscriptDocs}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setFocusBlockId(null); }}
          />
        ) : selected ? (
          <div className="doc-editor">
            <div className="doc-head">
              <input
                className="doc-title-input"
                value={selected.name}
                onChange={(e) => patchDoc((d) => { d.name = e.target.value; })}
                placeholder="场景名称"
              />
              <select
                value={selected.category}
                onChange={async (e) => {
                  if (e.target.value === '__new__') {
                    const category = await addCategory();
                    if (category) patchDoc((d) => { d.category = category; });
                  } else {
                    patchDoc((d) => { d.category = e.target.value; });
                  }
                }}
                style={{ width: 130 }}
              >
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                {!categories.includes('未分类') && <option value="未分类">未分类</option>}
                <option value="__new__">＋ 新建分类…</option>
              </select>
              {linkedFlow ? (
                <>
                  <button className="primary" onClick={() => go({ tab: 'flow', flowId: linkedFlow.id })}>
                    <Icon name="flow" size={13} /> 打开关联流程
                  </button>
                  <button className="ghost" onClick={refreshLinkedFlow}>更新结构</button>
                </>
              ) : (
                <button className="primary" onClick={convertToFlow}>
                  <Icon name="flow" size={13} /> 生成流程
                </button>
              )}
              <button
                className="ghost"
                onClick={splitSelected}
                disabled={!activeBlockId || selected.blocks.findIndex((block) => block.id === activeBlockId) >= selected.blocks.length - 1}
                title="在当前正文块之后拆成两个场景"
              >拆分场景</button>
              <button
                className="ghost"
                onClick={mergeNext}
                disabled={!nextDocument}
                title={nextDocument ? `合并下一场：${nextDocument.name}` : '同一章内没有下一场'}
              >合并下一场</button>
            </div>
            <BlocksEditor
              doc={selected}
              variant={mode === 'structure' ? 'structure' : 'writing'}
              focusBlockId={focusBlockId}
              annotationCounts={annotationCounts}
              onActiveChange={setActiveBlockId}
            />
          </div>
        ) : (
          <div className="empty-hint" style={{ margin: 'auto' }}>
            {filtered.length === 0
              ? <>还没有场景。<br />左侧「＋ 新场景」开始写作。</>
              : <>点击左侧场景查看和编辑</>}
          </div>
        )}
      </div>

      {selected && !focusMode && (
        <Inspector>
          <div className="side-head" style={{ padding: '0 0 4px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0 }}>场景属性</h3>
            <span className="spacer" style={{ flex: 1 }} />
            <button
              className="ghost icon-btn"
              title="导出为剧本式 Markdown"
              onClick={() => downloadMarkdown(`${selected.name}.md`, documentToMarkdown(selected, entities))}
            ><Icon name="script" size={14} /></button>
            <button
              className="ghost icon-btn"
              title="删除文档"
              onClick={async () => {
                const referenceLines = documentRefs.slice(0, 8).map((ref) => `• ${ref.module} / ${ref.kind}：${ref.title}`);
                const hiddenCount = Math.max(0, documentRefs.length - referenceLines.length);
                const referenceText = referenceLines.length > 0
                  ? `\n\n将同时解除 ${documentRefs.length} 处跨模块引用：\n${referenceLines.join('\n')}${hiddenCount ? `\n• 另有 ${hiddenCount} 处` : ''}`
                  : '';
                if (!await confirmDialog({
                  message: `删除场景「${selected.name}」？${referenceText}\n\n正文、批注和快照会删除；关联对象本身会保留。`,
                  danger: true,
                  confirmText: '删除并解除引用',
                })) return;
                removeDocument(selected.id);
                setSelectedId(null);
              }}
            ><Icon name="trash" size={14} /></button>
          </div>

          {stats && (
            <div className="doc-stats">
              <div>
                字数 {stats.words}
                {typeof selected.wordTarget === 'number' && selected.wordTarget > 0 && (
                  <> / 目标 {selected.wordTarget}({Math.round((stats.words / selected.wordTarget) * 100)}%)</>
                )}
                · 对白 {stats.dialogues} 段
              </div>
              {typeof selected.wordTarget === 'number' && selected.wordTarget > 0 && (
                <div className="doc-progress">
                  <div className="doc-progress-fill" style={{ width: `${Math.min(100, (stats.words / selected.wordTarget) * 100)}%` }} />
                </div>
              )}
              {stats.speakers.length > 0 && (
                <table className="var-table" style={{ marginTop: 6 }}>
                  <thead><tr><th>角色</th><th>台词</th></tr></thead>
                  <tbody>
                    {stats.speakers.map(([name, n]) => (
                      <tr key={name}><td>{name}</td><td>{n}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="field">
            <label>跨模块引用 ({documentRefs.length})</label>
            <div className="document-ref-list">
              {documentRefs.map((ref) => (
                <button key={ref.key} className="ref-item document-ref-item" onClick={() => go(ref.nav)} title={ref.snippet}>
                  <span>{ref.module} · {ref.kind}</span>
                  <strong>{ref.title}</strong>
                </button>
              ))}
              {documentRefs.length === 0 && <span className="hint">尚未被其他模块引用</span>}
            </div>
          </div>

          <ObjectTemplateSection
            module="document"
            object={selected}
            onFieldsChange={(fields) => patchDoc((d) => { d.fields = fields; })}
          />
          <div className="field">
            <label>场景元数据</label>
            <div className="kv-row">
              <div className="field" style={{ flex: 1 }}>
                <label>状态</label>
                <select
                  value={selected.status ?? ''}
                  onChange={(e) => patchDoc((d) => { d.status = (e.target.value || undefined) as DocStatus | undefined; })}
                >
                  <option value="">(未设置)</option>
                  {DOC_STATUS_ORDER.map((s) => <option key={s} value={s}>{DOC_STATUS_LABEL[s]}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>字数目标</label>
                <input
                  type="number"
                  min={0}
                  value={selected.wordTarget ?? ''}
                  onChange={(e) => patchDoc((d) => {
                    const v = Number(e.target.value);
                    d.wordTarget = e.target.value === '' || !Number.isFinite(v) || v <= 0 ? undefined : Math.floor(v);
                  })}
                  placeholder="如 3000"
                />
              </div>
            </div>
            <div className="kv-row">
              <div className="field" style={{ flex: 1 }}>
                <label>POV 角色</label>
                <select
                  value={selected.povId ?? ''}
                  onChange={(e) => patchDoc((d) => { d.povId = e.target.value || undefined; })}
                >
                  <option value="">(无)</option>
                  {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>地点</label>
                <select
                  value={selected.locationId ?? ''}
                  onChange={(e) => patchDoc((d) => { d.locationId = e.target.value || undefined; })}
                >
                  <option value="">(无)</option>
                  {locations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="kv-row">
              <div className="field" style={{ flex: 1 }}>
                <label>故事时间</label>
                <input
                  value={selected.timeLabel ?? ''}
                  onChange={(e) => patchDoc((d) => { d.timeLabel = e.target.value || undefined; })}
                  placeholder="如:雨夜 / 第 7 日 / 三年前"
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>情节张力(节奏图)</label>
                <select
                  value={selected.tension ?? ''}
                  onChange={(e) => patchDoc((d) => { d.tension = e.target.value ? Number(e.target.value) : undefined; })}
                >
                  <option value="">(未设置)</option>
                  {[1, 2, 3, 4, 5].map((t) => (
                    <option key={t} value={t}>{t}{t === 1 ? '(平缓)' : t === 5 ? '(高潮)' : ''}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="kv-row">
              <div className="field" style={{ flex: 1 }}>
                <label>修订轮次(第几稿)</label>
                <input
                  type="number"
                  min={1}
                  value={selected.revision ?? ''}
                  onChange={(e) => patchDoc((d) => {
                    const v = Number(e.target.value);
                    d.revision = e.target.value === '' || !Number.isFinite(v) || v < 1 ? undefined : Math.floor(v);
                  })}
                  placeholder="如 1 / 2 / 3"
                />
              </div>
              <div className="field" style={{ flex: 1 }} />
            </div>
          </div>

          <details className="field inspector-fold" open={docAnnotations.some((a) => !a.resolved)}>
            <summary>批注({docAnnotations.filter((a) => !a.resolved).length} 未解决)</summary>
            <div className="anno-add">
              <textarea
                rows={2}
                value={annoDraft}
                placeholder={activeBlockId ? `批注当前块「${blockExcerpt(activeBlockId) || '…'}」` : '批注整篇(先点选正文中的块可精确锚定)'}
                onChange={(e) => setAnnoDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addAnno(); }}
              />
              <button className="primary" disabled={!annoDraft.trim()} onClick={addAnno}>添加</button>
            </div>
            <div className="anno-list">
              {docAnnotations.map((a) => (
                <div key={a.id} className={`anno-item ${a.resolved ? 'resolved' : ''}`}>
                  <div className="anno-text">{a.text}</div>
                  <div className="anno-meta">
                    {a.blockId ? (
                      <button
                        className="anno-anchor"
                        title="跳到锚定的块"
                        onClick={() => setFocusBlockId(a.blockId!)}
                      >@{blockExcerpt(a.blockId) || '(块已删除)'}</button>
                    ) : (
                      <span className="anno-anchor-none">整篇</span>
                    )}
                    <span className="anno-time">{new Date(a.createdAt).toLocaleDateString()}</span>
                    <span className="spacer" />
                    <button
                      className="ghost icon-btn"
                      title={a.resolved ? '重新打开' : '标记已解决'}
                      onClick={() => updateAnnotation(a.id, { resolved: !a.resolved || undefined })}
                    >{a.resolved ? '↺' : '✓'}</button>
                    <button
                      className="ghost icon-btn"
                      title="删除批注"
                      onClick={() => removeAnnotation(a.id)}
                    >×</button>
                  </div>
                </div>
              ))}
              {docAnnotations.length === 0 && <div className="empty-hint" style={{ padding: '6px 0' }}>还没有批注</div>}
            </div>
          </details>

          <details className="field inspector-fold">
            <summary>场景快照({docSnaps.length})</summary>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="ghost" style={{ flex: 1 }} onClick={saveSnapshot}>存快照</button>
              <button
                className="ghost"
                style={{ flex: 1 }}
                disabled={docSnaps.length === 0}
                title="比较任意两个版本(含当前正文)的差异"
                onClick={() => setDiffOpen({ leftId: docSnaps[0]?.id })}
              >比较版本</button>
              <button
                className="ghost"
                style={{ flex: 1 }}
                title="进入项目级修订任务与中文校对"
                onClick={() => go({ tab: 'planning', planningView: 'revision' })}
              >修订中心</button>
            </div>
            <div className="snap-list">
              {docSnaps.map((s) => (
                <div key={s.id} className="snap-item">
                  <div className="snap-meta">
                    <span className="snap-label">{s.label}</span>
                    <span className="snap-time">
                      {new Date(s.createdAt).toLocaleString()}{s.revision ? ` · 第 ${s.revision} 稿` : ''}
                    </span>
                  </div>
                  <button className="ghost icon-btn" title="与当前正文比较" onClick={() => setDiffOpen({ leftId: s.id })}>⇆</button>
                  <button
                    className="ghost icon-btn"
                    title="恢复到这个版本(当前正文会被替换,可 Ctrl+Z 撤销)"
                    onClick={async () => {
                      if (await confirmDialog({ message: `把正文恢复到快照「${s.label}」?当前内容会被替换(可用 Ctrl+Z 撤销)。`, confirmText: '恢复' })) {
                        restoreDocSnapshot(s.id);
                      }
                    }}
                  >↩</button>
                  <button
                    className="ghost icon-btn"
                    title="删除快照"
                    onClick={async () => {
                      if (await confirmDialog({ message: `删除快照「${s.label}」?`, danger: true, confirmText: '删除' })) removeDocSnapshot(s.id);
                    }}
                  >×</button>
                </div>
              ))}
              {docSnaps.length === 0 && (
                <div className="empty-hint" style={{ padding: '6px 0' }}>改稿前先「存快照」,之后可对比差异或一键恢复</div>
              )}
            </div>
          </details>

          <TechNameField
            value={selected.technicalName}
            onChange={(v) => patchDoc((d) => { d.technicalName = v; })}
            displayName={selected.name}
          />

          <div className="field">
            <label>文件夹</label>
            <FolderSelect module="document" value={selected.folderId} onChange={(folderId) => patchDoc((document) => { document.folderId = folderId; })} />
          </div>

          <div className="field">
            <label>备注</label>
            <textarea
              value={selected.notes}
              rows={8}
              onChange={(e) => patchDoc((d) => { d.notes = e.target.value; })}
              placeholder="文档意图、修订记录、待办…"
            />
          </div>

          <div className="field">
            <label>结构块(参与流程)</label>
            <ul className="doc-legend">
              <li><b>场景锚点</b> → 片段节点(兼容多场景剧本)</li>
              <li><b>动作</b> → 对白节点(无说话人)</li>
              <li><b>对白</b> → 对白节点(带说话人)</li>
              <li><b>选项</b> → 汇聚点(分支提示)</li>
              <li><b>条件</b> → 条件节点(真/假引脚)</li>
              <li><b>指令</b> → 指令节点(变量赋值)</li>
            </ul>
            <label style={{ marginTop: 8 }}>写作块</label>
            <ul className="doc-legend">
              <li><b>正文</b> → 默认不进入流程，可在结构视图标为节拍</li>
              <li><b>子标题</b> → H2 / H3,只影响排版和 Markdown</li>
              <li><b>引用</b> → Markdown 的 <code>&gt;</code> 块</li>
              <li><b>列表</b> → 有序 / 无序列表</li>
              <li><b>注释</b> → 不导出,不进入流程</li>
            </ul>
          </div>
        </Inspector>
      )}

      {diffOpen && selected && (
        <RevisionDiff doc={selected} initialLeftId={diffOpen.leftId} onClose={() => setDiffOpen(null)} />
      )}
      {structureToolsOpen && <DocumentStructureDialog onClose={() => setStructureToolsOpen(false)} />}
    </>
  );
}
