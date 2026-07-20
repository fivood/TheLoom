export type VarValue = boolean | number | string;

/** 源码里的半开区间 [start, end),用于错误定位与高亮 */
export interface Span {
  start: number;
  end: number;
}

export type TokenType =
  | 'number' | 'string' | 'boolean'
  | 'ident'
  | 'op'        // 运算符与标点:! && || == != < <= > >= + - * / % ( ) . , = += -= *= /=
  | 'newline'   // 指令分隔:换行或分号
  | 'eof';

export interface Token {
  type: TokenType;
  /** 源文本(string 类型时是不带引号的值) */
  text: string;
  span: Span;
}

export type BinOp =
  | '||' | '&&'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | '+' | '-' | '*' | '/' | '%';

export type Expr =
  | { kind: 'lit'; value: VarValue; span: Span }
  | { kind: 'ident'; name: string; span: Span }
  /** 一级属性访问:实体技术名.字段名 */
  | { kind: 'member'; obj: string; objSpan: Span; prop: string; propSpan: Span; span: Span }
  | { kind: 'unary'; op: '!' | '-'; expr: Expr; span: Span }
  | { kind: 'binary'; op: BinOp; left: Expr; right: Expr; span: Span }
  /** 仅允许 seen / unseen 两个内置函数,参数一个表达式(通常是字符串字面量) */
  | { kind: 'call'; callee: 'seen' | 'unseen'; calleeSpan: Span; arg: Expr; span: Span };

export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=';

export type AssignTarget =
  | { kind: 'ident'; name: string; span: Span }
  | { kind: 'member'; obj: string; objSpan: Span; prop: string; propSpan: Span; span: Span };

/** 指令语句:变量或实体属性的赋值 / 复合赋值 */
export interface Assign {
  target: AssignTarget;
  op: AssignOp;
  value: Expr;
  span: Span;
}

/** 解析 / 求值 / 类型检查统一的问题结构,位置精确到表达式 */
export interface ScriptIssue {
  severity: 'error' | 'warning';
  message: string;
  span: Span;
}

export class ScriptError extends Error {
  span: Span;
  constructor(message: string, span: Span) {
    super(message);
    this.span = span;
  }
}
