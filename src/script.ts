export type VarValue = boolean | number | string;

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

function evaluate(expr: string, vars: Record<string, VarValue>, ctx: EvalCtx): unknown {
  const variableNames = Object.keys(vars);
  const entityNames = Object.keys(ctx.entityProps);
  const fn = new Function(
    ...variableNames, ...entityNames, 'seen', 'unseen',
    `"use strict"; return (${expr});`,
  );
  return fn(
    ...variableNames.map((name) => vars[name]),
    ...entityNames.map((name) => ctx.entityProps[name]),
    ctx.seen, (technicalName: string) => !ctx.seen(technicalName),
  );
}

export function evalCondition(expr: string, vars: Record<string, VarValue>, ctx: EvalCtx): boolean | null {
  if (!expr.trim()) return null;
  try {
    return Boolean(evaluate(expr, vars, ctx));
  } catch {
    return null;
  }
}

export function evalNumber(expr: string | undefined, vars: Record<string, VarValue>, ctx: EvalCtx): number {
  if (!expr?.trim()) return 0;
  try {
    const value = Number(evaluate(expr, vars, ctx));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function applyInstructions(text: string, vars: Record<string, VarValue>): string[] {
  const warnings: string[] = [];
  for (const raw of text.split(/[;\n]/)) {
    const statement = raw.trim();
    if (!statement) continue;
    const match = statement.match(/^([A-Za-z_]\w*)\s*(=|\+=|-=|\*=|\/=)\s*(.+)$/);
    if (!match) {
      warnings.push(`无法解析:${statement}`);
      continue;
    }
    const [, name, operator, rawValue] = match;
    const source = rawValue.trim();
    let value: VarValue;
    if (source === 'true' || source === 'false') value = source === 'true';
    else if (!Number.isNaN(Number(source))) value = Number(source);
    else if (/^(['"]).*\1$/.test(source)) value = source.slice(1, -1);
    else if (source in vars) value = vars[source];
    else {
      warnings.push(`未知的值:${statement}`);
      continue;
    }

    if (operator === '=') vars[name] = value;
    else {
      const current = Number(vars[name]) || 0;
      const number = Number(value) || 0;
      vars[name] = operator === '+=' ? current + number
        : operator === '-=' ? current - number
          : operator === '*=' ? current * number
            : number === 0 ? current : current / number;
    }
  }
  return warnings;
}
