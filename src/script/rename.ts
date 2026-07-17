import { lex } from './lexer';

function rewrite(src: string, edits: { start: number; end: number; text: string }[]): string {
  if (edits.length === 0) return src;
  let out = '';
  let pos = 0;
  for (const e of edits.sort((a, b) => a.start - b.start)) {
    out += src.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + src.slice(pos);
}

/** 重命名独立标识符(变量名 / 实体技术名):跳过 `.` 后的字段位置与字符串内容 */
export function renameIdentifier(src: string, oldName: string, newName: string): string {
  if (!src || oldName === newName) return src;
  const tokens = lex(src);
  const edits: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'ident' || t.value !== oldName) continue;
    const prev = tokens[i - 1];
    if (prev && prev.kind === 'punct' && prev.value === '.') continue;
    edits.push({ start: t.start, end: t.end, text: newName });
  }
  return rewrite(src, edits);
}

/** 重命名某实体的字段:只改 `实体技术名.字段` 中的字段部分 */
export function renameEntityField(src: string, entityTech: string, oldField: string, newField: string): string {
  if (!src || oldField === newField) return src;
  const tokens = lex(src);
  const edits: { start: number; end: number; text: string }[] = [];
  for (let i = 2; i < tokens.length; i++) {
    const t = tokens[i];
    const dot = tokens[i - 1];
    const obj = tokens[i - 2];
    if (
      t.kind === 'ident' && t.value === oldField &&
      dot.kind === 'punct' && dot.value === '.' &&
      obj.kind === 'ident' && obj.value === entityTech
    ) {
      edits.push({ start: t.start, end: t.end, text: newField });
    }
  }
  return rewrite(src, edits);
}

/** 重命名 seen("x") / unseen("x") 引用的节点技术名(改字符串参数) */
export function renameSeenTarget(src: string, oldName: string, newName: string): string {
  if (!src || oldName === newName) return src;
  const tokens = lex(src);
  const edits: { start: number; end: number; text: string }[] = [];
  for (let i = 2; i < tokens.length; i++) {
    const t = tokens[i];
    const paren = tokens[i - 1];
    const fn = tokens[i - 2];
    if (
      t.kind === 'string' && t.value === oldName &&
      paren.kind === 'punct' && paren.value === '(' &&
      fn.kind === 'ident' && (fn.value === 'seen' || fn.value === 'unseen')
    ) {
      const quote = t.raw?.[0] ?? '"';
      edits.push({ start: t.start, end: t.end, text: `${quote}${newName}${quote}` });
    }
  }
  return rewrite(src, edits);
}
