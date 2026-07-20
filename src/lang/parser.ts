import type { Assign, AssignOp, AssignTarget, BinOp, Expr, ScriptIssue, Span, Token } from './ast';
import { ScriptError } from './ast';

/* ---------- 词法 ---------- */

/** 标识符首字符:字母 / 下划线 / CJK(字段名常用中文) */
const identStart = (c: string) => /[A-Za-z_À-ɏ぀-ヿ㐀-䶿一-鿿]/.test(c);
const identPart = (c: string) => identStart(c) || /[0-9]/.test(c);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const push = (type: Token['type'], text: string, start: number, end: number) =>
    tokens.push({ type, text, span: { start, end } });

  while (i < src.length) {
    const c = src[i];
    if (c === '\n' || c === ';') {
      push('newline', c, i, i + 1);
      i++;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== quote && src[j] !== '\n') {
        value += src[j];
        j++;
      }
      if (src[j] !== quote) throw new ScriptError('字符串没有配对的引号', { start: i, end: j });
      push('string', value, i, j + 1);
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      if (!/^(\d+(\.\d+)?|\.\d+)$/.test(raw)) throw new ScriptError(`无法识别的数字:${raw}`, { start: i, end: j });
      push('number', raw, i, j);
      i = j;
      continue;
    }
    if (identStart(c)) {
      let j = i + 1;
      while (j < src.length && identPart(src[j])) j++;
      const raw = src.slice(i, j);
      push(raw === 'true' || raw === 'false' ? 'boolean' : 'ident', raw, i, j);
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (three === '===' || three === '!==') {
      push('op', three.slice(0, 2), i, i + 3);
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/='].includes(two)) {
      push('op', two, i, i + 2);
      i += 2;
      continue;
    }
    if ('!<>+-*/%=().,'.includes(c)) {
      push('op', c, i, i + 1);
      i++;
      continue;
    }
    throw new ScriptError(`无法识别的字符:${c}`, { start: i, end: i + 1 });
  }
  push('eof', '', src.length, src.length);
  return tokens;
}

/* ---------- 语法(递归下降) ---------- */

class Parser {
  tokens: Token[];
  pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  next(): Token {
    const t = this.peek();
    if (t.type !== 'eof') this.pos++;
    return t;
  }

  expectOp(op: string): Token {
    const t = this.peek();
    if (t.type !== 'op' || t.text !== op) {
      throw new ScriptError(`这里应当是「${op}」`, t.span);
    }
    return this.next();
  }

  skipNewlines() {
    while (this.peek().type === 'newline') this.next();
  }

  /** 表达式入口(优先级自低到高:|| → && → 比较 → 加减 → 乘除 → 一元 → 原子) */
  parseExpr(): Expr {
    return this.parseOr();
  }

  private binaryLevel(ops: BinOp[], sub: () => Expr): Expr {
    let left = sub();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && (ops as string[]).includes(t.text)) {
        this.next();
        const right = sub();
        left = { kind: 'binary', op: t.text as BinOp, left, right, span: { start: left.span.start, end: right.span.end } };
      } else {
        return left;
      }
    }
  }

  private parseOr(): Expr { return this.binaryLevel(['||'], () => this.parseAnd()); }
  private parseAnd(): Expr { return this.binaryLevel(['&&'], () => this.parseCompare()); }
  private parseCompare(): Expr { return this.binaryLevel(['==', '!=', '<', '<=', '>', '>='], () => this.parseAdd()); }
  private parseAdd(): Expr { return this.binaryLevel(['+', '-'], () => this.parseMul()); }
  private parseMul(): Expr { return this.binaryLevel(['*', '/', '%'], () => this.parseUnary()); }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.type === 'op' && (t.text === '!' || t.text === '-')) {
      this.next();
      const expr = this.parseUnary();
      return { kind: 'unary', op: t.text as '!' | '-', expr, span: { start: t.span.start, end: expr.span.end } };
    }
    return this.parseAtom();
  }

  private parseAtom(): Expr {
    const t = this.peek();
    if (t.type === 'number') {
      this.next();
      return { kind: 'lit', value: Number(t.text), span: t.span };
    }
    if (t.type === 'string') {
      this.next();
      return { kind: 'lit', value: t.text, span: t.span };
    }
    if (t.type === 'boolean') {
      this.next();
      return { kind: 'lit', value: t.text === 'true', span: t.span };
    }
    if (t.type === 'op' && t.text === '(') {
      this.next();
      const inner = this.parseExpr();
      const close = this.expectOp(')');
      return { ...inner, span: { start: t.span.start, end: close.span.end } };
    }
    if (t.type === 'ident') {
      this.next();
      // 函数调用:仅 seen / unseen
      if (this.peek().type === 'op' && this.peek().text === '(') {
        if (t.text !== 'seen' && t.text !== 'unseen') {
          throw new ScriptError(`不支持的函数「${t.text}」,只有 seen / unseen 可以调用`, t.span);
        }
        this.next();
        const arg = this.parseExpr();
        const close = this.expectOp(')');
        return {
          kind: 'call', callee: t.text, calleeSpan: t.span, arg,
          span: { start: t.span.start, end: close.span.end },
        };
      }
      // 一级属性访问:实体.字段
      if (this.peek().type === 'op' && this.peek().text === '.') {
        this.next();
        const prop = this.peek();
        if (prop.type !== 'ident' && prop.type !== 'boolean') {
          throw new ScriptError('「.」后面应当是字段名', prop.span);
        }
        this.next();
        if (this.peek().type === 'op' && this.peek().text === '.') {
          throw new ScriptError('属性访问只支持一层:实体技术名.字段名', this.peek().span);
        }
        return {
          kind: 'member', obj: t.text, objSpan: t.span, prop: prop.text, propSpan: prop.span,
          span: { start: t.span.start, end: prop.span.end },
        };
      }
      return { kind: 'ident', name: t.text, span: t.span };
    }
    if (t.type === 'eof') throw new ScriptError('表达式不完整', t.span);
    throw new ScriptError(`这里不应当出现「${t.text}」`, t.span);
  }

  /** 指令:target (=|+=|-=|*=|/=) expr,以换行 / 分号分隔 */
  parseInstructions(): Assign[] {
    const out: Assign[] = [];
    for (;;) {
      this.skipNewlines();
      if (this.peek().type === 'eof') return out;
      out.push(this.parseAssign());
      const sep = this.peek();
      if (sep.type === 'eof') return out;
      if (sep.type !== 'newline') throw new ScriptError('指令之间用分号或换行分隔', sep.span);
    }
  }

  parseAssign(): Assign {
    const head = this.peek();
    if (head.type !== 'ident') throw new ScriptError('指令应当以变量名或「实体技术名.字段名」开头', head.span);
    this.next();
    let target: AssignTarget;
    if (this.peek().type === 'op' && this.peek().text === '.') {
      this.next();
      const prop = this.peek();
      if (prop.type !== 'ident' && prop.type !== 'boolean') {
        throw new ScriptError('「.」后面应当是字段名', prop.span);
      }
      this.next();
      target = {
        kind: 'member', obj: head.text, objSpan: head.span, prop: prop.text, propSpan: prop.span,
        span: { start: head.span.start, end: prop.span.end },
      };
    } else {
      target = { kind: 'ident', name: head.text, span: head.span };
    }
    const opTok = this.peek();
    if (opTok.type !== 'op' || !['=', '+=', '-=', '*=', '/='].includes(opTok.text)) {
      throw new ScriptError('这里应当是 = 或 += / -= / *= / /=', opTok.span);
    }
    this.next();
    const value = this.parseExpr();
    return { target, op: opTok.text as AssignOp, value, span: { start: target.span.start, end: value.span.end } };
  }
}

/* ---------- 对外 API ---------- */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issue: ScriptIssue };

function toIssue(e: unknown, fallbackEnd: number): ScriptIssue {
  if (e instanceof ScriptError) return { severity: 'error', message: e.message, span: e.span };
  return { severity: 'error', message: String(e), span: { start: 0, end: fallbackEnd } };
}

export function parseExpression(src: string): ParseResult<Expr> {
  try {
    const parser = new Parser(tokenize(src).filter((t) => t.type !== 'newline'));
    const expr = parser.parseExpr();
    const rest = parser.peek();
    if (rest.type !== 'eof') throw new ScriptError(`表达式在这里就结束了,多出「${rest.text}」`, rest.span);
    return { ok: true, value: expr };
  } catch (e) {
    return { ok: false, issue: toIssue(e, src.length) };
  }
}

export function parseInstructions(src: string): ParseResult<Assign[]> {
  try {
    return { ok: true, value: new Parser(tokenize(src)).parseInstructions() };
  } catch (e) {
    return { ok: false, issue: toIssue(e, src.length) };
  }
}

/**
 * 宽容版指令解析:按分号 / 换行切段,每段独立词法与解析;
 * 一条语句损坏(包括非法字符)不影响其他条,所有问题都带整段源码内的绝对位置。
 */
export function parseInstructionsTolerant(src: string): { stmts: Assign[]; issues: ScriptIssue[] } {
  const stmts: Assign[] = [];
  const issues: ScriptIssue[] = [];
  let segStart = 0;
  const segments: { start: number; text: string }[] = [];
  for (let i = 0; i <= src.length; i++) {
    if (i === src.length || src[i] === ';' || src[i] === '\n') {
      segments.push({ start: segStart, text: src.slice(segStart, i) });
      segStart = i + 1;
    }
  }
  for (const seg of segments) {
    if (!seg.text.trim()) continue;
    let rawTokens: Token[];
    try {
      rawTokens = tokenize(seg.text);
    } catch (e) {
      const issue = toIssue(e, seg.text.length);
      issue.span = { start: issue.span.start + seg.start, end: issue.span.end + seg.start };
      issues.push(issue);
      continue;
    }
    const tokens = rawTokens.map((t) => ({
      ...t,
      span: { start: t.span.start + seg.start, end: t.span.end + seg.start },
    }));
    try {
      const parser = new Parser(tokens);
      const stmt = parser.parseAssign();
      const rest = parser.peek();
      if (rest.type !== 'eof') throw new ScriptError(`指令在这里就结束了,多出「${rest.text}」`, rest.span);
      stmts.push(stmt);
    } catch (e) {
      issues.push(toIssue(e, seg.start + seg.text.length));
    }
  }
  return { stmts, issues };
}
