/**
 * 脚本层门面(R6 起走自有解析器 + AST 解释器,不再动态执行字符串)。
 * 纯逻辑实现见 src/script/:lexer / parser / check / eval / rename。
 */
import type { Entity, Project } from './types';
import { walkFlowNodes } from './util';
import { ScriptError } from './script/ast';
import { parseExpression, parseInstructions } from './script/parser';
import { evalExpr, runStmt, type Env } from './script/eval';
import type { ScriptScope, ScriptType } from './script/check';

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

function toEnv(vars: Record<string, VarValue>, ctx: EvalCtx): Env {
  return { vars, entityProps: ctx.entityProps, seen: ctx.seen };
}

/** 求值条件表达式;空文本或任何解析 / 运行错误返回 null(交由调用方手动分支) */
export function evalCondition(expr: string, vars: Record<string, VarValue>, ctx: EvalCtx): boolean | null {
  const { ast } = parseExpression(expr);
  if (!ast) return null;
  try {
    return Boolean(evalExpr(ast, toEnv(vars, ctx)));
  } catch {
    return null;
  }
}

/** 求值数字表达式(检定技能值);失败返回 0 */
export function evalNumber(expr: string | undefined, vars: Record<string, VarValue>, ctx: EvalCtx): number {
  if (!expr?.trim()) return 0;
  const { ast } = parseExpression(expr);
  if (!ast) return 0;
  try {
    const value = Number(evalExpr(ast, toEnv(vars, ctx)));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * 执行指令列表,直接改写 vars(与旧行为一致);
 * 传入 ctx 时支持右侧完整表达式与「实体.字段」读写。
 * 返回人类可读的警告(带出错语句)。
 */
export function applyInstructions(text: string, vars: Record<string, VarValue>, ctx?: EvalCtx): string[] {
  const warnings: string[] = [];
  const { stmts, diagnostics } = parseInstructions(text);
  for (const d of diagnostics) {
    warnings.push(`${d.message}:${text.slice(d.start, d.end) || text.trim()}`);
  }
  const env: Env = {
    vars,
    entityProps: ctx?.entityProps ?? {},
    seen: ctx?.seen ?? (() => false),
  };
  for (const s of stmts) {
    try {
      runStmt(s, env);
    } catch (e) {
      if (e instanceof ScriptError) {
        warnings.push(`${e.message}:${text.slice(s.span.start, s.span.end)}`);
      } else {
        throw e;
      }
    }
  }
  return warnings;
}

/** buildEntityProps 的最小结构要求:应用内 Entity 与引擎包实体都满足(R9 独立运行库共用) */
export interface EntityPropsSource {
  id: string;
  technicalName?: string;
  fields: { label: string; value: string; type?: string }[];
}

/** 实体属性表:技术名 → { 字段名 → 标量值 / 被引用实体技术名 }(演出运行态的初始值) */
export function buildEntityProps(entities: EntityPropsSource[]): Record<string, Record<string, VarValue>> {
  const out: Record<string, Record<string, VarValue>> = {};
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const e of entities) {
    if (!e.technicalName) continue;
    const props: Record<string, VarValue> = {};
    for (const f of e.fields) {
      if (!f.label) continue;
      if (f.type === 'entity') {
        const ref = f.value ? byId.get(f.value) : undefined;
        if (ref?.technicalName) props[f.label] = ref.technicalName;
      } else if (f.type === 'entities') {
        // 多引用字段非标量,不注入脚本
      } else {
        props[f.label] = coerceScalar(f.value);
      }
    }
    out[e.technicalName] = props;
  }
  return out;
}

/**
 * 遍历并改写项目里的全部脚本文本(流程节点 / 各层边 / 文档块 / 叙事单元镜像)。
 * fn 返回新文本;未变化时保持原引用。重命名联动用。
 */
export function mapProjectScripts(p: Project, fn: (src: string) => string) {
  const apply = (src: string | undefined): string | undefined => {
    if (!src) return src;
    const next = fn(src);
    return next === src ? src : next;
  };
  interface SubLike { nodes: { type: string; data: { text?: string; checkExpr?: string; sub?: SubLike } }[]; edges: { condition?: string; effect?: string }[] }
  const walkSub = (sub: SubLike) => {
    for (const n of sub.nodes) {
      if (n.type === 'condition' || n.type === 'instruction') n.data.text = apply(n.data.text) ?? '';
      if (n.type === 'check') n.data.checkExpr = apply(n.data.checkExpr);
      if (n.data.sub) walkSub(n.data.sub);
    }
    for (const e of sub.edges) {
      e.condition = apply(e.condition);
      e.effect = apply(e.effect);
    }
  };
  for (const flow of p.flows) walkSub(flow as unknown as SubLike);
  for (const doc of p.documents) {
    for (const b of doc.blocks) {
      if (b.type === 'condition') b.condition = apply(b.condition);
      if (b.type === 'instruction') b.instruction = apply(b.instruction);
    }
  }
  for (const u of p.units ?? []) {
    if (u.kind === 'condition' || u.kind === 'instruction') u.text = apply(u.text) ?? '';
  }
}

/** 静态检查作用域:变量类型表 + 实体字段类型表 + 节点技术名集合 */
export function buildScriptScope(p: Project): ScriptScope {
  const vars = new Map<string, ScriptType>();
  for (const v of p.variables) {
    vars.set(v.name, v.type === 'string' ? 'text' : v.type);
  }
  const entities = new Map<string, Map<string, ScriptType>>();
  for (const e of p.entities) {
    if (!e.technicalName) continue;
    const fields = new Map<string, ScriptType>();
    for (const f of e.fields) {
      if (!f.label) continue;
      if (f.type === 'entity') fields.set(f.label, 'text');
      else if (f.type === 'entities') continue;
      else fields.set(f.label, 'unknown');
    }
    entities.set(e.technicalName, fields);
  }
  const nodeTechNames = new Set<string>();
  for (const flow of p.flows) {
    walkFlowNodes(flow.nodes, (n) => {
      if (n.data.technicalName) nodeTechNames.add(n.data.technicalName);
    });
  }
  return { vars, entities, nodeTechNames };
}
