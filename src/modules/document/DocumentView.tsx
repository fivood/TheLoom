import { useEffect, useMemo, useState } from 'react';
import { uid, useLoom } from '../../store';
import { useNav } from '../../search';
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

export default function DocumentView() {
  const documents = useLoom((s) => s.project.documents);
  const categories = useLoom((s) => s.project.documentCategories);
  const entities = useLoom((s) => s.project.entities);
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
  const [mode, setMode] = useState<'single' | 'manuscript'>('single');

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
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [documents, catFilter, revFilter, query]);

  // 连续稿顺序:与 Navigator 树一致(卷 / 章文件夹递归,场景按 order)
  const manuscriptDocs = useMemo(
    () => linearizeByFolders(filtered, folders, 'document'),
    [filtered, folders],
  );

  const selected = documents.find((d) => d.id === selectedId) ?? null;

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

  const createDoc = () => {
    const d: Document = {
      id: uid(),
      folderId: selected?.folderId,
      name: '新文档',
      category: catFilter === 'all' ? (categories[0] ?? '未分类') : catFilter,
      blocks: [emptyBlock('heading')],
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addDocument(d);
    setSelectedId(d.id);
    setFocusBlockId(d.blocks[0].id);
  };

  const addCategory = async () => {
    const name = await promptText({ message: '新分类名称(例如:剧本草稿 / 设计文档 / 处理)', placeholder: '分类名称' });
    if (!name) return;
    update((p) => { if (!p.documentCategories.includes(name)) p.documentCategories.push(name); });
    setCatFilter(name);
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

  const convertToFlow = async () => {
    if (!selected) return;
    const flowable = selected.blocks.filter((b) => !DOC_WRITING_TYPES.has(b.type));
    if (flowable.length === 0) {
      await alertDialog('文档里没有可转换为流程节点的剧本块。写作块(子标题 / 引用 / 列表 / 注释)不进入流程。');
      return;
    }
    const flow = documentToFlow(selected);
    update((p) => p.flows.push(flow));
    go({ tab: 'flow', flowId: flow.id });
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
      <NavigatorTree
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
        onCreate={createDoc}
        createLabel="新建文档"
        emptyLabel="还没有文档"
      />

      <div className="pane-col">
        <div className="toolbar">
          <button className="primary" onClick={createDoc}>＋ 新文档</button>
          <button
            className={mode === 'manuscript' ? 'primary' : undefined}
            title="连续稿:按卷 / 章 / 场景树顺序连成一篇稿子,点击任意场景就地编辑"
            onClick={() => setMode((m) => (m === 'manuscript' ? 'single' : 'manuscript'))}
          >
            <Icon name="book" size={13} /> 连续稿
          </button>
          <select value={catFilter} onChange={(event) => setCatFilter(event.target.value)} style={{ width: 120 }}>
            <option value="all">全部分类</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <button className="ghost" onClick={addCategory} title="新建文档分类" style={{ fontSize: 12 }}>＋ 分类</button>
          {catFilter !== 'all' && <button className="ghost" onClick={() => removeCategory(catFilter)} title={`删除分类「${catFilter}」`} style={{ fontSize: 12 }}>× 删除分类</button>}
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
            {mode === 'manuscript' ? '左侧文件夹是卷 / 章,拖拽即可重排场景' : '在结构化剧本块里起草,再「转为流程」生成节点图'}
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
                placeholder="文档标题"
              />
              <select
                value={selected.category}
                onChange={(e) => patchDoc((d) => { d.category = e.target.value; })}
                style={{ width: 130 }}
              >
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                {!categories.includes('未分类') && <option value="未分类">未分类</option>}
              </select>
              <button
                className="primary"
                title="把文档里的块转换为一条新的流程(场景→片段、对白→对白节点、条件→条件节点…)"
                onClick={convertToFlow}
              >
                <Icon name="flow" size={13} /> 转为流程
              </button>
            </div>
            <BlocksEditor
              doc={selected}
              focusBlockId={focusBlockId}
              annotationCounts={annotationCounts}
              onActiveChange={setActiveBlockId}
            />
          </div>
        ) : (
          <div className="empty-hint" style={{ margin: 'auto' }}>
            {filtered.length === 0
              ? <>还没有文档。<br />左侧「＋ 新文档」开始起草剧本或设计稿。</>
              : <>点击左侧文档查看和编辑</>}
          </div>
        )}
      </div>

      {selected && (
        <Inspector>
          <div className="side-head" style={{ padding: '0 0 4px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0 }}>文档属性</h3>
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
                if (!await confirmDialog({ message: `删除文档「${selected.name}」?`, danger: true, confirmText: '删除' })) return;
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

          <div className="field">
            <label>批注({docAnnotations.filter((a) => !a.resolved).length} 未解决)</label>
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
          </div>

          <div className="field">
            <label>场景快照({docSnaps.length})</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="ghost" style={{ flex: 1 }} onClick={saveSnapshot}>存快照</button>
              <button
                className="ghost"
                style={{ flex: 1 }}
                disabled={docSnaps.length === 0}
                title="比较任意两个版本(含当前正文)的差异"
                onClick={() => setDiffOpen({ leftId: docSnaps[0]?.id })}
              >比较版本</button>
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
          </div>

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
            <label>剧本块(参与转流程)</label>
            <ul className="doc-legend">
              <li><b>场景</b> → 片段节点(章节锚)</li>
              <li><b>动作</b> → 对白节点(无说话人)</li>
              <li><b>对白</b> → 对白节点(带说话人)</li>
              <li><b>选项</b> → 汇聚点(分支提示)</li>
              <li><b>条件</b> → 条件节点(真/假引脚)</li>
              <li><b>指令</b> → 指令节点(变量赋值)</li>
            </ul>
            <label style={{ marginTop: 8 }}>写作块(仅长篇组织)</label>
            <ul className="doc-legend">
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
    </>
  );
}
