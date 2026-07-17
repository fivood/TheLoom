import type { Expr, Stmt } from './ast';
import { ScriptError } from './ast';

export type VarValue = boolean | number | string;

export interface Env {
  vars: Record<string, VarValue>;
  /** 实体技术名 → { 字段名 → 值 };演出运行态副本,指令可写 */
  entityProps: Record<string, Record<string, VarValue>>;
  seen: (technicalName: string) => boolean;
}

/** 宽松相等:数字与文本互比时按数值,布尔按 0/1(兼容旧脚本的 ==) */
function looseEq(a: VarValue, b: VarValue): boolean {
  if (typeof a === typeof b) return a === b;
  return Number(a) === Number(b);
}

function toNum(v: VarValue, what: string, span: Expr['span']): number {
  const n = Number(v);
  if (Number.isNaN(n)) throw new ScriptError(`${what}不是数字:${String(v)}`, span);
  return n;
}

export function evalExpr(e: Expr, env: Env): VarValue {
  switch (e.kind) {
    case 'lit':
      return e.value;

    case 'ident': {
      if (e.name in env.vars) return env.vars[e.name];
      throw new ScriptError(`未定义的变量「${e.name}」`, e.span);
    }

    case 'member': {
      const props = env.entityProps[e.obj];
      if (!props) throw new ScriptError(`未定义的实体「${e.obj}」`, e.objSpan);
      const v = props[e.prop];
      if (v === undefined) throw new ScriptError(`实体「${e.obj}」没有字段「${e.prop}」`, e.propSpan);
      return v;
    }

    case 'call': {
      if (e.callee !== 'seen' && e.callee !== 'unseen') {
        throw new ScriptError(`未知函数「${e.callee}」`, e.calleeSpan);
      }
      const arg = e.args[0] ? evalExpr(e.args[0], env) : '';
      const hit = env.seen(String(arg));
      return e.callee === 'seen' ? hit : !hit;
    }

    case 'unary': {
      const v = evalExpr(e.expr, env);
      return e.op === '!' ? !v : -toNum(v, '取负的值', e.expr.span);
    }

    case 'binary': {
      if (e.op === '&&') {
        const l = evalExpr(e.left, env);
        return l ? evalExpr(e.right, env) : l;
      }
      if (e.op === '||') {
        const l = evalExpr(e.left, env);
        return l ? l : evalExpr(e.right, env);
      }
      const l = evalExpr(e.left, env);
      const r = evalExpr(e.right, env);
      switch (e.op) {
        case '==': return looseEq(l, r);
        case '!=': return !looseEq(l, r);
        case '===': return l === r;
        case '!==': return l !== r;
        case '<': return toNum(l, '左侧', e.left.span) < toNum(r, '右侧', e.right.span);
        case '<=': return toNum(l, '左侧', e.left.span) <= toNum(r, '右侧', e.right.span);
        case '>': return toNum(l, '左侧', e.left.span) > toNum(r, '右侧', e.right.span);
        case '>=': return toNum(l, '左侧', e.left.span) >= toNum(r, '右侧', e.right.span);
        case '+':
          if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r);
          return toNum(l, '左侧', e.left.span) + toNum(r, '右侧', e.right.span);
        case '-': return toNum(l, '左侧', e.left.span) - toNum(r, '右侧', e.right.span);
        case '*': return toNum(l, '左侧', e.left.span) * toNum(r, '右侧', e.right.span);
        case '/': {
          const d = toNum(r, '右侧', e.right.span);
          return d === 0 ? 0 : toNum(l, '左侧', e.left.span) / d;
        }
        case '%': {
          const d = toNum(r, '右侧', e.right.span);
          return d === 0 ? 0 : toNum(l, '左侧', e.left.span) % d;
        }
      }
      throw new ScriptError(`未支持的运算符「${e.op}」`, e.span);
    }

    case 'cond':
      return evalExpr(e.test, env) ? evalExpr(e.then, env) : evalExpr(e.alt, env);
  }
}

/**
 * 执行一条指令。变量赋值允许目标不存在(运行期创建,兼容旧行为);
 * 实体字段写入要求实体存在,字段不存在时创建。
 */
export function runStmt(s: Stmt, env: Env) {
  const value = evalExpr(s.value, env);

  const read = (): VarValue => {
    if (s.target.kind === 'ident') return env.vars[s.target.name] ?? 0;
    return env.entityProps[s.target.obj]?.[s.target.prop] ?? 0;
  };
  const write = (v: VarValue) => {
    if (s.target.kind === 'ident') {
      env.vars[s.target.name] = v;
    } else {
      const props = env.entityProps[s.target.obj];
      if (!props) throw new ScriptError(`未定义的实体「${s.target.obj}」`, s.target.objSpan);
      props[s.target.prop] = v;
    }
  };

  if (s.op === '=') {
    write(value);
    return;
  }
  const cur = Number(read()) || 0;
  const num = Number(value) || 0;
  switch (s.op) {
    case '+=': write(cur + num); break;
    case '-=': write(cur - num); break;
    case '*=': write(cur * num); break;
    case '/=': write(num === 0 ? cur : cur / num); break;
  }
}
