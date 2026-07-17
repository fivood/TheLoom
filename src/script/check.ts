import type { Diagnostic, Expr, Stmt } from './ast';
import { parseExpression, parseInstructions } from './parser';

/** 脚本静态类型:unknown 表示无法确定(text 字段内容动态),与任何类型兼容 */
export type ScriptType = 'boolean' | 'number' | 'text' | 'unknown';

export interface ScriptScope {
  /** 变量名 → 类型 */
  vars: Map<string, ScriptType>;
  /** 实体技术名 → (字段名 → 类型) */
  entities: Map<string, Map<string, ScriptType>>;
  /** 全项目节点技术名(seen / unseen 的合法参数);undefined 时跳过该项校验 */
  nodeTechNames?: Set<string>;
}

export interface CheckResult {
  type: ScriptType;
  diagnostics: Diagnostic[];
}

const TYPE_LABEL: Record<ScriptType, string> = {
  boolean: '布尔', number: '数字', text: '文本', unknown: '未知',
};

function isNum(t: ScriptType) { return t === 'number' || t === 'unknown'; }

export function checkExpr(expr: Expr, scope: ScriptScope, diags: Diagnostic[]): ScriptType {
  switch (expr.kind) {
    case 'lit':
      return typeof expr.value === 'boolean' ? 'boolean' : typeof expr.value === 'number' ? 'number' : 'text';

    case 'ident': {
      const t = scope.vars.get(expr.name);
      if (t !== undefined) return t;
      if (scope.entities.has(expr.name)) {
        diags.push({ message: `「${expr.name}」是实体,应写成 ${expr.name}.字段名`, severity: 'error', ...expr.span });
        return 'unknown';
      }
      diags.push({ message: `未定义的变量「${expr.name}」`, severity: 'error', ...expr.span });
      return 'unknown';
    }

    case 'member': {
      const fields = scope.entities.get(expr.obj);
      if (!fields) {
        diags.push({
          message: scope.vars.has(expr.obj)
            ? `「${expr.obj}」是变量,不能访问字段`
            : `未定义的实体技术名「${expr.obj}」`,
          severity: 'error', ...expr.objSpan,
        });
        return 'unknown';
      }
      const t = fields.get(expr.prop);
      if (t === undefined) {
        diags.push({ message: `实体「${expr.obj}」没有字段「${expr.prop}」`, severity: 'warning', ...expr.propSpan });
        return 'unknown';
      }
      return t;
    }

    case 'call': {
      if (expr.callee !== 'seen' && expr.callee !== 'unseen') {
        diags.push({ message: `未知函数「${expr.callee}」(可用:seen / unseen)`, severity: 'error', ...expr.calleeSpan });
        for (const a of expr.args) checkExpr(a, scope, diags);
        return 'unknown';
      }
      if (expr.args.length !== 1) {
        diags.push({ message: `${expr.callee}(...) 需要一个技术名参数`, severity: 'error', ...expr.span });
        return 'boolean';
      }
      const arg = expr.args[0];
      if (arg.kind !== 'lit' || typeof arg.value !== 'string') {
        diags.push({ message: `${expr.callee}(...) 的参数应为字符串字面量,如 ${expr.callee}("节点技术名")`, severity: 'error', ...arg.span });
      } else if (scope.nodeTechNames && !scope.nodeTechNames.has(arg.value)) {
        diags.push({ message: `没有技术名为「${arg.value}」的节点`, severity: 'warning', ...arg.span });
      }
      return 'boolean';
    }

    case 'unary': {
      const t = checkExpr(expr.expr, scope, diags);
      if (expr.op === '-') {
        if (!isNum(t)) diags.push({ message: `负号只能用于数字(得到${TYPE_LABEL[t]})`, severity: 'error', ...expr.expr.span });
        return 'number';
      }
      return 'boolean';
    }

    case 'binary': {
      const lt = checkExpr(expr.left, scope, diags);
      const rt = checkExpr(expr.right, scope, diags);
      switch (expr.op) {
        case '||': case '&&':
          return lt === rt ? lt : 'unknown';
        case '==': case '!=': case '===': case '!==':
          if (lt !== 'unknown' && rt !== 'unknown' && lt !== rt) {
            diags.push({ message: `比较两侧类型不同(${TYPE_LABEL[lt]} 与 ${TYPE_LABEL[rt]})`, severity: 'warning', ...expr.span });
          }
          return 'boolean';
        case '<': case '<=': case '>': case '>=':
          if (!isNum(lt)) diags.push({ message: `大小比较需要数字(左侧是${TYPE_LABEL[lt]})`, severity: 'error', ...expr.left.span });
          if (!isNum(rt)) diags.push({ message: `大小比较需要数字(右侧是${TYPE_LABEL[rt]})`, severity: 'error', ...expr.right.span });
          return 'boolean';
        case '+':
          if (lt === 'text' || rt === 'text') return 'text';
          if (!isNum(lt)) diags.push({ message: `加法需要数字或文本(左侧是${TYPE_LABEL[lt]})`, severity: 'error', ...expr.left.span });
          if (!isNum(rt)) diags.push({ message: `加法需要数字或文本(右侧是${TYPE_LABEL[rt]})`, severity: 'error', ...expr.right.span });
          return lt === 'unknown' || rt === 'unknown' ? 'unknown' : 'number';
        default:
          if (!isNum(lt)) diags.push({ message: `「${expr.op}」需要数字(左侧是${TYPE_LABEL[lt]})`, severity: 'error', ...expr.left.span });
          if (!isNum(rt)) diags.push({ message: `「${expr.op}」需要数字(右侧是${TYPE_LABEL[rt]})`, severity: 'error', ...expr.right.span });
          return 'number';
      }
    }

    case 'cond': {
      checkExpr(expr.test, scope, diags);
      const t1 = checkExpr(expr.then, scope, diags);
      const t2 = checkExpr(expr.alt, scope, diags);
      return t1 === t2 ? t1 : 'unknown';
    }
  }
}

/** 校验条件表达式:解析 + 类型检查 + 根类型应为布尔 */
export function checkCondition(src: string, scope: ScriptScope): Diagnostic[] {
  const { ast, diagnostics } = parseExpression(src);
  if (!ast) return diagnostics;
  const diags = [...diagnostics];
  const t = checkExpr(ast, scope, diags);
  if (t === 'number' || t === 'text') {
    diags.push({ message: `条件结果应为布尔值(得到${TYPE_LABEL[t]})`, severity: 'warning', ...ast.span });
  }
  return diags;
}

/** 校验数字表达式(检定技能值) */
export function checkNumberExpr(src: string, scope: ScriptScope): Diagnostic[] {
  const { ast, diagnostics } = parseExpression(src);
  if (!ast) return diagnostics;
  const diags = [...diagnostics];
  const t = checkExpr(ast, scope, diags);
  if (t === 'boolean' || t === 'text') {
    diags.push({ message: `此处应为数字表达式(得到${TYPE_LABEL[t]})`, severity: 'error', ...ast.span });
  }
  return diags;
}

/** 校验指令列表 */
export function checkInstructions(src: string, scope: ScriptScope): Diagnostic[] {
  const { stmts, diagnostics } = parseInstructions(src);
  const diags = [...diagnostics];
  for (const s of stmts) checkStmt(s, scope, diags);
  return diags;
}

function checkStmt(s: Stmt, scope: ScriptScope, diags: Diagnostic[]) {
  const vt = checkExpr(s.value, scope, diags);
  let targetType: ScriptType = 'unknown';

  if (s.target.kind === 'ident') {
    const t = scope.vars.get(s.target.name);
    if (t === undefined) {
      diags.push({
        message: scope.entities.has(s.target.name)
          ? `「${s.target.name}」是实体,应写成 ${s.target.name}.字段名 = ...`
          : `未定义的变量「${s.target.name}」(先在变量模块创建)`,
        severity: 'error', ...s.target.span,
      });
    } else {
      targetType = t;
    }
  } else {
    const fields = scope.entities.get(s.target.obj);
    if (!fields) {
      diags.push({ message: `未定义的实体技术名「${s.target.obj}」`, severity: 'error', ...s.target.objSpan });
    } else if (!fields.has(s.target.prop)) {
      diags.push({ message: `实体「${s.target.obj}」没有字段「${s.target.prop}」`, severity: 'warning', ...s.target.propSpan });
    } else {
      targetType = fields.get(s.target.prop)!;
    }
  }

  if (s.op === '=') {
    if (targetType !== 'unknown' && vt !== 'unknown' && targetType !== vt) {
      diags.push({ message: `类型不匹配:把${TYPE_LABEL[vt]}赋给${TYPE_LABEL[targetType]}`, severity: 'warning', ...s.span });
    }
  } else {
    if (targetType !== 'unknown' && targetType !== 'number') {
      diags.push({ message: `「${s.op}」只能用于数字(目标是${TYPE_LABEL[targetType]})`, severity: 'error', ...s.target.span });
    }
    if (vt !== 'unknown' && vt !== 'number') {
      diags.push({ message: `「${s.op}」右侧应为数字(得到${TYPE_LABEL[vt]})`, severity: 'error', ...s.value.span });
    }
  }
}
