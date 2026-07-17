/** R6 脚本语言:词法 / AST / 诊断的共享类型 */

export interface Span {
  start: number;
  end: number;
}

export type TokenKind =
  | 'ident' | 'number' | 'string' | 'op' | 'punct' | 'newline' | 'error';

export interface Token extends Span {
  kind: TokenKind;
  /** 原文切片;string 类型时是解码后的值 */
  value: string;
  /** string token 的原文(含引号),高亮用 */
  raw?: string;
}

export type BinaryOp =
  | '||' | '&&'
  | '==' | '!=' | '===' | '!=='
  | '<' | '<=' | '>' | '>='
  | '+' | '-' | '*' | '/' | '%';

export type Expr =
  | { kind: 'lit'; value: boolean | number | string; span: Span }
  | { kind: 'ident'; name: string; span: Span }
  | { kind: 'member'; obj: string; objSpan: Span; prop: string; propSpan: Span; span: Span }
  | { kind: 'call'; callee: string; calleeSpan: Span; args: Expr[]; span: Span }
  | { kind: 'unary'; op: '!' | '-'; expr: Expr; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span }
  | { kind: 'cond'; test: Expr; then: Expr; alt: Expr; span: Span };

export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=';

export interface Stmt {
  /** 赋值目标:变量或 实体.字段 */
  target:
    | { kind: 'ident'; name: string; span: Span }
    | { kind: 'member'; obj: string; objSpan: Span; prop: string; propSpan: Span; span: Span };
  op: AssignOp;
  value: Expr;
  span: Span;
}

export interface Diagnostic extends Span {
  message: string;
  severity: 'error' | 'warning';
}

export class ScriptError extends Error {
  span: Span;
  constructor(message: string, span: Span) {
    super(message);
    this.span = span;
  }
}
