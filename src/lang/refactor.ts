import type { Project, SubFlow } from '../types';
import type { Token } from './ast';
import { tokenize } from './parser';

/**
 * 在一段脚本里重命名标识符(变量名 / 实体技术名)。
 * 只替换独立标识符位置,跳过「.」后的字段名与字符串内容;无变化返回 null。
 */
export function renameIdentInScript(src: string, oldName: string, newName: string): string | null {
  if (!src || !src.includes(oldName)) return null;
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch {
    return null;
  }
  const hits: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.text !== oldName) continue;
    const prev = tokens[i - 1];
    if (prev && prev.type === 'op' && prev.text === '.') continue;
    hits.push(t);
  }
  if (hits.length === 0) return null;
  let out = src;
  for (const t of [...hits].reverse()) {
    out = out.slice(0, t.span.start) + newName + out.slice(t.span.end);
  }
  return out;
}

/** 重命名 seen("x") / unseen("x") 里的技术名字符串参数;无变化返回 null */
export function renameSeenArgInScript(src: string, oldName: string, newName: string): string | null {
  if (!src || !src.includes(oldName)) return null;
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch {
    return null;
  }
  const hits: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'string' || t.text !== oldName) continue;
    const paren = tokens[i - 1];
    const callee = tokens[i - 2];
    if (paren?.type === 'op' && paren.text === '(' && callee?.type === 'ident'
      && (callee.text === 'seen' || callee.text === 'unseen')) {
      hits.push(t);
    }
  }
  if (hits.length === 0) return null;
  let out = src;
  for (const t of [...hits].reverse()) {
    const quote = src[t.span.start];
    out = out.slice(0, t.span.start) + quote + newName + quote + out.slice(t.span.end);
  }
  return out;
}

/**
 * 全项目脚本改写:对每个脚本字段应用 rewrite,返回改动的字段数。
 * 覆盖:流程条件 / 指令节点文本、检定表达式、连线条件 / 效果、
 * 文档条件 / 指令块、以及对应叙事单元(保持镜像一致,避免同步器仲裁)。
 */
export function rewriteProjectScripts(p: Project, rewrite: (src: string) => string | null): number {
  let changed = 0;
  const apply = (value: string | undefined, set: (next: string) => void) => {
    if (!value) return;
    const next = rewrite(value);
    if (next !== null && next !== value) {
      set(next);
      changed++;
    }
  };
  for (const flow of p.flows) {
    const walk = (sub: SubFlow) => {
      for (const n of sub.nodes) {
        if (n.type === 'condition' || n.type === 'instruction') {
          apply(n.data.text, (v) => { n.data.text = v; });
        }
        if (n.type === 'check') {
          apply(n.data.checkExpr, (v) => { n.data.checkExpr = v; });
        }
        if (n.data.sub) walk(n.data.sub);
      }
      for (const e of sub.edges) {
        apply(e.condition, (v) => { e.condition = v; });
        apply(e.effect, (v) => { e.effect = v; });
      }
    };
    walk(flow);
  }
  for (const d of p.documents) {
    let touched = false;
    for (const b of d.blocks) {
      apply(b.condition, (v) => { b.condition = v; touched = true; });
      apply(b.instruction, (v) => { b.instruction = v; touched = true; });
    }
    if (touched) d.updatedAt = Date.now();
  }
  for (const u of p.units ?? []) {
    if (u.kind === 'condition' || u.kind === 'instruction') {
      apply(u.text, (v) => { u.text = v; });
    }
  }
  return changed;
}

export function renameIdentifierEverywhere(p: Project, oldName: string, newName: string): number {
  if (!oldName || !newName || oldName === newName) return 0;
  return rewriteProjectScripts(p, (src) => renameIdentInScript(src, oldName, newName));
}

export function renameSeenTargetEverywhere(p: Project, oldName: string, newName: string): number {
  if (!oldName || !newName || oldName === newName) return 0;
  return rewriteProjectScripts(p, (src) => renameSeenArgInScript(src, oldName, newName));
}
