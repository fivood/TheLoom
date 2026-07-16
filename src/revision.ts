import type { DocBlock, Entity, Project } from './types';

/* ---------- 块 → 可比较的行(版本差异与批注摘要共用) ---------- */

export function blockLines(b: DocBlock, entityName: (id?: string) => string): string[] {
  switch (b.type) {
    case 'heading': return [`【场景】${b.text}`];
    case 'subheading': return [`${b.level === 2 ? '##' : '###'} ${b.text}`];
    case 'action': return b.text.split('\n');
    case 'dialogue': {
      const name = b.speakerId ? entityName(b.speakerId) : '';
      const lines = b.text.split('\n');
      return lines.map((line, i) => (i === 0 && name ? `${name}:${line}` : line));
    }
    case 'quote': return b.text.split('\n').map((line) => `> ${line}`);
    case 'list': return (b.items ?? []).map((item, i) => (b.ordered ? `${i + 1}. ${item}` : `- ${item}`));
    case 'choice': return [b.text || '(选项)', ...(b.choices ?? []).map((c) => `○ ${c.label}`)];
    case 'condition': return [`条件:${b.condition ?? ''}`];
    case 'instruction': return [`指令:${b.instruction ?? ''}`];
    case 'note': return [`// ${b.text}`];
  }
}

export function docLines(blocks: DocBlock[], entities: Entity[]): string[] {
  const byId = new Map(entities.map((e) => [e.id, e.name]));
  const nameOf = (id?: string) => (id ? byId.get(id) ?? '(未知)' : '');
  return blocks.flatMap((b) => blockLines(b, nameOf));
}

/* ---------- 行级差异(LCS) ---------- */

export interface DiffOp {
  type: 'same' | 'add' | 'del';
  text: string;
}

/** 超过这个规模(裁剪公共首尾后中段行数乘积)退化为整段删除 + 整段新增,避免 DP 卡顿 */
const DIFF_DP_LIMIT = 1_000_000;

export function diffLines(a: string[], b: string[]): DiffOp[] {
  // 裁剪公共前缀 / 后缀,绝大多数修订只动中间一小段
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const head: DiffOp[] = a.slice(0, start).map((text) => ({ type: 'same', text }));
  const tail: DiffOp[] = a.slice(endA).map((text) => ({ type: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let mid: DiffOp[];
  if (midA.length === 0) {
    mid = midB.map((text) => ({ type: 'add' as const, text }));
  } else if (midB.length === 0) {
    mid = midA.map((text) => ({ type: 'del' as const, text }));
  } else if (midA.length * midB.length > DIFF_DP_LIMIT) {
    mid = [
      ...midA.map((text) => ({ type: 'del' as const, text })),
      ...midB.map((text) => ({ type: 'add' as const, text })),
    ];
  } else {
    // 标准 LCS 动态规划
    const n = midA.length;
    const m = midB.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    mid = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        mid.push({ type: 'same', text: midA[i] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        mid.push({ type: 'del', text: midA[i] });
        i++;
      } else {
        mid.push({ type: 'add', text: midB[j] });
        j++;
      }
    }
    while (i < n) { mid.push({ type: 'del', text: midA[i] }); i++; }
    while (j < m) { mid.push({ type: 'add', text: midB[j] }); j++; }
  }

  return [...head, ...mid, ...tail];
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'add') added++;
    else if (op.type === 'del') removed++;
  }
  return { added, removed };
}

/* ---------- 全局查找替换(文档正文) ---------- */

export type ReplaceField = 'text' | 'item' | 'choice' | 'condition' | 'instruction';

export interface ReplaceMatch {
  /** 稳定键:docId:blockId:field:index */
  key: string;
  docId: string;
  docName: string;
  blockId: string;
  field: ReplaceField;
  /** item / choice 的下标 */
  index?: number;
  /** 该字段内命中的次数 */
  count: number;
  /** 命中上下文摘要 */
  preview: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchRegex(query: string, caseSensitive: boolean): RegExp {
  return new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
}

function previewOf(text: string, query: string, caseSensitive: boolean): string {
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const i = hay.indexOf(needle);
  if (i < 0) return text.slice(0, 60);
  const start = Math.max(0, i - 18);
  const end = Math.min(text.length, i + query.length + 30);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/** 遍历一个块的全部可替换字段 */
function blockFields(b: DocBlock): { field: ReplaceField; index?: number; value: string }[] {
  const out: { field: ReplaceField; index?: number; value: string }[] = [];
  if (b.text) out.push({ field: 'text', value: b.text });
  (b.items ?? []).forEach((item, i) => { if (item) out.push({ field: 'item', index: i, value: item }); });
  (b.choices ?? []).forEach((c, i) => { if (c.label) out.push({ field: 'choice', index: i, value: c.label }); });
  if (b.condition) out.push({ field: 'condition', value: b.condition });
  if (b.instruction) out.push({ field: 'instruction', value: b.instruction });
  return out;
}

export function findDocMatches(p: Project, query: string, caseSensitive: boolean): ReplaceMatch[] {
  if (!query) return [];
  const re = matchRegex(query, caseSensitive);
  const out: ReplaceMatch[] = [];
  for (const d of p.documents) {
    for (const b of d.blocks) {
      for (const f of blockFields(b)) {
        re.lastIndex = 0;
        const count = (f.value.match(re) ?? []).length;
        if (count > 0) {
          out.push({
            key: `${d.id}:${b.id}:${f.field}:${f.index ?? 0}`,
            docId: d.id,
            docName: d.name,
            blockId: b.id,
            field: f.field,
            index: f.index,
            count,
            preview: previewOf(f.value, query, caseSensitive),
          });
        }
      }
    }
  }
  return out;
}

/**
 * 在项目文档里执行替换(须在 store 的 commit 回调里调用,单步撤销)。
 * keys 为空 = 替换全部命中;返回替换的出现次数。
 */
export function replaceInDocs(
  p: Project, query: string, replacement: string, caseSensitive: boolean, keys?: Set<string>,
): number {
  if (!query) return 0;
  const re = matchRegex(query, caseSensitive);
  let replaced = 0;
  const apply = (value: string): string => value.replace(re, () => { replaced++; return replacement; });
  for (const d of p.documents) {
    let touched = false;
    for (const b of d.blocks) {
      for (const f of blockFields(b)) {
        const key = `${d.id}:${b.id}:${f.field}:${f.index ?? 0}`;
        if (keys && !keys.has(key)) continue;
        re.lastIndex = 0;
        const before = replaced;
        const next = apply(f.value);
        if (replaced === before) continue;
        touched = true;
        if (f.field === 'text') b.text = next;
        else if (f.field === 'item' && b.items) b.items[f.index!] = next;
        else if (f.field === 'choice' && b.choices) b.choices[f.index!].label = next;
        else if (f.field === 'condition') b.condition = next;
        else if (f.field === 'instruction') b.instruction = next;
      }
    }
    if (touched) d.updatedAt = Date.now();
  }
  return replaced;
}
