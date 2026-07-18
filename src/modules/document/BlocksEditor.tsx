import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { uid, useLoom } from '../../store';
import Icon from '../../components/Icon';
import { RichTextInput } from '../../components/RichText';
import ScriptInput from '../../components/ScriptInput';
import { promptText } from '../../dialog';
import type { DocBlock, DocBlockType, Document } from '../../types';
import { DOC_BLOCK_LABEL } from '../../types';
import { walkFlowNodes } from '../../util';
import StaticBlock from './StaticBlock';

const COMMON_TYPES: DocBlockType[] = ['paragraph', 'action', 'dialogue'];
const MORE_TYPES: DocBlockType[] = ['heading', 'subheading', 'quote', 'list', 'choice', 'condition', 'instruction', 'note'];
const SLASH_TYPES = [...COMMON_TYPES, ...MORE_TYPES];

export function emptyBlock(type: DocBlockType): DocBlock {
  const b: DocBlock = { id: uid(), type, text: '' };
  if (type === 'paragraph') b.flowRole = 'none';
  if (type === 'choice') b.choices = [{ id: uid(), label: '' }];
  if (type === 'condition') b.condition = '';
  if (type === 'instruction') b.instruction = '';
  if (type === 'subheading') b.level = 3;
  if (type === 'list') { b.items = ['']; b.ordered = false; }
  return b;
}

export default function BlocksEditor({
  doc,
  focusBlockId,
  annotationCounts,
  onActiveChange,
  variant = 'writing',
}: {
  doc: Document;
  focusBlockId?: string | null;
  annotationCounts?: Map<string, number>;
  onActiveChange?: (blockId: string | null) => void;
  variant?: 'writing' | 'structure';
}) {
  const entities = useLoom((s) => s.project.entities);
  const flows = useLoom((s) => s.project.flows);
  const updateDocument = useLoom((s) => s.updateDocument);
  const addEntity = useLoom((s) => s.addEntity);
  const [activeBlockId, setActiveBlockIdRaw] = useState<string | null>(focusBlockId ?? doc.blocks[0]?.id ?? null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(focusBlockId ?? null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [typeMenuBlockId, setTypeMenuBlockId] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [speakerDrafts, setSpeakerDrafts] = useState<Record<string, string>>({});

  const setActiveBlockId = (id: string | null) => {
    setActiveBlockIdRaw(id);
    onActiveChange?.(id);
  };

  useEffect(() => {
    if (focusBlockId !== undefined) {
      setActiveBlockId(focusBlockId);
      setPendingFocusId(focusBlockId);
    }
  }, [focusBlockId]);

  useEffect(() => {
    if (!pendingFocusId) return;
    const el = document.querySelector<HTMLElement>(`[data-doc-input="${pendingFocusId}"]`);
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
    setPendingFocusId(null);
  }, [doc.blocks, pendingFocusId, variant]);

  const characters = useMemo(() => entities.filter((e) => e.kind === 'character'), [entities]);
  const characterById = useMemo(() => new Map(characters.map((e) => [e.id, e])), [characters]);
  const flowUnitIds = useMemo(() => {
    const set = new Set<string>();
    for (const f of flows) {
      walkFlowNodes(f.nodes, (n) => {
        if (typeof n.data.unitId === 'string') set.add(n.data.unitId);
      });
    }
    return set;
  }, [flows]);

  const activeBlock = doc.blocks.find((b) => b.id === activeBlockId);
  const slashQuery = activeBlock?.type === 'paragraph' && activeBlock.text.startsWith('/')
    ? activeBlock.text.slice(1).trim().toLowerCase()
    : null;
  const slashMatches = slashQuery === null
    ? []
    : SLASH_TYPES.filter((type) =>
      DOC_BLOCK_LABEL[type].includes(slashQuery) || type.includes(slashQuery));

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  const patchDoc = (fn: (d: Document) => void) => updateDocument(doc.id, fn);

  const patchBlock = (blockId: string, patch: Partial<DocBlock>) => {
    patchDoc((d) => {
      const b = d.blocks.find((x) => x.id === blockId);
      if (b) Object.assign(b, patch);
    });
  };

  const insertBlock = (type: DocBlockType, afterId = activeBlockId) => {
    const nb = emptyBlock(type);
    patchDoc((d) => {
      const index = afterId ? d.blocks.findIndex((b) => b.id === afterId) : -1;
      d.blocks.splice(index >= 0 ? index + 1 : d.blocks.length, 0, nb);
    });
    setActiveBlockId(nb.id);
    setPendingFocusId(nb.id);
    setMoreOpen(false);
  };

  const removeBlock = (blockId: string) => {
    const index = doc.blocks.findIndex((b) => b.id === blockId);
    if (index < 0 || doc.blocks.length <= 1) return;
    const nextFocus = doc.blocks[Math.max(0, index - 1)]?.id ?? null;
    patchDoc((d) => { d.blocks = d.blocks.filter((x) => x.id !== blockId); });
    setActiveBlockId(nextFocus);
    setPendingFocusId(nextFocus);
  };

  const moveBlock = (blockId: string, dir: -1 | 1) => {
    patchDoc((d) => {
      const i = d.blocks.findIndex((x) => x.id === blockId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.blocks.length) return;
      const [b] = d.blocks.splice(i, 1);
      d.blocks.splice(j, 0, b);
    });
    setPendingFocusId(blockId);
  };

  const moveBlockBefore = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    patchDoc((d) => {
      const from = d.blocks.findIndex((b) => b.id === sourceId);
      const target = d.blocks.findIndex((b) => b.id === targetId);
      if (from < 0 || target < 0) return;
      const [block] = d.blocks.splice(from, 1);
      const nextTarget = d.blocks.findIndex((b) => b.id === targetId);
      d.blocks.splice(nextTarget, 0, block);
    });
  };

  const changeBlockType = (blockId: string, type: DocBlockType) => {
    patchDoc((d) => {
      const index = d.blocks.findIndex((b) => b.id === blockId);
      if (index < 0) return;
      const current = d.blocks[index];
      const next = emptyBlock(type);
      next.id = current.id;
      next.text = current.text.startsWith('/') ? '' : current.text;
      d.blocks[index] = next;
    });
    setActiveBlockId(blockId);
    setPendingFocusId(blockId);
    setTypeMenuBlockId(null);
  };

  const addChoice = (blockId: string) => {
    patchDoc((d) => {
      const b = d.blocks.find((x) => x.id === blockId);
      if (b?.choices) b.choices.push({ id: uid(), label: '' });
    });
  };

  const removeChoice = (blockId: string, choiceId: string) => {
    patchDoc((d) => {
      const b = d.blocks.find((x) => x.id === blockId);
      if (b?.choices) b.choices = b.choices.filter((c) => c.id !== choiceId);
    });
  };

  const createSpeaker = async (blockId: string) => {
    const name = await promptText({ message: '新角色名称', placeholder: '角色名称', confirmText: '创建并选中' });
    if (!name?.trim()) return;
    const existing = characters.find((c) => c.name === name.trim());
    if (existing) {
      patchBlock(blockId, { speakerId: existing.id });
      setSpeakerDrafts((s) => ({ ...s, [blockId]: existing.name }));
      return;
    }
    const entity = {
      id: uid(),
      kind: 'character' as const,
      name: name.trim(),
      color: '#333333',
      emoji: '',
      summary: '',
      fields: [],
      notes: '',
      createdAt: Date.now(),
    };
    addEntity(entity);
    patchBlock(blockId, { speakerId: entity.id });
    setSpeakerDrafts((s) => ({ ...s, [blockId]: entity.name }));
  };

  const handleTextKey = (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>, b: DocBlock) => {
    if (e.nativeEvent.isComposing) return;
    if (slashQuery !== null && slashMatches.length > 0 && b.id === activeBlockId) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        changeBlockType(b.id, slashMatches[Math.min(slashIndex, slashMatches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        patchBlock(b.id, { text: '' });
        return;
      }
    }
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      moveBlock(b.id, -1);
      return;
    }
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      moveBlock(b.id, 1);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const nextType: DocBlockType = b.type === 'heading' || b.type === 'subheading' || b.type === 'dialogue'
        ? 'paragraph'
        : b.type === 'paragraph' || b.type === 'action' ? b.type : 'paragraph';
      insertBlock(nextType, b.id);
      return;
    }
    if (e.key === 'Backspace' && b.text === '' && doc.blocks.length > 1) {
      e.preventDefault();
      removeBlock(b.id);
    }
  };

  const renderSpeaker = (b: DocBlock) => {
    const selectedName = b.speakerId ? characterById.get(b.speakerId)?.name ?? '' : '';
    const value = speakerDrafts[b.id] ?? selectedName;
    return (
      <div className="doc-speaker-row">
        <input
          list={`doc-speakers-${b.id}`}
          value={value}
          placeholder="输入或选择说话人"
          onFocus={() => {
            setActiveBlockId(b.id);
            setSpeakerDrafts((s) => ({ ...s, [b.id]: selectedName }));
          }}
          onChange={(e) => {
            const name = e.target.value;
            setSpeakerDrafts((s) => ({ ...s, [b.id]: name }));
            const found = characters.find((c) => c.name === name);
            if (found || name === '') patchBlock(b.id, { speakerId: found?.id });
          }}
          onBlur={() => setSpeakerDrafts((s) => ({ ...s, [b.id]: characterById.get(b.speakerId ?? '')?.name ?? '' }))}
        />
        <datalist id={`doc-speakers-${b.id}`}>
          {characters.map((c) => <option key={c.id} value={c.name} />)}
        </datalist>
        <button className="ghost" type="button" onClick={() => createSpeaker(b.id)}>＋ 角色</button>
      </div>
    );
  };

  const renderTextEditor = (b: DocBlock) => {
    if (b.type === 'paragraph' || b.type === 'action' || b.type === 'dialogue') {
      return (
        <>
          {b.type === 'dialogue' && renderSpeaker(b)}
          <RichTextInput
            value={b.text}
            onChange={(text) => patchBlock(b.id, { text })}
            rows={Math.max(2, Math.min(12, b.text.split('\n').length + Math.ceil(b.text.length / 72)))}
            inputId={b.id}
            onFocus={() => setActiveBlockId(b.id)}
            onKeyDown={(e) => handleTextKey(e, b)}
            placeholder={
              b.type === 'dialogue'
                ? '台词内容'
                : b.type === 'action'
                  ? '动作 / 旁白描述'
                  : '开始写作，输入 / 可切换块类型'
            }
          />
        </>
      );
    }
    if (b.type === 'choice') {
      return (
        <div className="doc-choices">
          <input
            data-doc-input={b.id}
            value={b.text}
            placeholder="选项提示"
            onFocus={() => setActiveBlockId(b.id)}
            onChange={(e) => patchBlock(b.id, { text: e.target.value })}
          />
          {b.choices?.map((c) => (
            <div key={c.id} className="doc-choice-row">
              <span className="doc-choice-mark">▸</span>
              <input
                value={c.label}
                onChange={(e) => patchDoc((d) => {
                  const choice = d.blocks.find((x) => x.id === b.id)?.choices?.find((x) => x.id === c.id);
                  if (choice) choice.label = e.target.value;
                })}
                placeholder="选项文本"
              />
              <button className="ghost icon-btn" onClick={() => removeChoice(b.id, c.id)}>×</button>
            </div>
          ))}
          <button className="ghost" style={{ alignSelf: 'start' }} onClick={() => addChoice(b.id)}>＋ 选项</button>
        </div>
      );
    }
    if (b.type === 'condition') {
      return (
        <ScriptInput
          mode="condition"
          value={b.condition ?? ''}
          onChange={(value) => patchBlock(b.id, { condition: value })}
          rows={1}
          placeholder="变量表达式，如 met_jiang && trust > 5"
        />
      );
    }
    if (b.type === 'instruction') {
      return (
        <ScriptInput
          mode="instruction"
          value={b.instruction ?? ''}
          onChange={(value) => patchBlock(b.id, { instruction: value })}
          rows={1}
          placeholder="指令，如 trust = trust + 1"
        />
      );
    }
    if (b.type === 'subheading') {
      return (
        <div className="doc-subheading-row">
          <select
            value={b.level ?? 3}
            onChange={(e) => patchBlock(b.id, { level: Number(e.target.value) as 2 | 3 })}
          >
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
          <input
            data-doc-input={b.id}
            className={`doc-subheading doc-subheading-${b.level ?? 3}`}
            value={b.text}
            onFocus={() => setActiveBlockId(b.id)}
            onChange={(e) => patchBlock(b.id, { text: e.target.value })}
            onKeyDown={(e) => handleTextKey(e, b)}
            placeholder="子标题"
          />
        </div>
      );
    }
    if (b.type === 'list') {
      return (
        <div className="doc-list">
          <div className="doc-list-tools">
            <select
              value={b.ordered ? 'ol' : 'ul'}
              onChange={(e) => patchBlock(b.id, { ordered: e.target.value === 'ol' })}
            >
              <option value="ul">• 无序</option>
              <option value="ol">1. 有序</option>
            </select>
          </div>
          {(b.items ?? []).map((item, index) => (
            <div key={index} className="doc-list-row">
              <span className="doc-list-marker">{b.ordered ? `${index + 1}.` : '•'}</span>
              <input
                data-doc-input={index === 0 ? b.id : undefined}
                value={item}
                onFocus={() => setActiveBlockId(b.id)}
                onChange={(e) => patchBlock(b.id, {
                  items: (b.items ?? []).map((x, i) => i === index ? e.target.value : x),
                })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const items = [...(b.items ?? [])];
                    items.splice(index + 1, 0, '');
                    patchBlock(b.id, { items });
                  } else if (e.key === 'Backspace' && item === '' && (b.items ?? []).length > 1) {
                    e.preventDefault();
                    patchBlock(b.id, { items: (b.items ?? []).filter((_, i) => i !== index) });
                  }
                }}
                placeholder="列表项"
              />
              <button
                className="ghost icon-btn"
                onClick={() => {
                  const items = (b.items ?? []).filter((_, i) => i !== index);
                  patchBlock(b.id, { items: items.length ? items : [''] });
                }}
              >×</button>
            </div>
          ))}
          <button
            className="ghost"
            style={{ alignSelf: 'start' }}
            onClick={() => patchBlock(b.id, { items: [...(b.items ?? []), ''] })}
          >＋ 列表项</button>
        </div>
      );
    }
    return (
      <textarea
        data-doc-input={b.id}
        className={b.type === 'quote' ? 'doc-quote' : undefined}
        rows={b.type === 'heading' ? 1 : Math.max(2, b.text.split('\n').length)}
        value={b.text}
        onFocus={() => setActiveBlockId(b.id)}
        onChange={(e) => patchBlock(b.id, { text: e.target.value })}
        onKeyDown={(e) => handleTextKey(e, b)}
        placeholder={
          b.type === 'heading'
            ? '旧版场景标题块'
            : b.type === 'quote'
              ? '引用内容'
              : '注释内容'
        }
      />
    );
  };

  return (
    <>
      <div className={`doc-blocks doc-blocks-flow doc-blocks-${variant}`}>
        {doc.blocks.map((b) => {
          if (variant === 'structure' && activeBlockId !== b.id) {
            return (
              <div
                key={b.id}
                className={`doc-flow-block doc-flow-${b.type}`}
                draggable
                onDragStart={() => setDragId(b.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragId) moveBlockBefore(dragId, b.id);
                  setDragId(null);
                }}
                onClick={() => {
                  setActiveBlockId(b.id);
                  setPendingFocusId(b.id);
                }}
                title="点击编辑，拖拽重排"
              >
                <span className="doc-block-badges">
                  <span className="doc-block-kind-inline">{DOC_BLOCK_LABEL[b.type]}</span>
                  {b.unitId && flowUnitIds.has(b.unitId) && <span className="doc-block-linked">⇄</span>}
                  {(annotationCounts?.get(b.id) ?? 0) > 0 && <span className="doc-block-anno">💬{annotationCounts!.get(b.id)}</span>}
                </span>
                <div className="doc-flow-body"><StaticBlock b={b} entities={entities} /></div>
              </div>
            );
          }
          const flowRole = b.flowRole ?? (b.type === 'paragraph' ? 'none' : 'node');
          return (
            <div
              key={b.id}
              className={`doc-block doc-writing-block ${b.type}${activeBlockId === b.id ? ' active' : ''}`}
              draggable={variant === 'structure'}
              onDragStart={() => setDragId(b.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragId) moveBlockBefore(dragId, b.id);
                setDragId(null);
              }}
              onClick={() => setActiveBlockId(b.id)}
            >
              <div className="doc-block-side">
                <button
                  className="doc-block-kind doc-kind-button"
                  type="button"
                  title="更改块类型"
                  onClick={() => {
                    setActiveBlockId(b.id);
                    setTypeMenuBlockId((id) => id === b.id ? null : b.id);
                  }}
                >{DOC_BLOCK_LABEL[b.type]}</button>
                {b.unitId && flowUnitIds.has(b.unitId) && <span className="doc-block-linked">⇄</span>}
                {(annotationCounts?.get(b.id) ?? 0) > 0 && <span className="doc-block-anno">💬{annotationCounts!.get(b.id)}</span>}
                <div className="doc-block-tools">
                  <button className="ghost icon-btn" title="上移 Alt+↑" onClick={() => moveBlock(b.id, -1)}>↑</button>
                  <button className="ghost icon-btn" title="下移 Alt+↓" onClick={() => moveBlock(b.id, 1)}>↓</button>
                  <button className="ghost icon-btn" title="删除块" onClick={() => removeBlock(b.id)}><Icon name="trash" size={12} /></button>
                </div>
              </div>
              <div className="doc-block-main">
                {variant === 'structure' && (b.type === 'paragraph' || b.type === 'action' || b.type === 'dialogue') && (
                  <div className="doc-flow-role-row">
                    <span>流程</span>
                    <select
                      value={flowRole}
                      onChange={(e) => {
                        const role = e.target.value as DocBlock['flowRole'];
                        patchBlock(b.id, { flowRole: role, ...(role === 'none' ? { unitId: undefined } : {}) });
                      }}
                    >
                      <option value="none">不参与</option>
                      <option value="beat">节拍节点</option>
                      <option value="node">独立节点</option>
                    </select>
                  </div>
                )}
                {renderTextEditor(b)}
                {(slashQuery !== null && activeBlockId === b.id) || typeMenuBlockId === b.id ? (
                  <div className="doc-slash-menu">
                    {(typeMenuBlockId === b.id ? SLASH_TYPES : slashMatches).length > 0
                      ? (typeMenuBlockId === b.id ? SLASH_TYPES : slashMatches).map((type, index) => (
                      <button
                        key={type}
                        type="button"
                        className={typeMenuBlockId !== b.id && index === slashIndex ? 'selected' : ''}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => changeBlockType(b.id, type)}
                      >
                        <b>{DOC_BLOCK_LABEL[type]}</b>
                        <span>/{type}</span>
                      </button>
                    )) : <div className="hint">没有匹配的块类型</div>}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="doc-insert-bar">
        {COMMON_TYPES.map((type) => (
          <button key={type} className="ghost" onClick={() => insertBlock(type)}>
            ＋ {DOC_BLOCK_LABEL[type]}
          </button>
        ))}
        <button className={moreOpen ? 'primary' : 'ghost'} onClick={() => setMoreOpen((open) => !open)}>
          ＋ 更多
        </button>
        <span className="hint">Enter 新段 · Shift+Enter 换行 · / 切换类型 · Alt+↑↓ 移动</span>
        {moreOpen && (
          <div className="doc-more-types">
            {MORE_TYPES.map((type) => (
              <button key={type} className="ghost" onClick={() => insertBlock(type)}>
                {DOC_BLOCK_LABEL[type]}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
