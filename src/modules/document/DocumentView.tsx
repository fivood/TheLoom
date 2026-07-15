import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { useNav } from '../../search';
import Icon from '../../components/Icon';
import TechNameField from '../../components/TechNameField';
import { RichTextInput } from '../../components/RichText';
import type { DocBlock, DocBlockType, Document } from '../../types';
import { DOC_BLOCK_LABEL } from '../../types';
import { documentToFlow } from './convert';
import { downloadMarkdown, documentToMarkdown } from '../../export';
import NavigatorTree, { FolderSelect } from '../../components/NavigatorTree';

const BLOCK_TYPES = Object.keys(DOC_BLOCK_LABEL) as DocBlockType[];

function emptyBlock(type: DocBlockType): DocBlock {
  const b: DocBlock = { id: uid(), type, text: '' };
  if (type === 'choice') b.choices = [{ id: uid(), label: '' }];
  if (type === 'condition') b.condition = '';
  if (type === 'instruction') b.instruction = '';
  return b;
}

export default function DocumentView() {
  const documents = useLoom((s) => s.project.documents);
  const categories = useLoom((s) => s.project.documentCategories);
  const entities = useLoom((s) => s.project.entities);
  const { addDocument, updateDocument, removeDocument, update } = useLoom();
  const go = useNav((s) => s.go);

  const [catFilter, setCatFilter] = useState<string | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(documents[0]?.id ?? null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  const navSeq = useNav((s) => s.seq);
  useEffect(() => {
    const t = useNav.getState().target;
    if (t?.tab === 'documents' && t.docId) {
      setCatFilter('all');
      setQuery('');
      setSelectedId(t.docId);
      setActiveBlockId(t.blockId ?? null);
      useNav.getState().clear();
    }
  }, [navSeq]);

  const characters = useMemo(() => entities.filter((e) => e.kind === 'character'), [entities]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = documents.filter((d) =>
      (catFilter === 'all' || d.category === catFilter) &&
      (!q ||
        d.name.toLowerCase().includes(q) ||
        d.notes.toLowerCase().includes(q) ||
        d.blocks.some((b) => b.text.toLowerCase().includes(q))),
    );
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [documents, catFilter, query]);

  const selected = documents.find((d) => d.id === selectedId) ?? null;

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
    setActiveBlockId(d.blocks[0].id);
  };

  const addCategory = () => {
    const name = prompt('新分类名称(例如:剧本草稿 / 设计文档 / 处理)');
    if (!name) return;
    update((p) => { if (!p.documentCategories.includes(name)) p.documentCategories.push(name); });
    setCatFilter(name);
  };

  const removeCategory = (name: string) => {
    const used = documents.filter((d) => d.category === name).length;
    if (!confirm(used > 0 ? `分类「${name}」下有 ${used} 篇文档,删除后它们将变为「未分类」。继续?` : `删除分类「${name}」?`)) return;
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

  const patchBlock = (blockId: string, patch: Partial<DocBlock>) => {
    patchDoc((d) => {
      const b = d.blocks.find((x) => x.id === blockId);
      if (b) Object.assign(b, patch);
    });
  };

  const insertBlockAfter = (blockId: string, type: DocBlockType) => {
    patchDoc((d) => {
      const i = d.blocks.findIndex((x) => x.id === blockId);
      if (i < 0) return;
      const nb = emptyBlock(type);
      d.blocks.splice(i + 1, 0, nb);
      setActiveBlockId(nb.id);
    });
  };

  const appendBlock = (type: DocBlockType) => {
    patchDoc((d) => {
      const nb = emptyBlock(type);
      d.blocks.push(nb);
      setActiveBlockId(nb.id);
    });
  };

  const removeBlock = (blockId: string) => {
    patchDoc((d) => {
      if (d.blocks.length <= 1) return;
      d.blocks = d.blocks.filter((x) => x.id !== blockId);
    });
  };

  const moveBlock = (blockId: string, dir: -1 | 1) => {
    patchDoc((d) => {
      const i = d.blocks.findIndex((x) => x.id === blockId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.blocks.length) return;
      const [b] = d.blocks.splice(i, 1);
      d.blocks.splice(j, 0, b);
    });
  };

  const addChoice = (blockId: string) => {
    patchDoc((d) => {
      const b = d.blocks.find((x) => x.id === blockId);
      if (b && b.choices) b.choices.push({ id: uid(), label: '' });
    });
  };
  const removeChoice = (blockId: string, choiceId: string) => {
    patchDoc((d) => {
      const b = d.blocks.find((x) => x.id === blockId);
      if (b && b.choices) b.choices = b.choices.filter((c) => c.id !== choiceId);
    });
  };

  const convertToFlow = () => {
    if (!selected) return;
    if (selected.blocks.filter((b) => b.type !== 'note').length === 0) {
      alert('文档里没有可转换的块(全是注释)。');
      return;
    }
    const flow = documentToFlow(selected);
    update((p) => p.flows.push(flow));
    go({ tab: 'flow', flowId: flow.id });
  };

  const stats = useMemo(() => {
    if (!selected) return null;
    let words = 0, dialogues = 0;
    const speakers = new Map<string, number>();
    for (const b of selected.blocks) {
      const len = b.text.length + (b.instruction?.length ?? 0) + (b.condition?.length ?? 0)
        + (b.choices?.reduce((s, c) => s + c.label.length, 0) ?? 0);
      words += len;
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

  return (
    <>
      <NavigatorTree
        module="document"
        title="文档"
        items={filtered}
        selectedId={selectedId}
        getLabel={(document) => document.name}
        getDetail={(document) => document.category}
        onSelect={(id) => { setSelectedId(id); setActiveBlockId(null); }}
        onMove={(id, folderId) => updateDocument(id, (document) => { document.folderId = folderId; })}
        onCreate={createDoc}
        createLabel="新建文档"
        emptyLabel="还没有文档"
      />

      <div className="pane-col">
        <div className="toolbar">
          <button className="primary" onClick={createDoc}>＋ 新文档</button>
          <select value={catFilter} onChange={(event) => setCatFilter(event.target.value)} style={{ width: 120 }}>
            <option value="all">全部分类</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <button className="ghost icon-btn" onClick={addCategory} title="新建分类">＋</button>
          {catFilter !== 'all' && <button className="ghost icon-btn" onClick={() => removeCategory(catFilter)} title="删除当前分类">×</button>}
          <input
            placeholder="搜索文档…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 260 }}
          />
          <span className="hint">在结构化剧本块里起草,再「转为流程」生成节点图</span>
        </div>

        {selected ? (
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

            <div className="doc-blocks">
              {selected.blocks.map((b, i) => (
                <div key={b.id} className={`doc-block ${b.type} ${activeBlockId === b.id ? 'active' : ''}`} onClick={() => setActiveBlockId(b.id)}>
                  <div className="doc-block-side">
                    <span className="doc-block-kind" title={DOC_BLOCK_LABEL[b.type]}>{DOC_BLOCK_LABEL[b.type]}</span>
                    <div className="doc-block-tools">
                      <button className="ghost icon-btn" title="上移" onClick={(e) => { e.stopPropagation(); moveBlock(b.id, -1); }}>↑</button>
                      <button className="ghost icon-btn" title="下移" onClick={(e) => { e.stopPropagation(); moveBlock(b.id, 1); }}>↓</button>
                      <button className="ghost icon-btn" title="删除块" onClick={(e) => { e.stopPropagation(); removeBlock(b.id); }}><Icon name="trash" size={12} /></button>
                    </div>
                  </div>
                  <div className="doc-block-main">
                    {b.type === 'dialogue' && (
                      <div className="doc-speaker-row">
                        <select
                          value={b.speakerId ?? ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => patchBlock(b.id, { speakerId: e.target.value || undefined })}
                        >
                          <option value="">(无说话人 / 旁白)</option>
                          {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    )}
                    {b.type === 'choice' ? (
                      <div className="doc-choices">
                        {b.choices?.map((c) => (
                          <div key={c.id} className="doc-choice-row">
                            <span className="doc-choice-mark">▸</span>
                            <input
                              value={c.label}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => patchDoc((d) => {
                                const bb = d.blocks.find((x) => x.id === b.id);
                                const cc = bb?.choices?.find((x) => x.id === c.id);
                                if (cc) cc.label = e.target.value;
                              })}
                              placeholder="选项文本(如:接受 / 拒绝)"
                            />
                            <button className="ghost icon-btn" onClick={(e) => { e.stopPropagation(); removeChoice(b.id, c.id); }}>×</button>
                          </div>
                        ))}
                        <button className="ghost" style={{ alignSelf: 'start' }} onClick={(e) => { e.stopPropagation(); addChoice(b.id); }}>＋ 选项</button>
                      </div>
                    ) : b.type === 'condition' ? (
                      <input
                        className="doc-code-input"
                        value={b.condition ?? ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patchBlock(b.id, { condition: e.target.value })}
                        placeholder="变量表达式,如:met_jiang && trust > 5"
                      />
                    ) : b.type === 'instruction' ? (
                      <input
                        className="doc-code-input"
                        value={b.instruction ?? ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patchBlock(b.id, { instruction: e.target.value })}
                        placeholder="指令,如:trust = trust + 1"
                      />
                    ) : b.type === 'action' || b.type === 'dialogue' ? (
                      <RichTextInput
                        value={b.text}
                        onChange={(v) => patchBlock(b.id, { text: v })}
                        placeholder={b.type === 'dialogue' ? '台词内容(可用 **粗** *斜* ~~删~~)' : '动作 / 旁白描述'}
                      />
                    ) : (
                      <textarea
                        rows={b.type === 'heading' ? 1 : Math.max(2, Math.ceil((b.text.length || 1) / 30))}
                        value={b.text}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patchBlock(b.id, { text: e.target.value })}
                        placeholder={
                          b.type === 'heading' ? '场景标题,如:雨夜酒馆' :
                          '注释内容(不进入流程)'
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="doc-insert-bar">
              {BLOCK_TYPES.map((t) => (
                <button key={t} className="ghost" onClick={() => appendBlock(t)} title={`追加「${DOC_BLOCK_LABEL[t]}」块`}>
                  ＋ {DOC_BLOCK_LABEL[t]}
                </button>
              ))}
            </div>
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
        <aside className="inspector">
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
              onClick={() => {
                if (!confirm(`删除文档「${selected.name}」?`)) return;
                removeDocument(selected.id);
                setSelectedId(null);
              }}
            ><Icon name="trash" size={14} /></button>
          </div>

          {stats && (
            <div className="doc-stats">
              <div>字数 {stats.words} · 对白 {stats.dialogues} 段</div>
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
            <label>块类型说明</label>
            <ul className="doc-legend">
              <li><b>场景</b> → 片段节点(章节锚)</li>
              <li><b>动作</b> → 对白节点(无说话人)</li>
              <li><b>对白</b> → 对白节点(带说话人)</li>
              <li><b>选项</b> → 汇聚点(分支提示)</li>
              <li><b>条件</b> → 条件节点(真/假引脚)</li>
              <li><b>指令</b> → 指令节点(变量赋值)</li>
              <li><b>注释</b> → 不进入流程</li>
            </ul>
          </div>
        </aside>
      )}
    </>
  );
}
