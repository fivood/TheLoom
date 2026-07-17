import type { AssignOp, BinaryOp, Diagnostic, Expr, Span, Stmt, Token } from './ast';
import { ScriptError } from './ast';
import { lex } from './lexer';

/** 二元运算符优先级(数字越大绑得越紧) */
const PREC: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3, '!=': 3, '===': 3, '!==': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

class Parser {
  tokens: Token[];
  pos = 0;
  src: string;

  constructor(src: string, keepNewlines: boolean) {
    this.src = src;
    const all = lex(src);
    for (const t of all) {
      if (t.kind === 'error') throw new ScriptError(t.value, t);
    }
    this.tokens = keepNewlines ? all : all.filter((t) => t.kind !== 'newline');
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new ScriptError('表达式不完整', this.endSpan());
    this.pos++;
    return t;
  }

  endSpan(): Span {
    const last = this.tokens[this.tokens.length - 1];
    const at = last ? last.end : this.src.length;
    return { start: Math.max(0, at - 1), end: at };
  }

  expect(kind: Token['kind'], value: string): Token {
    const t = this.peek();
    if (!t || t.kind !== kind || t.value !== value) {
      throw new ScriptError(`此处应为「${value}」`, t ?? this.endSpan());
    }
    this.pos++;
    return t;
  }

  atOp(value: string): boolean {
    const t = this.peek();
    return !!t && (t.kind === 'op' || t.kind === 'punct') && t.value === value;
  }

  parseExpr(minPrec = 0): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== 'op') break;
      const prec = PREC[t.value];
      if (prec === undefined || prec < minPrec) break;
      this.pos++;
      const right = this.parseExpr(prec + 1);
      left = { kind: 'binary', op: t.value as BinaryOp, left, right, span: { start: left.span.start, end: right.span.end } };
    }
    // 三元条件(最低优先级,右结合)
    if (minPrec === 0 && this.atOp('?')) {
      this.pos++;
      const then = this.parseExpr(0);
      this.expect('punct', ':');
      const alt = this.parseExpr(0);
      left = { kind: 'cond', test: left, then, alt, span: { start: left.span.start, end: alt.span.end } };
    }
    return left;
  }

  parseUnary(): Expr {
    const t = this.peek();
    if (t && t.kind === 'op' && (t.value === '!' || t.value === '-')) {
      this.pos++;
      const expr = this.parseUnary();
      return { kind: 'unary', op: t.value as '!' | '-', expr, span: { start: t.start, end: expr.span.end } };
    }
    return this.parsePrimary();
  }

  parsePrimary(): Expr {
    const t = this.next();

    if (t.kind === 'number') {
      return { kind: 'lit', value: Number(t.value), span: t };
    }
    if (t.kind === 'string') {
      return { kind: 'lit', value: t.value, span: t };
    }
    if (t.kind === 'punct' && t.value === '(') {
      const inner = this.parseExpr(0);
      this.expect('punct', ')');
      const close = this.tokens[this.pos - 1];
      return { ...inner, span: { start: t.start, end: close.end } };
    }
    if (t.kind === 'ident') {
      if (t.value === 'true' || t.value === 'false') {
        return { kind: 'lit', value: t.value === 'true', span: t };
      }
      // 函数调用 seen("x")
      if (this.atOp('(')) {
        this.pos++;
        const args: Expr[] = [];
        if (!this.atOp(')')) {
          args.push(this.parseExpr(0));
          while (this.atOp(',')) {
            this.pos++;
            args.push(this.parseExpr(0));
          }
        }
        this.expect('punct', ')');
        const close = this.tokens[this.pos - 1];
        return { kind: 'call', callee: t.value, calleeSpan: t, args, span: { start: t.start, end: close.end } };
      }
      // 属性访问 实体.字段(单层)
      if (this.atOp('.')) {
        this.pos++;
        const prop = this.peek();
        if (!prop || prop.kind !== 'ident') {
          throw new ScriptError('「.」后应为字段名', prop ?? this.endSpan());
        }
        this.pos++;
        return {
          kind: 'member', obj: t.value, objSpan: t,
          prop: prop.value, propSpan: prop,
          span: { start: t.start, end: prop.end },
        };
      }
      return { kind: 'ident', name: t.value, span: t };
    }
    throw new ScriptError(`此处不应出现「${t.value}」`, t);
  }
}

export interface ParseResult<T> {
  ast: T | null;
  diagnostics: Diagnostic[];
}

/** 解析单个表达式(条件 / 检定技能值)。 */
export function parseExpression(src: string): ParseResult<Expr> {
  if (!src.trim()) return { ast: null, diagnostics: [] };
  try {
    const p = new Parser(src, false);
    const expr = p.parseExpr(0);
    const rest = p.peek();
    if (rest) throw new ScriptError(`表达式结束后多出「${rest.value}」`, rest);
    return { ast: expr, diagnostics: [] };
  } catch (e) {
    if (e instanceof ScriptError) {
      return { ast: null, diagnostics: [{ message: e.message, severity: 'error', start: e.span.start, end: e.span.end }] };
    }
    throw e;
  }
}

/**
 * 解析指令列表:`目标 op 表达式`,以分号或换行分隔。
 * 单条语句解析失败不影响其余语句(逐条报诊断)。
 */
export function parseInstructions(src: string): { stmts: Stmt[]; diagnostics: Diagnostic[] } {
  const stmts: Stmt[] = [];
  const diagnostics: Diagnostic[] = [];
  if (!src.trim()) return { stmts, diagnostics };

  let tokens: Token[];
  try {
    tokens = new Parser(src, true).tokens;
  } catch (e) {
    if (e instanceof ScriptError) {
      return { stmts, diagnostics: [{ message: e.message, severity: 'error', start: e.span.start, end: e.span.end }] };
    }
    throw e;
  }

  // 按分隔符切段
  const groups: Token[][] = [];
  let cur: Token[] = [];
  for (const t of tokens) {
    if (t.kind === 'newline' || (t.kind === 'punct' && t.value === ';')) {
      if (cur.length > 0) groups.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length > 0) groups.push(cur);

  for (const group of groups) {
    try {
      stmts.push(parseStmt(group, src));
    } catch (e) {
      if (e instanceof ScriptError) {
        diagnostics.push({ message: e.message, severity: 'error', start: e.span.start, end: e.span.end });
      } else {
        throw e;
      }
    }
  }
  return { stmts, diagnostics };
}

function parseStmt(tokens: Token[], src: string): Stmt {
  const first = tokens[0];
  if (first.kind !== 'ident') {
    throw new ScriptError('指令应以变量名或「实体.字段」开头', first);
  }
  let target: Stmt['target'];
  let opIdx: number;
  if (tokens[1]?.kind === 'punct' && tokens[1].value === '.') {
    const prop = tokens[2];
    if (!prop || prop.kind !== 'ident') {
      throw new ScriptError('「.」后应为字段名', prop ?? tokens[1]);
    }
    target = {
      kind: 'member', obj: first.value, objSpan: first,
      prop: prop.value, propSpan: prop,
      span: { start: first.start, end: prop.end },
    };
    opIdx = 3;
  } else {
    target = { kind: 'ident', name: first.value, span: first };
    opIdx = 1;
  }

  const opTok = tokens[opIdx];
  const ASSIGN: AssignOp[] = ['=', '+=', '-=', '*=', '/='];
  if (!opTok || opTok.kind !== 'op' || !ASSIGN.includes(opTok.value as AssignOp)) {
    throw new ScriptError('此处应为赋值运算符(= += -= *= /=)', opTok ?? target.span);
  }

  const valueTokens = tokens.slice(opIdx + 1);
  if (valueTokens.length === 0) {
    throw new ScriptError('赋值缺少右侧的值', opTok);
  }
  const exprSrc = src.slice(valueTokens[0].start, valueTokens[valueTokens.length - 1].end);
  const shift = valueTokens[0].start;
  const sub = parseExpression(exprSrc);
  if (!sub.ast) {
    const d = sub.diagnostics[0];
    throw new ScriptError(d?.message ?? '无法解析右侧表达式', {
      start: (d?.start ?? 0) + shift,
      end: (d?.end ?? exprSrc.length) + shift,
    });
  }
  shiftSpans(sub.ast, shift);
  return {
    target,
    op: opTok.value as AssignOp,
    value: sub.ast,
    span: { start: first.start, end: valueTokens[valueTokens.length - 1].end },
  };
}

function shiftSpans(e: Expr, by: number) {
  e.span = { start: e.span.start + by, end: e.span.end + by };
  switch (e.kind) {
    case 'member':
      e.objSpan = { start: e.objSpan.start + by, end: e.objSpan.end + by };
      e.propSpan = { start: e.propSpan.start + by, end: e.propSpan.end + by };
      break;
    case 'call':
      e.calleeSpan = { start: e.calleeSpan.start + by, end: e.calleeSpan.end + by };
      for (const a of e.args) shiftSpans(a, by);
      break;
    case 'unary':
      shiftSpans(e.expr, by);
      break;
    case 'binary':
      shiftSpans(e.left, by);
      shiftSpans(e.right, by);
      break;
    case 'cond':
      shiftSpans(e.test, by);
      shiftSpans(e.then, by);
      shiftSpans(e.alt, by);
      break;
  }
}
