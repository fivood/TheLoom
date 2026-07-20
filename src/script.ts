import type { VarValue } from './lang/ast';
import { ScriptError } from './lang/ast';
import { parseExpression, parseInstructionsTolerant } from './lang/parser';
import { evalExpr, execAssign, type RuntimeCtx } from './lang/interp';
import { describeSpan } from './lang/check';

export type { VarValue };

type SeenFn = (technicalName: string) => boolean;

export interface EvalCtx {
  seen: SeenFn;
  entityProps: Record<string, Record<string, VarValue>>;
}

export function coerceVar(type: string, value: string): VarValue {
  if (type === 'boolean') return value === 'true';
  if (type === 'number') return Number(value) || 0;
  return value;
}

export function coerceScalar(raw: string): VarValue {
  const value = raw.trim();
  if (value === 'true' || value === 'false') return value === 'true';
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function runtimeCtx(vars: Record<string, VarValue>, ctx?: EvalCtx): RuntimeCtx {
  return {
    vars,
    entityProps: ctx?.entityProps ?? {},
    seen: ctx?.seen ?? (() => false),
  };
}

export function evalCondition(expr: string, vars: Record<string, VarValue>, ctx: EvalCtx): boolean | null {
  if (!expr.trim()) return null;
  const parsed = parseExpression(expr);
  if (!parsed.ok) return null;
  try {
    const value = evalExpr(parsed.value, runtimeCtx(vars, ctx));
    return typeof value === 'string' ? value.length > 0 : Boolean(value);
  } catch {
    return null;
  }
}

export function evalNumber(expr: string | undefined, vars: Record<string, VarValue>, ctx: EvalCtx): number {
  if (!expr?.trim()) return 0;
  const parsed = parseExpression(expr);
  if (!parsed.ok) return 0;
  try {
    const value = Number(evalExpr(parsed.value, runtimeCtx(vars, ctx)));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * 执行指令脚本:变量赋值 / 复合赋值,以及(传入 ctx 时)实体属性修改。
 * 逐条容错,返回带位置的人读警告;损坏的语句不影响其他语句。
 */
export function applyInstructions(text: string, vars: Record<string, VarValue>, ctx?: EvalCtx): string[] {
  const entries: { at: number; message: string }[] = [];
  const { stmts, issues } = parseInstructionsTolerant(text);
  for (const issue of issues) {
    entries.push({ at: issue.span.start, message: `${describeSpan(text, issue.span)}:${issue.message}` });
  }
  const runtime = runtimeCtx(vars, ctx);
  for (const stmt of stmts) {
    try {
      execAssign(stmt, runtime);
    } catch (e) {
      if (e instanceof ScriptError) entries.push({ at: e.span.start, message: `${describeSpan(text, e.span)}:${e.message}` });
      else entries.push({ at: stmt.span.start, message: String(e) });
    }
  }
  return entries.sort((a, b) => a.at - b.at).map((entry) => entry.message);
}
