import type { EntityField, Project, SubFlow } from './types';
import { createIssue, pathReportIssues, type IssueScope, type IssueSeverity, type ProjectIssue } from './issues';
import type { NavTarget } from './search';
import { simulateFlow } from './simulate';

interface AddIssue {
  code: string;
  kind: string;
  message: string;
  severity?: IssueSeverity;
  scope?: IssueScope;
  nav?: NavTarget;
  objectId?: string;
}

export function advancedAuditProject(p: Project): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const entities = new Map(p.entities.map((entity) => [entity.id, entity]));
  const documents = new Map(p.documents.map((document) => [document.id, document]));
  const units = new Set((p.units ?? []).map((unit) => unit.id));
  const timelineTracks = new Set(p.timelineTracks.map((track) => track.id));
  const timelinePoints = new Set(p.timelinePoints.map((point) => point.id));
  const outlineColumns = new Set(p.outlineColumns.map((column) => column.id));
  const attachmentOwners = new Set<string>([
    ...p.entities.map((entity) => entity.id),
    ...p.researchCards.map((card) => card.id),
    ...p.timelineEvents.map((event) => event.id),
    ...p.documents.flatMap((document) => [document.id, ...document.blocks.map((block) => block.id)]),
    ...p.outlineRows.map((row) => row.id),
  ]);
  const add = (input: AddIssue) => issues.push(createIssue({
    code: input.code,
    source: input.code.startsWith('path.') ? 'path' : 'audit',
    severity: input.severity ?? 'error',
    scope: input.scope ?? 'project',
    kind: input.kind,
    message: input.message,
    nav: input.nav,
    objectId: input.objectId,
  }));

  const checkEntityFields = (fields: EntityField[], owner: string, nav: NavTarget, objectId: string) => {
    for (const field of fields) {
      if (field.type !== 'entity' && field.type !== 'entities') continue;
      const ids = field.type === 'entity'
        ? [field.value.trim()].filter(Boolean)
        : field.value.split(',').map((id) => id.trim()).filter(Boolean);
      for (const id of ids) {
        const target = entities.get(id);
        if (!target) {
          add({
            code: 'reference.entity-field',
            kind: '无效引用',
            message: `${owner} · 字段「${field.label}」引用了不存在的实体 ${id.slice(0, 8)}…`,
            scope: nav.tab === 'entities' ? 'entity' : 'flow',
            nav,
            objectId,
          });
        } else if (field.filterKind && target.kind !== field.filterKind) {
          add({
            code: 'consistency.entity-field-kind',
            kind: '类型不一致',
            message: `${owner} · 字段「${field.label}」要求 ${field.filterKind},实际引用「${target.name}」(${target.kind})`,
            severity: 'warning',
            scope: nav.tab === 'entities' ? 'entity' : 'flow',
            nav,
            objectId,
          });
        }
      }
    }
  };

  for (const entity of p.entities) {
    checkEntityFields(entity.fields, entity.name, { tab: 'entities', entityId: entity.id }, entity.id);
  }

  for (const flow of p.flows) {
    const walk = (sub: SubFlow, path: string[]) => {
      const nodeIds = new Set(sub.nodes.map((node) => node.id));
      for (const edge of sub.edges) {
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
          add({
            code: 'reference.flow-edge',
            kind: '无效连线',
            message: `${flow.name} · 连线 ${edge.id.slice(0, 8)}… 的${!nodeIds.has(edge.source) ? '起点' : '终点'}不存在`,
            scope: 'flow',
            nav: { tab: 'flow', flowId: flow.id, path },
            objectId: edge.id,
          });
        }
      }
      for (const node of sub.nodes) {
        attachmentOwners.add(node.id);
        const nav: NavTarget = { tab: 'flow', flowId: flow.id, path, nodeId: node.id };
        const label = `${flow.name} · ${node.data.title || node.type}`;
        if (node.data.speakerId) {
          const speaker = entities.get(node.data.speakerId);
          if (!speaker) {
            add({ code: 'reference.flow-speaker', kind: '无效引用', message: `${label}的说话人不存在`, scope: 'flow', nav, objectId: node.id });
          } else if (speaker.kind !== 'character') {
            add({
              code: 'consistency.flow-speaker-kind',
              kind: '角色一致性',
              message: `${label}的说话人「${speaker.name}」不是角色实体`,
              severity: 'warning',
              scope: 'flow',
              nav,
              objectId: node.id,
            });
          }
        }
        if (node.data.unitId && !units.has(node.data.unitId)) {
          add({ code: 'reference.flow-unit', kind: '无效叙事单元', message: `${label}引用的叙事单元不存在`, scope: 'flow', nav, objectId: node.id });
        }
        checkEntityFields(node.data.fields ?? [], label, nav, node.id);
        if (node.data.sub) walk(node.data.sub, [...path, node.id]);
      }
    };
    walk(flow, []);
    issues.push(...pathReportIssues(flow.id, simulateFlow(flow, p.variables, p.entities)));
  }

  for (const document of p.documents) {
    const nav: NavTarget = { tab: 'documents', docId: document.id };
    if (document.povId) {
      const pov = entities.get(document.povId);
      if (!pov) {
        add({ code: 'reference.document-pov', kind: '无效引用', message: `${document.name}的 POV 角色不存在`, scope: 'document', nav, objectId: document.id });
      } else if (pov.kind !== 'character') {
        add({ code: 'consistency.document-pov-kind', kind: '角色一致性', message: `${document.name}的 POV「${pov.name}」不是角色实体`, severity: 'warning', scope: 'document', nav, objectId: document.id });
      }
    }
    if (document.locationId) {
      const location = entities.get(document.locationId);
      if (!location) {
        add({ code: 'reference.document-location', kind: '无效引用', message: `${document.name}的地点不存在`, scope: 'document', nav, objectId: document.id });
      } else if (location.kind !== 'location') {
        add({ code: 'consistency.document-location-kind', kind: '类型不一致', message: `${document.name}的地点「${location.name}」不是地点实体`, severity: 'warning', scope: 'document', nav, objectId: document.id });
      }
    }
    for (const block of document.blocks) {
      const blockNav: NavTarget = { ...nav, blockId: block.id };
      if (block.speakerId) {
        const speaker = entities.get(block.speakerId);
        if (!speaker) {
          add({ code: 'reference.document-speaker', kind: '无效引用', message: `${document.name} · 对白块的说话人不存在`, scope: 'document', nav: blockNav, objectId: block.id });
        } else if (speaker.kind !== 'character') {
          add({ code: 'consistency.document-speaker-kind', kind: '角色一致性', message: `${document.name} · 对白块的说话人「${speaker.name}」不是角色实体`, severity: 'warning', scope: 'document', nav: blockNav, objectId: block.id });
        }
      }
      if (block.unitId && !units.has(block.unitId)) {
        add({ code: 'reference.document-unit', kind: '无效叙事单元', message: `${document.name} · 正文块引用的叙事单元不存在`, scope: 'document', nav: blockNav, objectId: block.id });
      }
    }
  }

  const characterEvents = new Map<string, { entityId: string; events: typeof p.timelineEvents }>();
  for (const event of p.timelineEvents) {
    const nav: NavTarget = { tab: 'timeline', eventId: event.id };
    if (!timelineTracks.has(event.trackId)) {
      add({ code: 'reference.timeline-track', kind: '无效引用', message: `时间线事件「${event.title}」的轨道不存在`, scope: 'timeline', nav, objectId: event.id });
    }
    if (!timelinePoints.has(event.pointId)) {
      add({ code: 'reference.timeline-point', kind: '无效引用', message: `时间线事件「${event.title}」的时间点不存在`, scope: 'timeline', nav, objectId: event.id });
    }
    for (const entityId of new Set(event.entityIds)) {
      const entity = entities.get(entityId);
      if (!entity) {
        add({ code: 'reference.timeline-entity', kind: '无效引用', message: `时间线事件「${event.title}」引用了不存在的实体`, scope: 'timeline', nav, objectId: event.id });
      } else if (entity.kind === 'character' && timelinePoints.has(event.pointId)) {
        const key = `${event.pointId}:${entityId}`;
        const group = characterEvents.get(key) ?? { entityId, events: [] };
        group.events.push(event);
        characterEvents.set(key, group);
      }
    }
  }
  for (const { entityId, events } of characterEvents.values()) {
    if (events.length < 2) continue;
    const entity = entities.get(entityId);
    if (!entity) continue;
    const point = p.timelinePoints.find((candidate) => candidate.id === events[0].pointId);
    add({
      code: 'timeline.character-conflict',
      kind: '时间冲突',
      message: `${entity.name}在「${point?.label ?? '同一时间点'}」同时关联 ${events.length} 个事件:${events.map((event) => event.title).join('、')}`,
      severity: 'warning',
      scope: 'timeline',
      nav: { tab: 'timeline', eventId: events[0].id },
      objectId: entity.id,
    });
  }

  for (const map of p.maps) {
    const checkMapObject = (item: { id: string; label: string; entityId?: string; fromPointId?: string; toPointId?: string }, markerId?: string) => {
      const nav: NavTarget = { tab: 'map', mapId: map.id, markerId };
      if (item.entityId && !entities.has(item.entityId)) {
        add({ code: 'reference.map-entity', kind: '无效引用', message: `${map.name} ·「${item.label}」引用的实体不存在`, scope: 'map', nav, objectId: item.id });
      }
      if (item.fromPointId && !timelinePoints.has(item.fromPointId)) {
        add({ code: 'reference.map-from-point', kind: '无效引用', message: `${map.name} ·「${item.label}」的起始时间点不存在`, scope: 'map', nav, objectId: item.id });
      }
      if (item.toPointId && !timelinePoints.has(item.toPointId)) {
        add({ code: 'reference.map-to-point', kind: '无效引用', message: `${map.name} ·「${item.label}」的结束时间点不存在`, scope: 'map', nav, objectId: item.id });
      }
    };
    for (const marker of map.markers) checkMapObject(marker, marker.id);
    for (const region of map.regions) checkMapObject(region);
  }

  const brainNoteIds = new Set(p.brainstormNotes.map((note) => note.id));
  for (const edge of p.brainstormEdges) {
    if (!brainNoteIds.has(edge.source) || !brainNoteIds.has(edge.target)) {
      add({ code: 'reference.brain-edge', kind: '无效连线', message: `风暴板连线 ${edge.id.slice(0, 8)}… 指向不存在的便签`, scope: 'brainstorm', nav: { tab: 'brainstorm' }, objectId: edge.id });
    }
  }
  for (const row of p.outlineRows) {
    for (const columnId of Object.keys(row.cells)) {
      if (!outlineColumns.has(columnId)) {
        add({ code: 'reference.outline-column', kind: '无效引用', message: `大纲「${row.title || row.no}」保留了已删除剧情线的单元格`, scope: 'outline', nav: { tab: 'outline' }, objectId: row.id });
      }
    }
  }

  for (const relation of p.relations ?? []) {
    if (!entities.has(relation.fromId) || !entities.has(relation.toId) || relation.fromId === relation.toId) {
      add({ code: 'reference.relation', kind: '无效引用', message: `人物关系「${relation.label || '(未命名)'}」的端点无效`, scope: 'planning', nav: { tab: 'planning', planningView: 'relations' }, objectId: relation.id });
    }
  }
  for (const arc of p.arcs ?? []) {
    const entity = entities.get(arc.entityId);
    const nav: NavTarget = { tab: 'planning', planningView: 'arcs', entityId: arc.entityId };
    if (!entity) {
      add({ code: 'reference.arc-entity', kind: '无效引用', message: `角色弧线「${arc.title}」的角色不存在`, scope: 'planning', nav, objectId: arc.id });
    } else if (entity.kind !== 'character') {
      add({ code: 'consistency.arc-entity-kind', kind: '角色一致性', message: `弧线「${arc.title}」属于非角色实体「${entity.name}」`, severity: 'warning', scope: 'planning', nav, objectId: arc.id });
    }
    if (arc.docId && !documents.has(arc.docId)) {
      add({ code: 'reference.arc-document', kind: '无效引用', message: `角色弧线「${arc.title}」关联的场景不存在`, scope: 'planning', nav, objectId: arc.id });
    }
  }
  for (const foreshadow of p.foreshadows ?? []) {
    for (const ref of [...foreshadow.plants, ...foreshadow.payoffs]) {
      if (!documents.has(ref.docId)) {
        add({ code: 'reference.foreshadow-document', kind: '无效引用', message: `伏笔「${foreshadow.title}」关联的场景不存在`, scope: 'planning', nav: { tab: 'planning', planningView: 'foreshadow', foreshadowId: foreshadow.id }, objectId: foreshadow.id });
      }
    }
  }

  for (const ownerId of Object.keys(p.attachments ?? {})) {
    if (!attachmentOwners.has(ownerId)) {
      add({
        code: 'reference.attachment-owner',
        kind: '悬挂附件',
        message: `附件映射指向了不存在的对象 ${ownerId.slice(0, 8)}…`,
        scope: 'asset',
        nav: { tab: 'assets' },
        objectId: ownerId,
      });
    }
  }

  return issues;
}
