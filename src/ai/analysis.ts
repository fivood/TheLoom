import { auditProject } from '../audit';
import { appearanceMatrix, arcStagesOf, foreshadowStatus, pacingPoints } from '../planning';
import type { NavTarget } from '../search';
import { simulateFlow } from '../simulate';
import type { Entity, Flow, Project } from '../types';
import { DOC_STATUS_LABEL, FORESHADOW_STATUS_LABEL } from '../types';
import { walkFlowNodes } from '../util';

export type AnalysisKind = 'paths' | 'voice' | 'consistency' | 'foreshadow' | 'pacing';

export const ANALYSIS_KIND_LABEL: Record<AnalysisKind, string> = {
  paths: '路径覆盖与分支',
  voice: '人物声音',
  consistency: '设定一致性',
  foreshadow: '伏笔台账',
  pacing: '节奏与登场',
};

/** 应用本地计算出的分析数据块:事实性结论的引用对象 */
export interface AnalysisBlock {
  key: string;
  title: string;
  nav?: NavTarget;
  text: string;
}

export interface AnalysisTargets {
  required: boolean;
  label: string;
  options: { id: string; name: string }[];
}

export function analysisTargets(p: Project, kind: AnalysisKind): AnalysisTargets {
  if (kind === 'paths') {
    return { required: true, label: '流程', options: p.flows.map((flow) => ({ id: flow.id, name: flow.name })) };
  }
  if (kind === 'voice') {
    return {
      required: true,
      label: '角色',
      options: p.entities.filter((entity) => entity.kind === 'character').map((entity) => ({ id: entity.id, name: entity.name })),
    };
  }
  return { required: false, label: '', options: [] };
}

function pathsBlocks(p: Project, flow: Flow): AnalysisBlock[] {
  const report = simulateFlow(flow, p.variables, p.entities);
  const nav: NavTarget = { tab: 'flow', flowId: flow.id };
  const refs = (items: { title: string }[]) => items.slice(0, 20).map((item) => item.title).join('、') || '(无)';
  return [{
    key: `analysis:paths:${flow.id}`,
    title: `路径测试 · ${flow.name}`,
    nav,
    text: [
      `节点覆盖率 ${Math.round(report.coverage * 100)}%(访问 ${report.visitedCount}/${report.totalNodes})`,
      `枚举路径 ${report.pathCount} 条${report.pathsTruncated ? '(已达上限,数据是下界)' : ''}`,
      `终局分布: 正常结束 ${report.ends.end} · 卡死 ${report.ends.stuck} · 死循环 ${report.ends.loop} · 截断 ${report.ends.truncated}`,
      `不可达节点: ${refs(report.unreachable)}`,
      `卡死节点: ${refs(report.stuck)}`,
      `死循环节点: ${refs(report.loops)}`,
    ].join('\n'),
  }];
}

function voiceBlocks(p: Project, entity: Entity): AnalysisBlock[] {
  const lines: string[] = [];
  for (const flow of p.flows) {
    walkFlowNodes(flow.nodes, (node) => {
      if (node.type === 'dialogue' && node.data.speakerId === entity.id && node.data.text.trim() && lines.length < 40) {
        lines.push(`[流程·${flow.name}] ${node.data.text.trim().slice(0, 120)}`);
      }
    });
  }
  for (const document of p.documents) {
    for (const block of document.blocks) {
      if (block.type === 'dialogue' && block.speakerId === entity.id && block.text.trim() && lines.length < 40) {
        lines.push(`[文档·${document.name}] ${block.text.trim().slice(0, 120)}`);
      }
    }
  }
  return [{
    key: `analysis:voice:${entity.id}`,
    title: `台词样本 · ${entity.name}`,
    nav: { tab: 'entities', entityId: entity.id },
    text: lines.length > 0 ? lines.join('\n') : '(该角色还没有任何台词)',
  }];
}

function consistencyBlocks(p: Project): AnalysisBlock[] {
  const blocks: AnalysisBlock[] = [];
  const issues = auditProject(p).filter((issue) =>
    issue.code.startsWith('consistency.') || issue.code === 'timeline.character-conflict');
  blocks.push({
    key: 'analysis:consistency:issues',
    title: '体检 · 一致性问题',
    text: issues.length > 0
      ? issues.slice(0, 30).map((issue) => `[${issue.kind}] ${issue.message}`).join('\n')
      : '(体检没有发现 POV / 地点 / 类型 / 同时间点冲突问题)',
  });
  const povLines = p.documents
    .filter((document) => document.povId || document.locationId || document.timeLabel)
    .slice(0, 50)
    .map((document) => {
      const pov = p.entities.find((entity) => entity.id === document.povId)?.name ?? '-';
      const location = p.entities.find((entity) => entity.id === document.locationId)?.name ?? '-';
      return `${document.name}: POV=${pov} · 地点=${location} · 故事时间=${document.timeLabel ?? '-'}`;
    });
  blocks.push({
    key: 'analysis:consistency:scenes',
    title: '场景元数据(POV / 地点 / 故事时间)',
    nav: { tab: 'documents' },
    text: povLines.length > 0 ? povLines.join('\n') : '(没有场景标注 POV / 地点 / 故事时间)',
  });
  const arcLines = p.entities
    .map((entity) => ({ entity, stages: arcStagesOf(p, entity.id) }))
    .filter((item) => item.stages.length > 0)
    .slice(0, 20)
    .map(({ entity, stages }) => `${entity.name}: ${stages.map((stage) => {
      const doc = p.documents.find((d) => d.id === stage.docId);
      return `${stage.title || '(未命名)'}${doc ? `→${doc.name}` : ''}`;
    }).join(' · ')}`);
  blocks.push({
    key: 'analysis:consistency:arcs',
    title: '角色弧线阶段',
    nav: { tab: 'planning', planningView: 'arcs' },
    text: arcLines.length > 0 ? arcLines.join('\n') : '(还没有角色弧线)',
  });
  return blocks;
}

function foreshadowBlocks(p: Project): AnalysisBlock[] {
  const docName = (id: string) => p.documents.find((document) => document.id === id)?.name ?? '(缺失场景)';
  const lines = (p.foreshadows ?? []).slice(0, 40).map((item) => {
    const status = FORESHADOW_STATUS_LABEL[foreshadowStatus(item)];
    const plants = item.plants.map((ref) => docName(ref.docId)).join('、') || '(未埋设)';
    const payoffs = item.payoffs.map((ref) => docName(ref.docId)).join('、') || '(未回收)';
    return `「${item.title}」[${status}] 埋设: ${plants};回收: ${payoffs}${item.note ? `;备注: ${item.note.slice(0, 60)}` : ''}`;
  });
  return [{
    key: 'analysis:foreshadow:ledger',
    title: '伏笔台账',
    nav: { tab: 'planning', planningView: 'foreshadow' },
    text: lines.length > 0 ? lines.join('\n') : '(还没有伏笔条目)',
  }];
}

function pacingBlocks(p: Project): AnalysisBlock[] {
  const points = pacingPoints(p);
  const sceneLines = points.slice(0, 60).map((point) =>
    `${point.chapterLabel} · ${point.doc.name}: ${point.words} 字`
    + `${point.status ? ` · ${DOC_STATUS_LABEL[point.status]}` : ''}`
    + `${typeof point.tension === 'number' ? ` · 张力${point.tension}` : ''}`);
  const matrix = appearanceMatrix(p);
  const appearLines = matrix.rows.slice(0, 8).map((row) =>
    `${row.entity.name}: 共 ${row.totalScenes} 场;各章场景数 ${row.cells.map((cell) => cell.scenes).join('/')}`
    + `;POV 场数 ${row.cells.reduce((total, cell) => total + cell.pov, 0)}`);
  return [
    {
      key: 'analysis:pacing:scenes',
      title: '逐场景字数与张力',
      nav: { tab: 'planning', planningView: 'pacing' },
      text: sceneLines.length > 0 ? sceneLines.join('\n') : '(还没有场景)',
    },
    {
      key: 'analysis:pacing:appearance',
      title: `登场统计(章节顺序: ${matrix.chapters.map((chapter) => chapter.label).join('、') || '无章节'})`,
      nav: { tab: 'planning', planningView: 'appearance' },
      text: appearLines.length > 0 ? appearLines.join('\n') : '(还没有角色登场数据)',
    },
  ];
}

export function buildAnalysisBlocks(p: Project, kind: AnalysisKind, targetId?: string): AnalysisBlock[] {
  if (kind === 'paths') {
    const flow = p.flows.find((item) => item.id === targetId);
    if (!flow) throw new Error('请先选择要分析的流程');
    return pathsBlocks(p, flow);
  }
  if (kind === 'voice') {
    const entity = p.entities.find((item) => item.id === targetId);
    if (!entity) throw new Error('请先选择要分析的角色');
    return voiceBlocks(p, entity);
  }
  if (kind === 'consistency') return consistencyBlocks(p);
  if (kind === 'foreshadow') return foreshadowBlocks(p);
  return pacingBlocks(p);
}
