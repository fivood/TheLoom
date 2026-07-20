import type { Assign, Expr, VarValue } from './ast';
import { ScriptError } from './ast';

/** 运行时上下文:变量表 + 实体属性表(演出中可被指令修改)+ seen 查询 */
export interface RuntimeCtx {
  vars: Record<string, VarValue>;
  entityProps: Record<string, Record<string, VarValue>>;
  seen: (technicalName: string) => boolean;
}

function truthy(v: VarValue): boolean {
  return typeof v === 'string' ? v.length > 0 : Boolean(v);
}

function looseEq(a: VarValue, b: VarValue): boolean {
  if (typeof a === typeof b) return a === b;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  return Number(a) === Number(b);
}

function toNumber(v: VarValue): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function evalExpr(expr: Expr, ctx: RuntimeCtx): VarValue {
  switch (expr.kind) {
    case 'lit':
      return expr.value;
    case 'ident': {
      if (!(expr.name in ctx.vars)) {
        if (expr.name in ctx.entityProps) {
          throw new ScriptError(`「${expr.name}」是实体,要用 ${expr.name}.字段名 访问属性`, expr.span);
        }
        throw new ScriptError(`未定义的变量「${expr.name}」`, expr.span);
      }
      return ctx.vars[expr.name];
    }
    case 'member': {
      const props = ctx.entityProps[expr.obj];
      if (!props) throw new ScriptError(`未知的实体技术名「${expr.obj}」`, expr.objSpan);
      if (!(expr.prop in props)) throw new ScriptError(`实体「${expr.obj}」没有字段「${expr.prop}」`, expr.propSpan);
      return props[expr.prop];
    }
    case 'unary': {
      const v = evalExpr(expr.expr, ctx);
      return expr.op === '!' ? !truthy(v) : -toNumber(v);
    }
    case 'call': {
      const arg = evalExpr(expr.arg, ctx);
      const hit = ctx.seen(String(arg));
      return expr.callee === 'seen' ? hit : !hit;
    }
    case 'binary': {
      if (expr.op === '&&') return truthy(evalExpr(expr.left, ctx)) ? truthy(evalExpr(expr.right, ctx)) : false;
      if (expr.op === '||') return truthy(evalExpr(expr.left, ctx)) ? true : truthy(evalExpr(expr.right, ctx));
      const a = evalExpr(expr.left, ctx);
      const b = evalExpr(expr.right, ctx);
      switch (expr.op) {
        case '==': return looseEq(a, b);
        case '!=': return !looseEq(a, b);
        case '<': return toNumber(a) < toNumber(b);
        case '<=': return toNumber(a) <= toNumber(b);
        case '>': return toNumber(a) > toNumber(b);
        case '>=': return toNumber(a) >= toNumber(b);
        case '+': return typeof a === 'string' || typeof b === 'string' ? String(a) + String(b) : toNumber(a) + toNumber(b);
        case '-': return toNumber(a) - toNumber(b);
        case '*': return toNumber(a) * toNumber(b);
        case '/': return toNumber(a) / toNumber(b);
        case '%': return toNumber(a) % toNumber(b);
      }
    }
  }
}

/** 执行一条指令。目标变量不存在时创建(与旧行为一致);实体属性必须已存在 */
export function execAssign(stmt: Assign, ctx: RuntimeCtx): void {
  const value = evalExpr(stmt.value, ctx);
  const read = (): VarValue => {
    if (stmt.target.kind === 'ident') return ctx.vars[stmt.target.name] ?? 0;
    return ctx.entityProps[stmt.target.obj]?.[stmt.target.prop] ?? 0;
  };
  const write = (v: VarValue) => {
    if (stmt.target.kind === 'ident') {
      ctx.vars[stmt.target.name] = v;
      return;
    }
    const props = ctx.entityProps[stmt.target.obj];
    if (!props) throw new ScriptError(`未知的实体技术名「${stmt.target.obj}」`, stmt.target.objSpan);
    if (!(stmt.target.prop in props)) {
      throw new ScriptError(`实体「${stmt.target.obj}」没有字段「${stmt.target.prop}」`, stmt.target.propSpan);
    }
    props[stmt.target.prop] = v;
  };
  if (stmt.op === '=') {
    write(value);
    return;
  }
  if (stmt.op === '+=' && (typeof value === 'string' || typeof read() === 'string')) {
    write(String(read()) + String(value));
    return;
  }
  const current = toNumber(read());
  const operand = toNumber(value);
  switch (stmt.op) {
    case '+=': write(current + operand); break;
    case '-=': write(current - operand); break;
    case '*=': write(current * operand); break;
    case '/=': write(operand === 0 ? current : current / operand); break;
  }
}
