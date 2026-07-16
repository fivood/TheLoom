import { useEffect, useMemo, useState } from 'react';
import { uid, useLoom } from '../../store';
import Icon from '../../components/Icon';
import { RichTextInput } from '../../components/RichText';
import type { DocBlock, DocBlockType, Document } from '../../types';
import { DOC_BLOCK_LABEL } from '../../types';
import { walkFlowNodes } from '../../util';

const BLOCK_TYPES = Object.keys(DOC_BLOCK_LABEL) as DocBlockType[];

export function emptyBlock(type: DocBlockType): DocBlock {
  const b: DocBlock = { id: uid(), type, text: '' };
  if (type === 'choice') b.choices = [{ id: uid(), label: '' }];
  if (type === 'condition') b.condition = '';
  if (type === 'instruction') b.instruction = '';
  if (type === 'subheading') b.level = 3;
  if (type === 'list') { b.items = ['']; b.ordered = false; }
  return b;
}

/** 文档块编辑器:单文档模式与连续稿模式共用(自带插入栏与激活块状态) */
export default function BlocksEditor({ doc, focusBlockId }: { doc: Document; focusBlockId?: string | null }) {
  const entities = useLoom((s) => s.project.entities);
  const flows = useLoom((s) => s.project.flows);
  const updateDocument = useLoom((s) => s.updateDocument);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(focusBlockId ?? null);

  useEffect(() => {
    if (focusBlockId !== undefined) setActiveBlockId(focusBlockId);
  }, [focusBlockId]);

  const characters = useMemo(() => entities.filter((e) => e.kind === 'character'), [entities]);

  // 被流程节点共享的叙事单元 id:文档块显示 ⇄ 标识,提示双向同步
  const flowUnitIds = useMemo(() => {
    const set = new Set<string>();
    for (const f of flows) {
      walkFlowNodes(f.nodes, (n) => {
        if (typeof n.data.unitId === 'string') set.add(n.data.unitId);
      });
    }
    return set;
  }, [flows]);

  const patchDoc = (fn: (d: Document) => void) => updateDocument(doc.id, fn);

  const patchBlock = (blockId: string, patch: Partial<DocBlock>) => {
    patchDoc((d) => {
      const b = d.blocks.find((x) => x.id === blockId);
      if (b) Object.assign(b, patch);
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

  return (
    <>
      <div className="doc-blocks">
        {doc.blocks.map((b) => (
          <div key={b.id} className={`doc-block ${b.type} ${activeBlockId === b.id ? 'active' : ''}`} onClick={() => setActiveBlockId(b.id)}>
            <div className="doc-block-side">
              <span className="doc-block-kind" title={DOC_BLOCK_LABEL[b.type]}>{DOC_BLOCK_LABEL[b.type]}</span>
              {b.unitId && flowUnitIds.has(b.unitId) && (
                <span className="doc-block-linked" title="已与流程节点共享同一叙事单元:任一处修改会双向同步">⇄</span>
              )}
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
              ) : b.type === 'subheading' ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    value={b.level ?? 3}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchBlock(b.id, { level: Number(e.target.value) as 2 | 3 })}
                    style={{ width: 68 }}
                    title="标题层级"
                  >
                    <option value={2}>H2</option>
                    <option value={3}>H3</option>
                  </select>
                  <input
                    className={`doc-subheading doc-subheading-${b.level ?? 3}`}
                    value={b.text}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchBlock(b.id, { text: e.target.value })}
                    placeholder="子标题"
                    style={{ flex: 1 }}
                  />
                </div>
              ) : b.type === 'quote' ? (
                <textarea
                  className="doc-quote"
                  rows={Math.max(2, Math.ceil((b.text.length || 1) / 30))}
                  value={b.text}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => patchBlock(b.id, { text: e.target.value })}
                  placeholder="引用内容(导出为 Markdown 的 > 块)"
                />
              ) : b.type === 'list' ? (
                <div className="doc-list">
                  <div className="doc-list-tools">
                    <select
                      value={b.ordered ? 'ol' : 'ul'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patchBlock(b.id, { ordered: e.target.value === 'ol' })}
                      title="列表类型"
                    >
                      <option value="ul">• 无序</option>
                      <option value="ol">1. 有序</option>
                    </select>
                  </div>
                  {(b.items ?? []).map((item, ii) => (
                    <div key={ii} className="doc-list-row">
                      <span className="doc-list-marker">{b.ordered ? `${ii + 1}.` : '•'}</span>
                      <input
                        value={item}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patchBlock(b.id, {
                          items: (b.items ?? []).map((x, j) => (j === ii ? e.target.value : x)),
                        })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const next = [...(b.items ?? [])];
                            next.splice(ii + 1, 0, '');
                            patchBlock(b.id, { items: next });
                          } else if (e.key === 'Backspace' && item === '' && (b.items ?? []).length > 1) {
                            e.preventDefault();
                            patchBlock(b.id, { items: (b.items ?? []).filter((_, j) => j !== ii) });
                          }
                        }}
                        placeholder="列表项(回车新增,退格删空项)"
                      />
                      <button
                        className="ghost icon-btn"
                        title="删除该项"
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = (b.items ?? []).filter((_, j) => j !== ii);
                          patchBlock(b.id, { items: next.length ? next : [''] });
                        }}
                      >×</button>
                    </div>
                  ))}
                  <button
                    className="ghost"
                    style={{ alignSelf: 'start' }}
                    onClick={(e) => { e.stopPropagation(); patchBlock(b.id, { items: [...(b.items ?? []), ''] }); }}
                  >＋ 列表项</button>
                </div>
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
    </>
  );
}
