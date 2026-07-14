import { ANNOTATION_TYPES } from './types';
import type { DocBlock, Document, Entity, Flow, FlowEdge, FlowNode, Project, SubFlow } from './types';

/**
 * 流程 → 剧本式 Markdown
 *
 * 分支图按「段落」切分:线性链为一段,分支/汇聚处断开,
 * 段尾标注去向(→ 转到 §n),支持环与任意结构。
 * 剧情片段的子流程递归内嵌,段号带层级前缀(§2.1)。
 */

interface Segment {
  leader: string;
  nodes: FlowNode[];
}

function splitSegments(sub: SubFlow): Segment[] {
  const outEdges = new Map<string, FlowEdge[]>();
  const inDeg = new Map<string, number>();
  for (const n of sub.nodes) {
    outEdges.set(n.id, []);
    inDeg.set(n.id, 0);
  }
  for (const e of sub.edges) {
    outEdges.get(e.source)?.push(e);
    if (inDeg.has(e.target)) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  const leaders = new Set<string>();
  for (const n of sub.nodes) {
    if ((inDeg.get(n.id) ?? 0) !== 1) leaders.add(n.id); // 起点、汇聚点、孤立点
  }
  for (const n of sub.nodes) {
    const outs = outEdges.get(n.id) ?? [];
    if (outs.length > 1) for (const e of outs) leaders.add(e.target); // 分支目标
  }

  const byId = new Map(sub.nodes.map((n) => [n.id, n]));
  const inSegment = new Set<string>();
  const segments: Segment[] = [];

  const build = (leaderId: string) => {
    if (inSegment.has(leaderId)) return;
    const seg: Segment = { leader: leaderId, nodes: [] };
    let cur = byId.get(leaderId);
    while (cur && !inSegment.has(cur.id)) {
      seg.nodes.push(cur);
      inSegment.add(cur.id);
      const outs = outEdges.get(cur.id) ?? [];
      if (outs.length !== 1) break;
      const next = outs[0].target;
      if (leaders.has(next)) break;
      cur = byId.get(next);
    }
    if (seg.nodes.length > 0) segments.push(seg);
  };

  for (const n of sub.nodes) if (leaders.has(n.id)) build(n.id);
  for (const n of sub.nodes) if (!inSegment.has(n.id)) { leaders.add(n.id); build(n.id); } // 纯环兜底

  return segments;
}

function branchLabel(e: FlowEdge, target: FlowNode | undefined, source?: FlowNode): string {
  const parts: string[] = [];
  if (e.sourceHandle === 'true') parts.push('✓ 真');
  else if (e.sourceHandle === 'false') parts.push('✗ 假');
  else if (e.sourceHandle === 'success') parts.push('✓ 成功');
  else if (e.sourceHandle === 'fail') parts.push('✗ 失败');
  else if (e.sourceHandle?.startsWith('exit:')) {
    const exitNode = source?.data.sub?.nodes.find((x) => x.id === e.sourceHandle!.slice(5));
    parts.push(`⇥ 经出口「${exitNode?.data.title || '出口'}」`);
  }
  if (typeof e.label === 'string' && e.label) parts.push(e.label);
  if (parts.length === 0 && target) parts.push(target.data.title || '继续');
  if (e.condition) parts.push(`〔条件 \`${e.condition}\`〕`);
  if (e.effect) parts.push(`〔效果 \`${e.effect}\`〕`);
  if (e.once) parts.push('〔一次性〕');
  if (e.fallback) parts.push('〔兜底〕');
  return parts.join(' · ');
}

function renderContainer(raw: SubFlow, entities: Entity[], prefix: string): string {
  // 注释与分区不进入文稿
  const sub: SubFlow = { nodes: raw.nodes.filter((n) => !ANNOTATION_TYPES.has(n.type)), edges: raw.edges };
  const segments = splitSegments(sub);
  const segIndex = new Map<string, number>();
  segments.forEach((s, i) => { for (const n of s.nodes) segIndex.set(n.id, i + 1); });
  const byId = new Map(sub.nodes.map((n) => [n.id, n]));
  const lines: string[] = [];

  segments.forEach((seg, i) => {
    const no = `§${prefix}${i + 1}`;
    if (segments.length > 1 || prefix) lines.push(`**${no}**`, '');

    seg.nodes.forEach((n, ni) => {
      // 段内续行:边上带标签 / 经出口·条件引脚时,补一行注记
      if (ni > 0) {
        const prev = seg.nodes[ni - 1];
        const link = sub.edges.find((e) => e.source === prev.id && e.target === n.id);
        if (link && (link.label || link.sourceHandle)) {
          lines.push(`*── ${branchLabel(link, undefined, prev) || '继续'} ──*`, '');
        }
      }
      switch (n.type) {
        case 'dialogue': {
          const sp = entities.find((e) => e.id === n.data.speakerId);
          const who = sp ? sp.name : n.data.title || '对白';
          lines.push(`**${who}**:${n.data.text || '(空)'}`, '');
          break;
        }
        case 'fragment': {
          lines.push(`▦ **${n.data.title || '剧情片段'}**${n.data.text ? ` — ${n.data.text}` : ''}`, '');
          if (n.data.sub && n.data.sub.nodes.length > 0) {
            const inner = renderContainer(n.data.sub, entities, `${prefix}${i + 1}.`);
            lines.push(...inner.split('\n').map((l) => (l ? `> ${l}` : '>')), '');
          }
          break;
        }
        case 'hub':
          lines.push(`◈ ${n.data.title || '汇聚点'}`, '');
          break;
        case 'condition':
          lines.push(`❓ 条件:\`${n.data.text || '(未填写)'}\``, '');
          break;
        case 'instruction':
          lines.push(`⚙ 指令:\`${n.data.text || '(未填写)'}\``, '');
          break;
        case 'jump':
          lines.push(`↪ 跳转:${n.data.text || n.data.title || '(未指定)'}`, '');
          break;
        case 'exit':
          lines.push(`⇥ 出口「${n.data.title || '出口'}」`, '');
          break;
        case 'check':
          lines.push(`🎲 ${n.data.checkRed ? '红色' : '白色'}检定:\`2d6 + ${n.data.checkExpr || '0'} ≥ ${n.data.checkDc ?? 10}\`${n.data.text ? ` — ${n.data.text}` : ''}`, '');
          break;
      }
    });

    // 段尾去向
    const last = seg.nodes[seg.nodes.length - 1];
    const outs = sub.edges.filter((e) => e.source === last.id);
    const nextInSeg = outs.length === 1 && segIndex.get(outs[0].target) === i + 1
      && seg.nodes.some((n) => n.id === outs[0].target);
    if (outs.length === 0) {
      if (last.type !== 'exit' && last.type !== 'jump') lines.push('*(本线结束)*', '');
    } else if (!nextInSeg) {
      for (const e of outs) {
        const target = byId.get(e.target);
        const to = segIndex.get(e.target);
        lines.push(`- ${branchLabel(e, target, last)} → §${prefix}${to ?? '?'}`);
      }
      lines.push('');
    }
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function flowToMarkdown(flow: Flow, entities: Entity[]): string {
  return `## ${flow.name}\n\n${renderContainer(flow, entities, '')}\n`;
}

export function projectToMarkdown(p: Project): string {
  const parts = [`# ${p.name}`, ''];
  for (const flow of p.flows) parts.push(flowToMarkdown(flow, p.entities), '');
  return parts.join('\n');
}

export function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- 文档 → Markdown(剧本格式) ---------- */

function speakerName(b: DocBlock, entities: Entity[]): string {
  if (!b.speakerId) return '';
  return entities.find((e) => e.id === b.speakerId)?.name ?? '';
}

function blockToLines(b: DocBlock, entities: Entity[]): string[] {
  switch (b.type) {
    case 'heading':
      return [`## ${b.text || '(未命名场景)'}`, ''];
    case 'action':
      return [b.text || '(空动作)', ''];
    case 'dialogue': {
      const who = speakerName(b, entities);
      return who ? [`**${who}**:${b.text || '(空台词)'}`, ''] : [b.text || '(空对白)', ''];
    }
    case 'choice': {
      const labels = (b.choices ?? []).map((c) => c.label).filter(Boolean);
      const head = b.text ? `${b.text}` : '选项点';
      const lines = [`*◇ ${head}*`, ''];
      if (labels.length) for (const l of labels) lines.push(`- ▸ ${l}`);
      return [...lines, ''];
    }
    case 'condition':
      return [`*◇ 条件 \`${b.condition || '(未填写)'}\`*`, ''];
    case 'instruction':
      return [`*⚙ 指令 \`${b.instruction || '(未填写)'}\`*`, ''];
    case 'note':
      return b.text ? [`<!-- ${b.text} -->`, ''] : [];
    default:
      return [];
  }
}

export function documentToMarkdown(doc: Document, entities: Entity[]): string {
  const lines: string[] = [`# ${doc.name}`, ''];
  if (doc.notes.trim()) lines.push(`> ${doc.notes.trim().replace(/\n/g, '\n> ')}`, '');
  for (const b of doc.blocks) lines.push(...blockToLines(b, entities));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
