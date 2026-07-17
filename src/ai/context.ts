import { queryProject } from '../query';
import type { QueryHit } from '../query';
import type { NavTarget } from '../search';
import type { ProjectIssue } from '../issues';
import type {
  Asset,
  DocBlock,
  Document,
  Entity,
  EntityField,
  Flow,
  FlowNode,
  Project,
  ProjectQuery,
  ResearchCard,
  SubFlow,
  TimelineEvent,
} from '../types';
import { ASSET_KIND_LABEL, DOC_BLOCK_LABEL, ENTITY_KIND_LABEL, FLOW_NODE_LABEL } from '../types';
import { getAttachments, resolveSub } from '../util';

export type AiContextKind =
  | 'flow'
  | 'flow-node'
  | 'entity'
  | 'asset'
  | 'document'
  | 'document-block'
  | 'research'
  | 'timeline-event'
  | 'project-issue';

export type AiContextRelation = 'primary' | 'selected' | 'query' | 'reference';

export interface AiSourceRef {
  key: string;
  kind: AiContextKind;
  id: string;
  title: string;
  nav?: NavTarget;
}

export interface AiContextItem {
  sourceRef: AiSourceRef;
  module: string;
  trust: 'untrusted-project-content';
  relation: AiContextRelation;
  priority: number;
  text: string;
  originalChars: number;
  includedChars: number;
  truncated: boolean;
}

export interface AiContextBundle {
  version: 1;
  projectName: string;
  projectFingerprint: string;
  contextFingerprint: string;
  budget: number;
  usedChars: number;
  omittedCount: number;
  items: AiContextItem[];
  summary: {
    objectCount: number;
    modules: string[];
    containsBody: boolean;
    containsResearch: boolean;
    containsAiConsultation: false;
  };
}

export interface BuildAiContextOptions {
  primary?: NavTarget;
  selected?: NavTarget[];
  query?: ProjectQuery;
  issue?: ProjectIssue;
  includeReferences?: boolean;
  charBudget?: number;
  perItemLimit?: number;
}

interface ContextCandidate {
  sourceRef: AiSourceRef;
  module: string;
  body: string;
  refIds: string[];
  containsBody: boolean;
  containsResearch: boolean;
}

interface RankedCandidate extends ContextCandidate {
  relation: AiContextRelation;
  priority: number;
}

const DEFAULT_CHAR_BUDGET = 24_000;
const DEFAULT_PER_ITEM_LIMIT = 8_000;
const MIN_ITEM_CHARS = 96;
const PRIORITY: Record<AiContextRelation, number> = {
  primary: 1_000,
  selected: 800,
  query: 500,
  reference: 300,
};

function compactLines(lines: Array<string | undefined | false>): string {
  return lines.filter((line): line is string => Boolean(line)).join('\n');
}

function fieldRefs(fields: EntityField[]): string[] {
  const ids: string[] = [];
  for (const field of fields) {
    if (field.type === 'entity') ids.push(field.value.trim());
    if (field.type === 'entities') ids.push(...field.value.split(',').map((value) => value.trim()));
  }
  return ids.filter(Boolean);
}

function describeFields(fields: EntityField[], p: Project): string {
  if (fields.length === 0) return '';
  const entityName = new Map(p.entities.map((entity) => [entity.id, entity.name]));
  const values = fields.map((field) => {
    let value = field.value;
    if (field.type === 'entity') value = entityName.get(value) ? `${entityName.get(value)} (${value})` : value;
    if (field.type === 'entities') {
      value = value.split(',').map((id) => id.trim()).filter(Boolean)
        .map((id) => entityName.get(id) ? `${entityName.get(id)} (${id})` : id).join('、');
    }
    return `- ${field.label}: ${value}`;
  });
  return `字段:\n${values.join('\n')}`;
}

function sourceHeader(ref: AiSourceRef): string {
  return `[来源 ${ref.kind}] ${ref.title}\n来源键: ${ref.key}\n对象 ID: ${ref.id}`;
}

function issueCandidate(issue: ProjectIssue): ContextCandidate {
  const sourceRef: AiSourceRef = {
    key: `issue:${issue.id}`,
    kind: 'project-issue',
    id: issue.id,
    title: `${issue.kind}: ${issue.message.slice(0, 80)}`,
    nav: issue.nav,
  };
  return {
    sourceRef,
    module: '体检',
    body: compactLines([
      sourceHeader(sourceRef),
      `严重级别: ${issue.severity}`,
      `问题代码: ${issue.code}`,
      `问题范围: ${issue.scope}`,
      `检测来源: ${issue.source}`,
      issue.objectId && `关联对象 ID: ${issue.objectId}`,
      `问题描述: ${issue.message}`,
    ]),
    refIds: issue.objectId ? [issue.objectId] : [],
    containsBody: false,
    containsResearch: false,
  };
}

function entityCandidate(p: Project, entity: Entity): ContextCandidate {
  const sourceRef: AiSourceRef = {
    key: `entity:${entity.id}`,
    kind: 'entity',
    id: entity.id,
    title: entity.name,
    nav: { tab: 'entities', entityId: entity.id },
  };
  return {
    sourceRef,
    module: '实体',
    body: compactLines([
      sourceHeader(sourceRef),
      `类型: ${ENTITY_KIND_LABEL[entity.kind]}`,
      entity.technicalName && `技术名: ${entity.technicalName}`,
      entity.summary && `摘要: ${entity.summary}`,
      describeFields(entity.fields, p),
      entity.notes && `备注:\n${entity.notes}`,
    ]),
    refIds: [...fieldRefs(entity.fields), ...getAttachments(p, entity.id)],
    containsBody: Boolean(entity.summary || entity.notes || entity.fields.some((field) => field.value)),
    containsResearch: false,
  };
}

function assetCandidate(asset: Asset): ContextCandidate {
  const sourceRef: AiSourceRef = {
    key: `asset:${asset.id}`,
    kind: 'asset',
    id: asset.id,
    title: asset.name,
    nav: { tab: 'assets', assetId: asset.id },
  };
  return {
    sourceRef,
    module: '资源',
    body: compactLines([
      sourceHeader(sourceRef),
      `类型: ${ASSET_KIND_LABEL[asset.kind]}`,
      `MIME: ${asset.mime}`,
      `大小: ${asset.size} 字节`,
      asset.technicalName && `技术名: ${asset.technicalName}`,
      asset.tags.length > 0 && `标签: ${asset.tags.join('、')}`,
      asset.source && `来源: ${asset.source}`,
      asset.license && `授权: ${asset.license}`,
      asset.notes && `备注:\n${asset.notes}`,
    ]),
    refIds: [],
    containsBody: Boolean(asset.notes),
    containsResearch: false,
  };
}

function blockText(block: DocBlock, p: Project): string {
  const speaker = block.speakerId && p.entities.find((entity) => entity.id === block.speakerId);
  return compactLines([
    `## ${DOC_BLOCK_LABEL[block.type]} · ${block.id}`,
    speaker && `说话人: ${speaker.name} (${speaker.id})`,
    block.text,
    block.condition && `条件: ${block.condition}`,
    block.instruction && `指令: ${block.instruction}`,
    Boolean(block.choices?.length) && `选项:\n${block.choices!.map((choice) => `- ${choice.label} (${choice.id})`).join('\n')}`,
    Boolean(block.items?.length) && `列表:\n${block.items!.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item}`).join('\n')}`,
  ]);
}

function documentCandidate(p: Project, document: Document, blockId?: string): ContextCandidate | null {
  const block = blockId ? document.blocks.find((item) => item.id === blockId) : undefined;
  if (blockId && !block) return null;
  const title = block ? `${document.name} · ${DOC_BLOCK_LABEL[block.type]}` : document.name;
  const sourceRef: AiSourceRef = {
    key: block ? `document-block:${document.id}:${block.id}` : `document:${document.id}`,
    kind: block ? 'document-block' : 'document',
    id: block?.id ?? document.id,
    title,
    nav: { tab: 'documents', docId: document.id, blockId: block?.id },
  };
  const blocks = block ? [block] : document.blocks;
  return {
    sourceRef,
    module: '文档',
    body: compactLines([
      sourceHeader(sourceRef),
      `文档 ID: ${document.id}`,
      document.category && `分类: ${document.category}`,
      document.technicalName && `技术名: ${document.technicalName}`,
      document.status && `状态: ${document.status}`,
      document.timeLabel && `故事时间: ${document.timeLabel}`,
      document.notes && `备注:\n${document.notes}`,
      ...blocks.map((item) => blockText(item, p)),
    ]),
    refIds: [
      document.povId,
      document.locationId,
      ...blocks.map((item) => item.speakerId),
      ...blocks.flatMap((item) => getAttachments(p, item.id)),
      ...getAttachments(p, document.id),
    ].filter((id): id is string => Boolean(id)),
    containsBody: blocks.length > 0 || Boolean(document.notes),
    containsResearch: false,
  };
}

function nodeText(node: FlowNode, p: Project, path: string[]): string {
  const speaker = node.data.speakerId && p.entities.find((entity) => entity.id === node.data.speakerId);
  return compactLines([
    `## ${FLOW_NODE_LABEL[node.type]} · ${node.id}`,
    path.length > 0 && `子流程路径: ${path.join(' / ')}`,
    node.data.title && `标题: ${node.data.title}`,
    node.data.technicalName && `技术名: ${node.data.technicalName}`,
    speaker && `说话人: ${speaker.name} (${speaker.id})`,
    node.data.text,
    typeof node.data.checkExpr === 'string' && `检定表达式: ${node.data.checkExpr}`,
    typeof node.data.checkDc === 'number' && `检定难度: ${node.data.checkDc}`,
    describeFields(node.data.fields ?? [], p),
  ]);
}

function walkFlow(sub: SubFlow, visit: (node: FlowNode, path: string[], owner: SubFlow) => void, path: string[] = []): void {
  for (const node of sub.nodes) {
    visit(node, path, sub);
    if (node.data.sub) walkFlow(node.data.sub, visit, [...path, node.id]);
  }
}

function flowCandidate(p: Project, flow: Flow, path?: string[], nodeId?: string): ContextCandidate | null {
  if (nodeId) {
    const sub = resolveSub(flow, path ?? []);
    const node = sub?.nodes.find((item) => item.id === nodeId);
    if (!node || !sub) return null;
    const sourceRef: AiSourceRef = {
      key: `flow-node:${flow.id}:${(path ?? []).join('/')}:${node.id}`,
      kind: 'flow-node',
      id: node.id,
      title: node.data.title || FLOW_NODE_LABEL[node.type],
      nav: { tab: 'flow', flowId: flow.id, path: path ?? [], nodeId: node.id },
    };
    const edges = sub.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
    return {
      sourceRef,
      module: '流程',
      body: compactLines([
        sourceHeader(sourceRef),
        `所属流程: ${flow.name} (${flow.id})`,
        nodeText(node, p, path ?? []),
        edges.length > 0 && `相邻连线:\n${edges.map((edge) =>
          `- ${edge.source} → ${edge.target}${edge.label ? ` · ${edge.label}` : ''}${edge.condition ? ` · 条件 ${edge.condition}` : ''}`,
        ).join('\n')}`,
      ]),
      refIds: [
        node.data.speakerId,
        ...fieldRefs(node.data.fields ?? []),
        ...getAttachments(p, node.id),
      ].filter((id): id is string => Boolean(id)),
      containsBody: Boolean(node.data.text || node.data.fields?.length),
      containsResearch: false,
    };
  }

  const sourceRef: AiSourceRef = {
    key: `flow:${flow.id}`,
    kind: 'flow',
    id: flow.id,
    title: flow.name,
    nav: { tab: 'flow', flowId: flow.id },
  };
  const parts: string[] = [];
  const refs: string[] = [...getAttachments(p, flow.id)];
  walkFlow(flow, (node, nodePath, owner) => {
    parts.push(nodeText(node, p, nodePath));
    refs.push(node.data.speakerId ?? '', ...fieldRefs(node.data.fields ?? []), ...getAttachments(p, node.id));
    const outgoing = owner.edges.filter((edge) => edge.source === node.id);
    if (outgoing.length > 0) {
      parts.push(`连线: ${outgoing.map((edge) => `${edge.source} → ${edge.target}${edge.label ? ` (${edge.label})` : ''}`).join('；')}`);
    }
  });
  return {
    sourceRef,
    module: '流程',
    body: compactLines([
      sourceHeader(sourceRef),
      flow.technicalName && `技术名: ${flow.technicalName}`,
      ...parts,
    ]),
    refIds: refs.filter(Boolean),
    containsBody: parts.length > 0,
    containsResearch: false,
  };
}

function researchCandidate(p: Project, card: ResearchCard): ContextCandidate {
  const sourceRef: AiSourceRef = {
    key: `research:${card.id}`,
    kind: 'research',
    id: card.id,
    title: card.title,
    nav: { tab: 'research', cardId: card.id },
  };
  return {
    sourceRef,
    module: '资料',
    body: compactLines([
      sourceHeader(sourceRef),
      card.category && `分类: ${card.category}`,
      card.tags.length > 0 && `标签: ${card.tags.join('、')}`,
      card.source && `来源: ${card.source}`,
      card.content,
    ]),
    refIds: getAttachments(p, card.id),
    containsBody: Boolean(card.content),
    containsResearch: true,
  };
}

function timelineCandidate(p: Project, event: TimelineEvent): ContextCandidate {
  const track = p.timelineTracks.find((item) => item.id === event.trackId);
  const point = p.timelinePoints.find((item) => item.id === event.pointId);
  const entities = event.entityIds.map((id) => p.entities.find((entity) => entity.id === id))
    .filter((entity): entity is Entity => Boolean(entity));
  const sourceRef: AiSourceRef = {
    key: `timeline-event:${event.id}`,
    kind: 'timeline-event',
    id: event.id,
    title: event.title,
    nav: { tab: 'timeline', eventId: event.id },
  };
  return {
    sourceRef,
    module: '时间线',
    body: compactLines([
      sourceHeader(sourceRef),
      track && `轨道: ${track.name} (${track.id})`,
      point && `时间点: ${point.label} (${point.id})`,
      entities.length > 0 && `关联实体: ${entities.map((entity) => `${entity.name} (${entity.id})`).join('、')}`,
      event.text,
    ]),
    refIds: [...event.entityIds, ...getAttachments(p, event.id)],
    containsBody: Boolean(event.text),
    containsResearch: false,
  };
}

export function resolveAiContextSource(p: Project, nav: NavTarget): ContextCandidate | null {
  if (nav.tab === 'entities' && nav.entityId) {
    const entity = p.entities.find((item) => item.id === nav.entityId);
    return entity ? entityCandidate(p, entity) : null;
  }
  if (nav.tab === 'assets' && nav.assetId) {
    const asset = p.assets.find((item) => item.id === nav.assetId);
    return asset ? assetCandidate(asset) : null;
  }
  if (nav.tab === 'documents' && nav.docId) {
    const document = p.documents.find((item) => item.id === nav.docId);
    return document ? documentCandidate(p, document, nav.blockId) : null;
  }
  if (nav.tab === 'research' && nav.cardId) {
    const card = p.researchCards.find((item) => item.id === nav.cardId);
    return card ? researchCandidate(p, card) : null;
  }
  if (nav.tab === 'timeline' && nav.eventId) {
    const event = p.timelineEvents.find((item) => item.id === nav.eventId);
    return event ? timelineCandidate(p, event) : null;
  }
  if (nav.tab === 'flow' && nav.flowId) {
    const flow = p.flows.find((item) => item.id === nav.flowId);
    return flow ? flowCandidate(p, flow, nav.path, nav.nodeId) : null;
  }
  return null;
}

function candidateFromQueryHit(p: Project, hit: QueryHit): ContextCandidate | null {
  return resolveAiContextSource(p, hit.nav);
}

function allTopLevelCandidates(p: Project): ContextCandidate[] {
  return [
    ...p.flows.map((flow) => flowCandidate(p, flow)).filter((item): item is ContextCandidate => Boolean(item)),
    ...p.entities.map((entity) => entityCandidate(p, entity)),
    ...p.assets.map(assetCandidate),
    ...p.documents.map((document) => documentCandidate(p, document)).filter((item): item is ContextCandidate => Boolean(item)),
    ...p.researchCards.map((card) => researchCandidate(p, card)),
    ...p.timelineEvents.map((event) => timelineCandidate(p, event)),
  ];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const omitted = new Set(['avatar', 'thumbnail', 'image', 'docSnapshots', 'collabConfig']);
  return Object.keys(source).sort().reduce<Record<string, unknown>>((result, key) => {
    if (omitted.has(key) || source[key] === undefined) return result;
    result[key] = canonicalize(source[key]);
    return result;
  }, {});
}

export async function fingerprintValue(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

function truncateToBudget(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const marker = '\n…[内容已按上下文预算截断]';
  if (limit <= marker.length) return { text: text.slice(0, limit), truncated: true };
  return { text: `${text.slice(0, limit - marker.length).trimEnd()}${marker}`, truncated: true };
}

function addRanked(map: Map<string, RankedCandidate>, candidate: ContextCandidate | null, relation: AiContextRelation): void {
  if (!candidate) return;
  const known = map.get(candidate.sourceRef.key);
  const priority = PRIORITY[relation];
  if (!known || priority > known.priority) map.set(candidate.sourceRef.key, { ...candidate, relation, priority });
}

export async function buildAiContextBundle(p: Project, options: BuildAiContextOptions = {}): Promise<AiContextBundle> {
  const budget = Math.max(0, Math.floor(options.charBudget ?? DEFAULT_CHAR_BUDGET));
  const perItemLimit = Math.max(MIN_ITEM_CHARS, Math.floor(options.perItemLimit ?? DEFAULT_PER_ITEM_LIMIT));
  const ranked = new Map<string, RankedCandidate>();

  addRanked(ranked, options.primary ? resolveAiContextSource(p, options.primary) : null, 'primary');
  if (options.issue) {
    addRanked(ranked, issueCandidate(options.issue), 'primary');
    addRanked(ranked, options.issue.nav ? resolveAiContextSource(p, options.issue.nav) : null, 'selected');
  }
  for (const nav of options.selected ?? []) addRanked(ranked, resolveAiContextSource(p, nav), 'selected');
  for (const hit of options.query ? queryProject(p, options.query) : []) {
    addRanked(ranked, candidateFromQueryHit(p, hit), 'query');
  }

  if (options.includeReferences) {
    const roots = [...ranked.values()];
    const rootIds = new Set(roots.map((item) => item.sourceRef.id));
    const rootRefs = new Set(roots.flatMap((item) => item.refIds));
    for (const candidate of allTopLevelCandidates(p)) {
      const pointsToRoot = candidate.refIds.some((id) => rootIds.has(id));
      if (rootRefs.has(candidate.sourceRef.id) || pointsToRoot) addRanked(ranked, candidate, 'reference');
    }
  }

  const candidates = [...ranked.values()].sort((a, b) =>
    b.priority - a.priority || a.sourceRef.key.localeCompare(b.sourceRef.key));
  const items: AiContextItem[] = [];
  let usedChars = 0;
  for (const candidate of candidates) {
    const remaining = budget - usedChars;
    if (remaining <= 0 || (remaining < MIN_ITEM_CHARS && items.length > 0)) continue;
    const limited = truncateToBudget(candidate.body, Math.min(perItemLimit, remaining));
    items.push({
      sourceRef: candidate.sourceRef,
      module: candidate.module,
      trust: 'untrusted-project-content',
      relation: candidate.relation,
      priority: candidate.priority,
      text: limited.text,
      originalChars: candidate.body.length,
      includedChars: limited.text.length,
      truncated: limited.truncated,
    });
    usedChars += limited.text.length;
  }

  const contextFingerprint = await fingerprintValue(items.map((item) => ({
    sourceKey: item.sourceRef.key,
    relation: item.relation,
    original: ranked.get(item.sourceRef.key)?.body,
  })));
  const projectFingerprint = await fingerprintValue(p);
  return {
    version: 1,
    projectName: p.name,
    projectFingerprint,
    contextFingerprint,
    budget,
    usedChars,
    omittedCount: candidates.length - items.length,
    items,
    summary: {
      objectCount: items.length,
      modules: [...new Set(items.map((item) => item.module))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      containsBody: items.some((item) => ranked.get(item.sourceRef.key)?.containsBody),
      containsResearch: items.some((item) => ranked.get(item.sourceRef.key)?.containsResearch),
      containsAiConsultation: false,
    },
  };
}
