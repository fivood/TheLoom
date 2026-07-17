import type { DocStatus, FolderModule, Project, SubFlow } from './types';
import { DOC_STATUS_LABEL, ENTITY_KIND_LABEL } from './types';
import type { NavTarget } from './search';

export type QueryObjectType = 'all' | 'flow' | 'entity' | 'asset' | 'document' | 'research' | 'timeline';
export type QueryReferenceFilter = 'any' | 'referenced' | 'unreferenced';

export interface ProjectQuery {
  objectType: QueryObjectType;
  text: string;
  folderId: 'any' | 'ungrouped' | string;
  attributeName: string;
  attributeValue: string;
  tags: string[];
  status: 'any' | DocStatus;
  references: QueryReferenceFilter;
}

export interface QueryHit {
  id: string;
  objectType: Exclude<QueryObjectType, 'all'>;
  module: string;
  kind: string;
  title: string;
  snippet: string;
  folderId?: string;
  tags: string[];
  status?: DocStatus;
  referenceCount: number;
  attributes: Record<string, string>;
  searchText: string;
  nav: NavTarget;
}

export const DEFAULT_PROJECT_QUERY: ProjectQuery = {
  objectType: 'all',
  text: '',
  folderId: 'any',
  attributeName: '',
  attributeValue: '',
  tags: [],
  status: 'any',
  references: 'any',
};

export const QUERY_OBJECT_LABEL: Record<QueryObjectType, string> = {
  all: '全部对象',
  flow: '流程',
  entity: '实体',
  asset: '资源',
  document: '文档',
  research: '资料',
  timeline: '时间线事件',
};

export const QUERY_FOLDER_MODULE: Partial<Record<QueryObjectType, FolderModule>> = {
  flow: 'flow',
  entity: 'entity',
  asset: 'asset',
  document: 'document',
  research: 'research',
};

function collectReferenceCounts(p: Project): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (id: string | undefined) => {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  const addFieldRefs = (fields: { type?: string; value: string }[]) => {
    for (const field of fields) {
      if (field.type === 'entity') add(field.value.trim());
      if (field.type === 'entities') {
        for (const id of field.value.split(',').map((value) => value.trim()).filter(Boolean)) add(id);
      }
    }
  };

  const flowUnits = new Map<string, Set<string>>();
  for (const flow of p.flows) {
    const units = new Set<string>();
    const walk = (sub: SubFlow) => {
      for (const node of sub.nodes) {
        add(node.data.speakerId);
        addFieldRefs(node.data.fields ?? []);
        if (node.data.unitId) units.add(node.data.unitId);
        if (node.data.sub) walk(node.data.sub);
      }
    };
    walk(flow);
    flowUnits.set(flow.id, units);
  }
  for (const entity of p.entities) addFieldRefs(entity.fields);
  for (const document of p.documents) {
    add(document.povId);
    add(document.locationId);
    const units = new Set<string>();
    for (const block of document.blocks) {
      add(block.speakerId);
      if (block.unitId) units.add(block.unitId);
    }
    for (const [flowId, known] of flowUnits) {
      if ([...units].some((unitId) => known.has(unitId))) {
        add(flowId);
        add(document.id);
      }
    }
  }
  for (const event of p.timelineEvents) for (const entityId of new Set(event.entityIds)) add(entityId);
  for (const map of p.maps) {
    for (const marker of map.markers) add(marker.entityId);
    for (const region of map.regions) add(region.entityId);
  }
  for (const relation of p.relations ?? []) {
    add(relation.fromId);
    add(relation.toId);
  }
  for (const arc of p.arcs ?? []) {
    add(arc.entityId);
    add(arc.docId);
  }
  for (const foreshadow of p.foreshadows ?? []) {
    for (const ref of [...foreshadow.plants, ...foreshadow.payoffs]) add(ref.docId);
  }
  for (const ids of Object.values(p.attachments ?? {})) for (const assetId of new Set(ids)) add(assetId);
  return counts;
}

function text(...values: (string | undefined)[]): string {
  return values.filter(Boolean).join('\n');
}

export function buildQueryIndex(p: Project): QueryHit[] {
  const refs = collectReferenceCounts(p);
  const entityName = (id?: string) => p.entities.find((entity) => entity.id === id)?.name ?? '';
  const trackName = (id: string) => p.timelineTracks.find((track) => track.id === id)?.name ?? '';
  const pointName = (id: string) => p.timelinePoints.find((point) => point.id === id)?.label ?? '';
  const hits: QueryHit[] = [];

  for (const flow of p.flows) {
    let nodeCount = 0;
    const contents: string[] = [];
    const walk = (sub: SubFlow) => {
      for (const node of sub.nodes) {
        nodeCount++;
        contents.push(node.data.title, node.data.text);
        if (node.data.sub) walk(node.data.sub);
      }
    };
    walk(flow);
    hits.push({
      id: flow.id,
      objectType: 'flow',
      module: '流程',
      kind: '流程',
      title: flow.name,
      snippet: `${nodeCount} 个节点`,
      folderId: flow.folderId,
      tags: [],
      referenceCount: refs.get(flow.id) ?? 0,
      attributes: { 名称: flow.name, 技术名: flow.technicalName ?? '', 节点数: String(nodeCount) },
      searchText: text(flow.name, flow.technicalName, ...contents),
      nav: { tab: 'flow', flowId: flow.id },
    });
  }

  for (const entity of p.entities) {
    const attributes: Record<string, string> = {
      名称: entity.name,
      类型: ENTITY_KIND_LABEL[entity.kind],
      技术名: entity.technicalName ?? '',
    };
    for (const field of entity.fields) attributes[field.label] = field.value;
    hits.push({
      id: entity.id,
      objectType: 'entity',
      module: '实体',
      kind: ENTITY_KIND_LABEL[entity.kind],
      title: entity.name,
      snippet: entity.summary.slice(0, 80),
      folderId: entity.folderId,
      tags: [],
      referenceCount: refs.get(entity.id) ?? 0,
      attributes,
      searchText: text(entity.name, entity.technicalName, entity.summary, entity.notes, ...entity.fields.flatMap((field) => [field.label, field.value])),
      nav: { tab: 'entities', entityId: entity.id },
    });
  }

  for (const asset of p.assets) {
    hits.push({
      id: asset.id,
      objectType: 'asset',
      module: '资源',
      kind: asset.kind,
      title: asset.name,
      snippet: asset.notes.slice(0, 80),
      folderId: asset.folderId,
      tags: asset.tags,
      referenceCount: refs.get(asset.id) ?? 0,
      attributes: {
        名称: asset.name,
        类型: asset.kind,
        格式: asset.mime,
        来源: asset.source,
        授权: asset.license ?? '',
        技术名: asset.technicalName ?? '',
      },
      searchText: text(asset.name, asset.technicalName, asset.notes, asset.source, asset.license, ...asset.tags),
      nav: { tab: 'assets', assetId: asset.id },
    });
  }

  for (const document of p.documents) {
    hits.push({
      id: document.id,
      objectType: 'document',
      module: '文档',
      kind: document.category || '未分类',
      title: document.name,
      snippet: text(document.timeLabel, document.notes).slice(0, 80),
      folderId: document.folderId,
      tags: [],
      status: document.status,
      referenceCount: refs.get(document.id) ?? 0,
      attributes: {
        名称: document.name,
        分类: document.category,
        状态: document.status ? DOC_STATUS_LABEL[document.status] : '',
        POV: entityName(document.povId),
        地点: entityName(document.locationId),
        故事时间: document.timeLabel ?? '',
        修订轮次: document.revision ? String(document.revision) : '',
        技术名: document.technicalName ?? '',
      },
      searchText: text(
        document.name,
        document.technicalName,
        document.category,
        document.notes,
        document.timeLabel,
        ...document.blocks.flatMap((block) => [block.text, block.condition, block.instruction, ...(block.items ?? [])]),
      ),
      nav: { tab: 'documents', docId: document.id },
    });
  }

  for (const card of p.researchCards) {
    hits.push({
      id: card.id,
      objectType: 'research',
      module: '资料',
      kind: card.category || '未分类',
      title: card.title,
      snippet: card.content.slice(0, 80),
      folderId: card.folderId,
      tags: card.tags,
      referenceCount: refs.get(card.id) ?? 0,
      attributes: { 标题: card.title, 分类: card.category, 来源: card.source, 置顶: card.pinned ? '是' : '否' },
      searchText: text(card.title, card.content, card.category, card.source, ...card.tags),
      nav: { tab: 'research', cardId: card.id },
    });
  }

  for (const event of p.timelineEvents) {
    const names = event.entityIds.map((id) => entityName(id)).filter(Boolean);
    hits.push({
      id: event.id,
      objectType: 'timeline',
      module: '时间线',
      kind: pointName(event.pointId) || '事件',
      title: event.title,
      snippet: event.text.slice(0, 80),
      tags: [],
      referenceCount: refs.get(event.id) ?? 0,
      attributes: {
        标题: event.title,
        轨道: trackName(event.trackId),
        时间点: pointName(event.pointId),
        关联实体: names.join('、'),
      },
      searchText: text(event.title, event.text, trackName(event.trackId), pointName(event.pointId), ...names),
      nav: { tab: 'timeline', eventId: event.id },
    });
  }

  return hits;
}

export function queryProject(p: Project, query: ProjectQuery): QueryHit[] {
  const q = query.text.trim().toLocaleLowerCase();
  const attributeName = query.attributeName.trim().toLocaleLowerCase();
  const attributeValue = query.attributeValue.trim().toLocaleLowerCase();
  const tags = query.tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean);

  return buildQueryIndex(p).filter((hit) => {
    if (query.objectType !== 'all' && hit.objectType !== query.objectType) return false;
    if (q && !hit.searchText.toLocaleLowerCase().includes(q)) return false;
    if (query.folderId === 'ungrouped' && hit.folderId) return false;
    if (query.folderId !== 'any' && query.folderId !== 'ungrouped' && hit.folderId !== query.folderId) return false;
    if (query.status !== 'any' && hit.status !== query.status) return false;
    if (query.references === 'referenced' && hit.referenceCount === 0) return false;
    if (query.references === 'unreferenced' && hit.referenceCount > 0) return false;
    if (tags.length > 0) {
      const known = hit.tags.map((tag) => tag.toLocaleLowerCase());
      if (!tags.every((tag) => known.includes(tag))) return false;
    }
    if (attributeName || attributeValue) {
      const entries = Object.entries(hit.attributes).filter(([name]) =>
        !attributeName || name.toLocaleLowerCase().includes(attributeName));
      if (entries.length === 0) return false;
      if (attributeValue && !entries.some(([, value]) => value.toLocaleLowerCase().includes(attributeValue))) return false;
    }
    return true;
  });
}
