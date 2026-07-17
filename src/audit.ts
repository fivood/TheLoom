import type { FlowNode, Project, SubFlow } from './types';
import { ANNOTATION_TYPES } from './types';
import { findDuplicateTechnicalNames } from './util';
import type { NavTarget } from './search';
import { buildScriptScope } from './script';
import { checkCondition, checkInstructions, checkNumberExpr } from './script/check';
import type { Diagnostic } from './script/ast';
import { createIssue, type IssueScope, type IssueSeverity, type ProjectIssue, type ProjectIssueInput } from './issues';

/** 中文按字计,拉丁与数字按词计 */
export function countWords(text: string | undefined): number {
  if (!text) return 0;
  const cjk = text.match(/[一-鿿㐀-䶿]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return cjk + latin;
}

export interface FlowStat { name: string; nodes: number; words: number }
export interface SpeakerStat { name: string; lines: number; words: number }

export interface ProjectStats {
  flows: FlowStat[];
  speakers: SpeakerStat[];
  totalWords: number;
  totalNodes: number;
  outlineWords: number;
  researchWords: number;
  documentWords: number;
  assets: number;
  documents: number;
}

export function projectStats(p: Project): ProjectStats {
  const speakerMap = new Map<string, SpeakerStat>();
  const flows: FlowStat[] = [];
  let totalWords = 0, totalNodes = 0;

  for (const flow of p.flows) {
    let nodes = 0, words = 0;
    const walk = (sub: SubFlow) => {
      for (const n of sub.nodes) {
        if (ANNOTATION_TYPES.has(n.type)) continue;
        nodes++;
        const w = countWords(n.data.title) + countWords(n.data.text);
        words += w;
        if (n.type === 'dialogue') {
          const sp = p.entities.find((e) => e.id === n.data.speakerId);
          const key = sp?.name ?? '(未指定说话人)';
          const s = speakerMap.get(key) ?? { name: key, lines: 0, words: 0 };
          s.lines++;
          s.words += countWords(n.data.text);
          speakerMap.set(key, s);
        }
        if (n.data.sub) walk(n.data.sub);
      }
    };
    walk(flow);
    flows.push({ name: flow.name, nodes, words });
    totalWords += words;
    totalNodes += nodes;
  }

  const outlineWords = p.outlineRows.reduce((s, r) =>
    s + countWords(r.title) + countWords(r.main) + Object.values(r.cells).reduce((x, c) => x + countWords(c), 0), 0);
  const researchWords = p.researchCards.reduce((s, c) => s + countWords(c.title) + countWords(c.content), 0);
  const documentWords = p.documents.reduce((s, d) =>
    s + countWords(d.name) + countWords(d.notes) + d.blocks.reduce((x, b) =>
      x + countWords(b.text) + countWords(b.instruction) + countWords(b.condition)
        + (b.choices?.reduce((y, c) => y + countWords(c.label), 0) ?? 0)
        + (b.items?.reduce((y, item) => y + countWords(item), 0) ?? 0), 0), 0);

  return {
    flows,
    speakers: [...speakerMap.values()].sort((a, b) => b.words - a.words),
    totalWords, totalNodes, outlineWords, researchWords, documentWords,
    assets: p.assets.length,
    documents: p.documents.length,
  };
}

interface RawIssue {
  kind: string;
  message: string;
  nav?: NavTarget;
  severity?: IssueSeverity;
  source?: ProjectIssueInput['source'];
  code?: string;
  scope?: IssueScope;
  objectId?: string;
}

export type Issue = ProjectIssue;

function inferScope(nav?: NavTarget): IssueScope {
  if (!nav) return 'project';
  if (nav.tab === 'flow') return 'flow';
  if (nav.tab === 'documents') return 'document';
  if (nav.tab === 'entities') return 'entity';
  if (nav.tab === 'assets') return 'asset';
  return 'project';
}

function normalizeIssue(raw: RawIssue): ProjectIssue {
  const source = raw.source ?? (raw.kind.startsWith('脚本') ? 'script' : 'audit');
  const severity = raw.severity ?? (
    raw.kind === '脚本警告' || raw.kind === '孤儿节点' || raw.kind === '空对白'
      || raw.kind === '图片缺缩略图' || raw.kind === '资产大小异常'
      ? 'warning'
      : 'error'
  );
  return createIssue({
    code: raw.code ?? `${source}.${raw.kind}`,
    source,
    severity,
    scope: raw.scope ?? inferScope(raw.nav),
    kind: raw.kind,
    message: raw.message,
    nav: raw.nav,
    objectId: raw.objectId,
  });
}

export function auditProject(p: Project): ProjectIssue[] {
  const issues: RawIssue[] = [];
  const scope = buildScriptScope(p);

  // 脚本诊断:错误精确到表达式位置(字符区间 1 起)
  const pushDiags = (diags: Diagnostic[], text: string, where: string, nav?: NavTarget) => {
    for (const d of diags) {
      const at = text.length > d.end - d.start ? `第 ${d.start + 1}–${d.end} 字符,` : '';
      issues.push({
        kind: d.severity === 'error' ? '脚本错误' : '脚本警告',
        message: `${where}:${at}${d.message}`,
        nav,
        source: 'script',
        severity: d.severity,
        code: `script.${d.severity}`,
      });
    }
  };
  const checkCond = (text: string | undefined, where: string, nav?: NavTarget) => {
    if (text?.trim()) pushDiags(checkCondition(text, scope), text, where, nav);
  };
  const checkNum = (text: string | undefined, where: string, nav?: NavTarget) => {
    if (text?.trim()) pushDiags(checkNumberExpr(text, scope), text, where, nav);
  };
  const checkInstr = (text: string | undefined, where: string, nav?: NavTarget) => {
    if (text?.trim()) pushDiags(checkInstructions(text, scope), text, where, nav);
  };

  for (const flow of p.flows) {
    const walk = (sub: SubFlow, path: string[], crumb: string) => {
      const inSet = new Set(sub.edges.map((e) => e.target));
      const outMap = new Map<string, string[]>();
      for (const e of sub.edges) {
        const arr = outMap.get(e.source) ?? [];
        arr.push(e.sourceHandle ?? '');
        outMap.set(e.source, arr);
      }
      for (const n of sub.nodes as FlowNode[]) {
        if (ANNOTATION_TYPES.has(n.type)) continue;
        const nav: NavTarget = { tab: 'flow', flowId: flow.id, path, nodeId: n.id };
        const label = `${crumb} · ${n.data.title || n.type}`;
        const outs = outMap.get(n.id) ?? [];

        if (!inSet.has(n.id) && outs.length === 0 && sub.nodes.filter((x) => !ANNOTATION_TYPES.has(x.type)).length > 1) {
          issues.push({ kind: '孤儿节点', message: label, nav });
        }
        if (n.type === 'condition') {
          if (!outs.includes('true')) issues.push({ kind: '分支缺口', message: `${label}(缺「真」分支)`, nav });
          if (!outs.includes('false')) issues.push({ kind: '分支缺口', message: `${label}(缺「假」分支)`, nav });
          checkCond(n.data.text, label, nav);
        }
        if (n.type === 'check') {
          if (!outs.includes('success')) issues.push({ kind: '分支缺口', message: `${label}(缺「成功」分支)`, nav });
          if (!outs.includes('fail')) issues.push({ kind: '分支缺口', message: `${label}(缺「失败」分支)`, nav });
          checkNum(n.data.checkExpr, label, nav);
        }
        if (n.type === 'instruction') checkInstr(n.data.text, label, nav);
        if (n.type === 'dialogue' && !n.data.text.trim()) {
          issues.push({ kind: '空对白', message: label, nav });
        }
        if (n.data.sub) walk(n.data.sub, [...path, n.id], `${crumb} ▸ ${n.data.title || '片段'}`);
      }
      for (const e of sub.edges) {
        const src = sub.nodes.find((x) => x.id === e.source);
        const nav: NavTarget = src ? { tab: 'flow', flowId: flow.id, path, nodeId: src.id } : { tab: 'flow', flowId: flow.id, path };
        checkCond(e.condition, `${crumb} · 选项「${e.label || '(未命名)'}」条件`, nav);
        checkInstr(e.effect, `${crumb} · 选项「${e.label || '(未命名)'}」效果`, nav);
      }
    };
    walk(flow, [], flow.name);
  }

  // 文档里的条件 / 指令块
  for (const doc of p.documents) {
    for (const b of doc.blocks) {
      const nav: NavTarget = { tab: 'documents', docId: doc.id, blockId: b.id };
      if (b.type === 'condition') checkCond(b.condition, `${doc.name} · 条件块`, nav);
      if (b.type === 'instruction') checkInstr(b.instruction, `${doc.name} · 指令块`, nav);
    }
  }

  // 悬挂附件引用:attachments 里指向了已删除的 asset
  if (p.attachments) {
    const knownAssetIds = new Set(p.assets.map((a) => a.id));
    for (const [ownerId, ids] of Object.entries(p.attachments)) {
      const dangling = ids.filter((id) => !knownAssetIds.has(id));
      if (dangling.length) {
        issues.push({ kind: '悬挂附件', message: `对象 ${ownerId.slice(0, 8)}… 引用了 ${dangling.length} 个不存在的资源` });
      }
    }
  }

  // 必填模板字段:实体上缺失或为空
  for (const e of p.entities) {
    const specs = (p.entityTemplates?.[e.kind] ?? []).map((s) => (typeof s === 'string' ? { label: s } : s));
    for (const spec of specs) {
      if (!spec.required) continue;
      const field = e.fields.find((f) => f.label === spec.label);
      if (!field || !field.value.trim()) {
        issues.push({
          kind: '必填缺失',
          message: `${e.name} · ${spec.label}`,
          nav: { tab: 'entities', entityId: e.id },
        });
      }
    }
  }

  // 损坏资产:图片缺缩略图、无名称、大小异常
  for (const a of p.assets) {
    const nav: NavTarget = { tab: 'assets', assetId: a.id };
    if (!a.name.trim()) issues.push({ kind: '资产无名称', message: `${a.kind} · ${a.id.slice(0, 6)}…`, nav });
    if (a.kind === 'image' && !a.thumbnail) issues.push({ kind: '图片缺缩略图', message: a.name || '(无名称)', nav });
    if (a.size === 0) issues.push({ kind: '资产大小异常', message: a.name || '(无名称)', nav });
  }

  // 重复技术名
  for (const dup of findDuplicateTechnicalNames(p)) {
    const where = dup.owners.map((o) => `${o.kind}「${o.name}」`).join('、');
    issues.push({ kind: '重复技术名', message: `${dup.name} → ${where}` });
  }

  return issues.map(normalizeIssue);
}
