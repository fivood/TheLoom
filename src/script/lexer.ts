import type { Token } from './ast';

const identStart = /[\p{L}_]/u;
const identPart = /[\p{L}\p{N}_]/u;

const OPS = [
  '===', '!==', '==', '!=', '<=', '>=', '&&', '||',
  '+=', '-=', '*=', '/=',
  '<', '>', '+', '-', '*', '/', '%', '!', '=',
];

/**
 * 词法分析。永不抛出:无法识别的字符生成 error token,由上层报诊断。
 * 标识符允许 Unicode 字母(实体字段名常是中文)。
 */
export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  outer: while (i < n) {
    const ch = src[i];

    if (ch === '\n') {
      tokens.push({ kind: 'newline', value: '\n', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let out = '';
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < n) {
          const esc = src[j + 1];
          out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      if (j >= n) {
        tokens.push({ kind: 'error', value: '字符串没有结束引号', start: i, end: n });
        break;
      }
      tokens.push({ kind: 'string', value: out, raw: src.slice(i, j + 1), start: i, end: j + 1 });
      i = j + 1;
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < n && src[j] >= '0' && src[j] <= '9') j++;
      if (src[j] === '.' && src[j + 1] >= '0' && src[j + 1] <= '9') {
        j++;
        while (j < n && src[j] >= '0' && src[j] <= '9') j++;
      }
      tokens.push({ kind: 'number', value: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    if (identStart.test(ch)) {
      let j = i + 1;
      while (j < n && identPart.test(src[j])) j++;
      tokens.push({ kind: 'ident', value: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    for (const op of OPS) {
      if (src.startsWith(op, i)) {
        tokens.push({ kind: 'op', value: op, start: i, end: i + op.length });
        i += op.length;
        continue outer;
      }
    }

    if ('().,?:;'.includes(ch)) {
      tokens.push({ kind: 'punct', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    tokens.push({ kind: 'error', value: `无法识别的字符「${ch}」`, start: i, end: i + 1 });
    i++;
  }

  return tokens;
}
