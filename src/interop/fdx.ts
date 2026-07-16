/**
 * Final Draft 8/9/10/11/12 的 .fdx(XML)读写。
 *
 * 我们只映射到 FD 的 5 类基础段落:Scene Heading / Action / Character / Parenthetical / Dialogue,
 * 加一类特殊的 Transition,足够描述剧本骨架。
 * FD 的进阶字段(Revision、SmartType 词典、CustomFormatting)一律略过——它们不影响文本本身。
 */

import type { DocBlock, Document, Entity, Flow, FlowNode, Project, SubFlow } from '../types';
import { ANNOTATION_TYPES, DOC_WRITING_TYPES } from '../types';
import { uid } from '../util';

/** FD 段落类型 */
export type FdxParagraphType =
  | 'Scene Heading'
  | 'Action'
  | 'Character'
  | 'Parenthetical'
  | 'Dialogue'
  | 'Transition'
  | 'Shot'
  | 'General';

export interface FdxParagraph {
  type: FdxParagraphType;
  text: string;
}

/* ---------- 写 ---------- */

const XML_ESC: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
};
function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESC[c]).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** 剧本段落列表 → FD 的 .fdx XML */
export function paragraphsToFdx(paragraphs: FdxParagraph[], title = ''): string {
  const body = paragraphs.map((p) => {
    if (p.type === 'Dialogue' || p.type === 'Parenthetical' || p.type === 'Character') {
      // FD 里对白/角色/括号词是同一族,直接 Type 属性区分
      return `    <Paragraph Type="${p.type}"><Text>${xmlEscape(p.text)}</Text></Paragraph>`;
    }
    return `    <Paragraph Type="${p.type}"><Text>${xmlEscape(p.text)}</Text></Paragraph>`;
  }).join('\n');
  const titleTag = title ? `\n    <TitlePage><Content><Paragraph Alignment="Center"><Text>${xmlEscape(title)}</Text></Paragraph></Content></TitlePage>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${body}
  </Content>${titleTag}
</FinalDraft>
`;
}

/** 文档 → FD 段落 */
export function documentToParagraphs(doc: Document, entities: Entity[]): FdxParagraph[] {
  const out: FdxParagraph[] = [];
  const speaker = (id?: string) => (id ? entities.find((e) => e.id === id)?.name : undefined);
  for (const b of doc.blocks) {
    switch (b.type) {
      case 'heading':
        out.push({ type: 'Scene Heading', text: b.text || '(未命名场景)' });
        break;
      case 'subheading':
        // FD 没有子标题,退化为 Action 全大写
        out.push({ type: 'Action', text: (b.text || '').toUpperCase() });
        break;
      case 'action':
        if (b.text) out.push({ type: 'Action', text: b.text });
        break;
      case 'dialogue': {
        const name = speaker(b.speakerId);
        if (name) {
          out.push({ type: 'Character', text: name.toUpperCase() });
          out.push({ type: 'Dialogue', text: b.text || '' });
        } else if (b.text) {
          out.push({ type: 'Action', text: b.text });
        }
        break;
      }
      case 'quote':
        if (b.text) out.push({ type: 'Action', text: b.text.split('\n').map((l) => `> ${l}`).join('\n') });
        break;
      case 'list':
        for (const item of b.items ?? []) if (item.trim()) out.push({ type: 'Action', text: `• ${item}` });
        break;
      case 'choice': {
        const head = b.text ? `选项:${b.text}` : '选项';
        out.push({ type: 'Action', text: head });
        for (const c of b.choices ?? []) if (c.label) out.push({ type: 'Action', text: `▸ ${c.label}` });
        break;
      }
      case 'condition':
        out.push({ type: 'Action', text: `【条件】${b.condition || '(未填写)'}` });
        break;
      case 'instruction':
        out.push({ type: 'Action', text: `【指令】${b.instruction || '(未填写)'}` });
        break;
      case 'note':
        // 注释导出为 FD 通用段落,读者一眼能识别
        if (b.text) out.push({ type: 'General', text: `// ${b.text}` });
        break;
    }
    if (DOC_WRITING_TYPES.has(b.type)) continue;
  }
  return out;
}

/** 流程 → FD 段落(线性遍历本层非注释节点,子流程递归内嵌;分支 label 作为 Action) */
export function flowToParagraphs(flow: Flow, entities: Entity[]): FdxParagraph[] {
  const speaker = (id?: string) => (id ? entities.find((e) => e.id === id)?.name : undefined);
  const out: FdxParagraph[] = [];
  const walk = (sub: SubFlow, depth: number) => {
    const nodes = sub.nodes.filter((n) => !ANNOTATION_TYPES.has(n.type));
    for (const n of nodes) emit(n, depth);
  };
  const emit = (n: FlowNode, depth: number) => {
    const prefix = depth > 0 ? '  '.repeat(depth) : '';
    switch (n.type) {
      case 'fragment': {
        out.push({ type: 'Scene Heading', text: prefix + (n.data.title || '剧情片段') });
        if (n.data.text) out.push({ type: 'Action', text: n.data.text });
        if (n.data.sub && n.data.sub.nodes.length > 0) walk(n.data.sub, depth + 1);
        break;
      }
      case 'dialogue': {
        const name = speaker(n.data.speakerId);
        if (name) {
          out.push({ type: 'Character', text: name.toUpperCase() });
          out.push({ type: 'Dialogue', text: n.data.text || '' });
        } else if (n.data.text) {
          out.push({ type: 'Action', text: n.data.text });
        }
        break;
      }
      case 'hub':
        if (n.data.title) out.push({ type: 'Action', text: `◈ ${n.data.title}` });
        break;
      case 'condition':
        out.push({ type: 'Action', text: `【条件】${n.data.text || '(未填写)'}` });
        break;
      case 'instruction':
        out.push({ type: 'Action', text: `【指令】${n.data.text || '(未填写)'}` });
        break;
      case 'jump':
        out.push({ type: 'Transition', text: `跳转 → ${n.data.text || n.data.title || '(未指定)'}` });
        break;
      case 'exit':
        out.push({ type: 'Transition', text: `⇥ 经「${n.data.title || '出口'}」离开子流程` });
        break;
      case 'check':
        out.push({ type: 'Action', text: `🎲 ${n.data.checkRed ? '红' : '白'}检定 2d6+${n.data.checkExpr || '0'}≥${n.data.checkDc ?? 10}${n.data.text ? ` · ${n.data.text}` : ''}` });
        break;
    }
  };
  walk(flow, 0);
  return out;
}

/* ---------- 读 ---------- */

const XML_UNESC: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (_, ent: string) => {
    if (ent[0] === '#') {
      const n = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    }
    return XML_UNESC[ent.toLowerCase()] ?? '';
  });
}

/** 解析 .fdx 内容 → 段落数组(只取顶层 <Content> 内的段落,忽略 TitlePage) */
export function parseFdx(xml: string): FdxParagraph[] {
  const out: FdxParagraph[] = [];
  const contentM = xml.match(/<Content\b[^>]*>([\s\S]*?)<\/Content>/);
  const scope = contentM ? contentM[1] : xml;
  for (const m of scope.matchAll(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/g)) {
    const attrs = m[1];
    const typeM = attrs.match(/\bType="([^"]+)"/);
    const type = (typeM ? typeM[1] : 'Action') as FdxParagraphType;
    const texts: string[] = [];
    for (const tm of m[2].matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)) texts.push(decodeXml(tm[1]));
    const text = texts.join('').trim();
    if (!text && type !== 'Action') continue;
    out.push({ type, text });
  }
  return out;
}

/**
 * 段落 → TheLoom 文档块。策略:
 *   Scene Heading → heading 块
 *   Action → action 块(相邻同类合并)
 *   Character + 紧接 Dialogue(可能夹一个 Parenthetical) → 一个 dialogue 块
 *   Character + 无 Dialogue → dialogue 块占位
 *   Transition → note 块(不进流程)
 */
export function paragraphsToBlocks(paragraphs: FdxParagraph[], nameToEntityId?: Map<string, string>): DocBlock[] {
  const out: DocBlock[] = [];
  const push = (b: DocBlock) => out.push(b);
  let i = 0;
  while (i < paragraphs.length) {
    const p = paragraphs[i];
    if (p.type === 'Scene Heading') {
      push({ id: uid(), type: 'heading', text: p.text });
      i++;
    } else if (p.type === 'Character') {
      const speakerName = p.text.trim();
      const speakerId = nameToEntityId?.get(speakerName)
        ?? nameToEntityId?.get(speakerName.toUpperCase())
        ?? nameToEntityId?.get(toTitleCase(speakerName));
      // 后续可能是 Parenthetical + Dialogue,或直接 Dialogue
      let paren = '';
      let dialogue = '';
      let j = i + 1;
      while (j < paragraphs.length && (paragraphs[j].type === 'Parenthetical' || paragraphs[j].type === 'Dialogue')) {
        if (paragraphs[j].type === 'Parenthetical') paren = paragraphs[j].text.replace(/^\(|\)$/g, '');
        else dialogue = dialogue ? `${dialogue}\n${paragraphs[j].text}` : paragraphs[j].text;
        j++;
      }
      const text = paren && dialogue ? `(${paren}) ${dialogue}` : (paren ? `(${paren})` : dialogue);
      push({ id: uid(), type: 'dialogue', text, speakerId });
      i = j;
    } else if (p.type === 'Transition') {
      push({ id: uid(), type: 'note', text: `[转场] ${p.text}` });
      i++;
    } else if (p.type === 'Action' || p.type === 'General' || p.type === 'Shot') {
      // 相邻 Action / General 合并成一个 action 块,减少块碎片
      let text = p.text;
      let j = i + 1;
      while (j < paragraphs.length && (paragraphs[j].type === 'Action' || paragraphs[j].type === 'General' || paragraphs[j].type === 'Shot')) {
        text += '\n' + paragraphs[j].text;
        j++;
      }
      push({ id: uid(), type: 'action', text });
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/* ---------- 项目级导入预检 ---------- */

export interface FdxImportPreview {
  paragraphs: FdxParagraph[];
  blocks: DocBlock[];
  unknownSpeakers: string[];
  docName: string;
  paragraphCount: number;
  sceneCount: number;
  dialogueCount: number;
}

/** 解析 fdx 内容并做预检:统计段落、未识别的说话人 */
export function previewFdxImport(xml: string, project: Project, fallbackName = '导入剧本'): FdxImportPreview {
  const paragraphs = parseFdx(xml);
  const nameMap = new Map<string, string>();
  for (const e of project.entities) if (e.name) nameMap.set(e.name, e.id);
  const seenSpeakers = new Set<string>();
  for (const p of paragraphs) {
    if (p.type === 'Character') {
      const name = p.text.trim();
      if (name && !nameMap.get(name) && !nameMap.get(toTitleCase(name))) seenSpeakers.add(name);
    }
  }
  const blocks = paragraphsToBlocks(paragraphs, nameMap);
  const docName = fallbackName;
  return {
    paragraphs,
    blocks,
    unknownSpeakers: [...seenSpeakers].sort(),
    docName,
    paragraphCount: paragraphs.length,
    sceneCount: paragraphs.filter((p) => p.type === 'Scene Heading').length,
    dialogueCount: paragraphs.filter((p) => p.type === 'Dialogue').length,
  };
}
