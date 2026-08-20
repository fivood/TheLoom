import type { DocBlock, Entity } from './types';
import { uid } from './util';

/**
 * 沉浸写作:块 ↔ 纯 Markdown 文本。
 *
 * 文档的权威结构是「块」(每块带 id / unitId,批注锚在 blockId 上,流程节点靠 unitId
 * 与块共享内容)。纯文本里没有这些标记,所以**回写时靠段落次序重建身份**:
 * 第 n 段沿用原第 n 块的 id / type / speakerId 等,只更新文字;多出来的段落建新块。
 *
 * 这样「只改字」不会丢批注与流程联动;整段增删只影响错位之后的块,和在分块编辑器里
 * 插入 / 删除一个块的后果一样。
 */

/** 段落之间用空行分隔 */
const SEP = '\n\n';

function speakerName(entities: Entity[], id?: string): string {
  if (!id) return '';
  return entities.find((e) => e.id === id)?.name ?? '';
}

/** 一个块渲染成纯文本(块级 Markdown;行内的 **粗** *斜* 本来就存在 text 里) */
export function blockToText(b: DocBlock, entities: Entity[]): string {
  switch (b.type) {
    case 'heading': return `# ${b.text}`;
    case 'subheading': return `${b.level === 2 ? '##' : '###'} ${b.text}`;
    case 'quote': return b.text.split('\n').map((l) => `> ${l}`).join('\n');
    case 'list':
      return (b.items ?? []).map((item, i) => (b.ordered ? `${i + 1}. ${item}` : `- ${item}`)).join('\n');
    case 'dialogue': {
      const name = speakerName(entities, b.speakerId);
      return name ? `${name}：${b.text}` : b.text;
    }
    case 'note': return b.text.split('\n').map((l) => `// ${l}`).join('\n');
    // condition / instruction 是剧本结构,沉浸模式不改写它们的语义,
    // 原样显示表达式以免作者以为内容丢了(回写时按 index 保留原块)
    case 'condition': return b.condition ?? '';
    case 'instruction': return b.instruction ?? '';
    // 选项块把选项文本也渲染成 ▸ 行:只显示提示语时,整段看起来像一行多余的话,
    // 作者随手删掉就静默丢掉全部选项
    case 'choice': {
      const labels = (b.choices ?? []).map((c) => `▸ ${c.label}`);
      return [b.text, ...labels].filter((l) => l !== '').join('\n');
    }
    default: return b.text;
  }
}

export function blocksToText(blocks: DocBlock[], entities: Entity[]): string {
  return blocks.map((b) => blockToText(b, entities)).join(SEP);
}

/** 从一段纯文本推断块级类型与内容;返回 undefined 表示「普通段落」 */
function parseMarkdown(chunk: string): Partial<DocBlock> | undefined {
  const lines = chunk.split('\n');
  const h = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
  if (h && lines.length === 1) {
    if (h[1] === '#') return { type: 'heading', text: h[2] };
    return { type: 'subheading', level: h[1].length === 2 ? 2 : 3, text: h[2] };
  }
  if (lines.every((l) => l.startsWith('>'))) {
    return { type: 'quote', text: lines.map((l) => l.replace(/^>\s?/, '')).join('\n') };
  }
  if (lines.every((l) => /^\d+\.\s/.test(l))) {
    return { type: 'list', ordered: true, items: lines.map((l) => l.replace(/^\d+\.\s/, '')), text: '' };
  }
  if (lines.every((l) => /^[-*]\s/.test(l))) {
    return { type: 'list', ordered: false, items: lines.map((l) => l.replace(/^[-*]\s/, '')), text: '' };
  }
  if (lines.every((l) => l.startsWith('//'))) {
    return { type: 'note', text: lines.map((l) => l.replace(/^\/\/\s?/, '')).join('\n') };
  }
  // 全 ▸ 行 = 无提示语的选项块:不能把第一行当提示语,否则往返会吃掉一个选项
  if (lines.every((l) => l.startsWith('▸'))) {
    return { type: 'choice', text: '', choices: lines.map((l) => ({ id: uid(), label: l.replace(/^▸\s?/, '') })) };
  }
  if (lines.length > 1 && lines.slice(1).every((l) => l.startsWith('▸'))) {
    return { type: 'choice', text: lines[0], choices: lines.slice(1).map((l) => ({ id: uid(), label: l.replace(/^▸\s?/, '') })) };
  }
  return undefined;
}

/**
 * 纯文本回写成块。`prev` 是编辑前的块,用来按次序保住 id / unitId / 说话人。
 *
 * 规则:第 n 段优先沿用 prev[n] —— 若该段没有写成别的块级 Markdown,就只更新文字,
 * 类型与全部结构字段原样保留(action 仍是 action、对白仍挂着原说话人)。
 */
export function textToBlocks(text: string, prev: DocBlock[], entities: Entity[]): DocBlock[] {
  const chunks = text.split(/\n{2,}/).map((c) => c.replace(/\s+$/, '')).filter((c) => c.trim() !== '');
  return chunks.map((chunk, i) => {
    const old = prev[i];
    const md = parseMarkdown(chunk);

    // 写成了明确的块级 Markdown → 按它来,但沿用原 id 保住批注与流程联动
    if (md) {
      const b: DocBlock = { id: old?.id ?? uid(), type: 'paragraph', text: '', ...md } as DocBlock;
      if (old?.unitId) b.unitId = old.unitId;
      // 选项按次序沿用原 choice id,选项上挂着的引用不会因改写而断
      if (b.type === 'choice' && old?.type === 'choice' && old.choices && b.choices) {
        b.choices = b.choices.map((c, i) => ({ ...c, id: old.choices![i]?.id ?? c.id }));
      }
      return b;
    }

    // 普通文字:原块是什么类型就还是什么类型,只换文字
    if (old) {
      const next: DocBlock = { ...old, text: chunk };
      if (old.type === 'dialogue') {
        // 「名字：台词」——名字还对得上就保留说话人,否则视为改了说话人前缀
        const name = speakerName(entities, old.speakerId);
        next.text = name && chunk.startsWith(`${name}：`) ? chunk.slice(name.length + 1) : chunk;
      }
      if (old.type === 'condition') { next.condition = chunk; next.text = old.text; }
      if (old.type === 'instruction') { next.instruction = chunk; next.text = old.text; }
      if (old.type === 'list') { next.items = chunk.split('\n'); next.text = ''; }
      return next;
    }

    return { id: uid(), type: 'paragraph', text: chunk, flowRole: 'none' };
  });
}
