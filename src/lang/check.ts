import type { Assign, Expr, ScriptIssue } from './ast';
import { parseExpression, parseInstructionsTolerant } from './parser';

export type ValueType = 'boolean' | 'number' | 'string' | 'unknown';

/** 静态环境:变量名 → 类型;实体技术名 → 字段名 → 类型 */
export interface ScriptEnv {
  vars: Record<string, ValueType>;
  entities: Record<string, Record<string, ValueType>>;
}

export type ScriptMode = 'condition' | 'instruction' | 'number';

function inferExpr(expr: Expr, env: ScriptEnv, issues: ScriptIssue[]): ValueType {
  switch (expr.kind) {
    case 'lit':
      return typeof expr.value as ValueType;
    case 'ident': {
      if (expr.name in env.vars) return env.vars[expr.name];
      if (expr.name in env.entities) {
        issues.push({ severity: 'error', message: `「${expr.name}」是实体,要用 ${expr.name}.字段名 访问属性`, span: expr.span });
      } else {
        issues.push({ severity: 'error', message: `未定义的变量「${expr.name}」`, span: expr.span });
      }
      return 'unknown';
    }
    case 'member': {
      const props = env.entities[expr.obj];
      if (!props) {
        if (expr.obj in env.vars) {
          issues.push({ severity: 'error', message: `「${expr.obj}」是变量,不能访问属性`, span: expr.objSpan });
        } else {
          issues.push({ severity: 'error', message: `未知的实体技术名「${expr.obj}」`, span: expr.objSpan });
        }
        return 'unknown';
      }
      if (!(expr.prop in props)) {
        issues.push({ severity: 'error', message: `实体「${expr.obj}」没有字段「${expr.prop}」`, span: expr.propSpan });
        return 'unknown';
      }
      return props[expr.prop];
    }
    case 'unary': {
      const t = inferExpr(expr.expr, env, issues);
      if (expr.op === '-') {
        if (t === 'string' || t === 'boolean') {
          issues.push({ severity: 'warning', message: '负号作用在非数值上', span: expr.expr.span });
        }
        return 'number';
      }
      return 'boolean';
    }
    case 'call': {
      const t = inferExpr(expr.arg, env, issues);
      if (t !== 'string' && t !== 'unknown') {
        issues.push({ severity: 'warning', message: `${expr.callee}(...) 的参数应当是技术名字符串,如 ${expr.callee}("scene_1")`, span: expr.arg.span });
      }
      return 'boolean';
    }
    case 'binary': {
      const lt = inferExpr(expr.left, env, issues);
      const rt = inferExpr(expr.right, env, issues);
      switch (expr.op) {
        case '&&':
        case '||':
          return 'boolean';
        case '==':
        case '!=':
          if (lt !== 'unknown' && rt !== 'unknown' && lt !== rt) {
            issues.push({ severity: 'warning', message: `比较的两边类型不同(${lt} 与 ${rt})`, span: expr.span });
          }
          return 'boolean';
        case '<':
        case '<=':
        case '>':
        case '>=':
          if (lt === 'string' || rt === 'string') {
            issues.push({ severity: 'warning', message: '大小比较作用在文本上,会按数值转换', span: expr.span });
          }
          return 'boolean';
        case '+':
          if (lt === 'string' || rt === 'string') return 'string';
          return 'number';
        default:
          if (lt === 'string' || rt === 'string' || lt === 'boolean' || rt === 'boolean') {
            issues.push({ severity: 'warning', message: `「${expr.op}」应当作用在数值上`, span: expr.span });
          }
          return 'number';
      }
    }
  }
}

function checkAssign(stmt: Assign, env: ScriptEnv, issues: ScriptIssue[]): void {
  const valueType = inferExpr(stmt.value, env, issues);
  let targetType: ValueType = 'unknown';
  if (stmt.target.kind === 'ident') {
    if (stmt.target.name in env.entities) {
      issues.push({ severity: 'error', message: `「${stmt.target.name}」是实体,要写 ${stmt.target.name}.字段名`, span: stmt.target.span });
    } else if (!(stmt.target.name in env.vars)) {
      issues.push({ severity: 'warning', message: `变量「${stmt.target.name}」未在变量表定义,演出时会临时创建`, span: stmt.target.span });
    } else {
      targetType = env.vars[stmt.target.name];
    }
  } else {
    const props = env.entities[stmt.target.obj];
    if (!props) {
      issues.push({ severity: 'error', message: `未知的实体技术名「${stmt.target.obj}」`, span: stmt.target.objSpan });
    } else if (!(stmt.target.prop in props)) {
      issues.push({ severity: 'error', message: `实体「${stmt.target.obj}」没有字段「${stmt.target.prop}」`, span: stmt.target.propSpan });
    } else {
      targetType = props[stmt.target.prop];
    }
  }
  if (stmt.op === '=') {
    if (targetType !== 'unknown' && valueType !== 'unknown' && targetType !== valueType) {
      issues.push({ severity: 'warning', message: `把 ${valueType} 赋给 ${targetType} 类型的目标`, span: stmt.span });
    }
    return;
  }
  if (targetType === 'boolean') {
    issues.push({ severity: 'error', message: `布尔目标不支持「${stmt.op}」`, span: stmt.target.span });
  }
  if (stmt.op !== '+=' && (targetType === 'string' || valueType === 'string')) {
    issues.push({ severity: 'warning', message: `「${stmt.op}」应当作用在数值上`, span: stmt.span });
  }
}

/**
 * 静态检查一段脚本。解析失败返回解析错误;解析成功再做标识符与类型检查。
 * condition 模式要求结果可作布尔;number 模式要求结果是数值(检定表达式)。
 */
export function checkScript(src: string, mode: ScriptMode, env: ScriptEnv): ScriptIssue[] {
  if (!src.trim()) return [];
  const issues: ScriptIssue[] = [];
  if (mode === 'instruction') {
    const { stmts, issues: parseIssues } = parseInstructionsTolerant(src);
    issues.push(...parseIssues);
    for (const stmt of stmts) checkAssign(stmt, env, issues);
    return issues;
  }
  const parsed = parseExpression(src);
  if (!parsed.ok) return [parsed.issue];
  const t = inferExpr(parsed.value, env, issues);
  if (mode === 'number' && t === 'boolean') {
    issues.push({ severity: 'warning', message: '检定表达式应当得到数值,这里是布尔', span: parsed.value.span });
  }
  if (mode === 'condition' && t === 'string') {
    issues.push({ severity: 'warning', message: '条件得到的是文本,非空即视为真', span: parsed.value.span });
  }
  return issues;
}

/** 把 span 转成人读得懂的位置(单行按第几列,多行按第几行第几列) */
export function describeSpan(src: string, span: { start: number; end: number }): string {
  const before = src.slice(0, span.start);
  const line = before.split('\n').length;
  const col = span.start - (before.lastIndexOf('\n') + 1) + 1;
  return src.includes('\n') ? `第 ${line} 行第 ${col} 列` : `第 ${col} 列`;
}
