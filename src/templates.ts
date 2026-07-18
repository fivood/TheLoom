import type {
  Entity,
  EntityKind,
  EntityTemplateField,
  EntityTemplateSpec,
  FlowNodeData,
  FlowNodeType,
  ObjectTemplate,
  Project,
} from './types';
import { uid, walkFlowNodes } from './util';

export const normTemplateField = (s: EntityTemplateSpec): EntityTemplateField =>
  typeof s === 'string' ? { label: s } : s;

/**
 * 解析模板的完整字段表:先父后子,同 label 子覆盖父;链上出现环或缺失父时忽略。
 */
export function resolveTemplateFields(p: Project, templateId: string | undefined, seen = new Set<string>()): EntityTemplateField[] {
  if (!templateId || seen.has(templateId)) return [];
  const template = (p.templates ?? []).find((t) => t.id === templateId);
  if (!template) return [];
  seen.add(templateId);
  const parent = resolveTemplateFields(p, template.parentId, seen);
  const merged = [...parent];
  for (const field of template.fields) {
    const at = merged.findIndex((item) => item.label === field.label);
    if (at >= 0) merged[at] = field;
    else merged.push(field);
  }
  return merged;
}

/** 某类别的默认模板(新建对象自动套用;旧版按类别模板迁移后落在这里) */
export function defaultEntityTemplate(p: Project, kind: EntityKind): ObjectTemplate | undefined {
  return (p.templates ?? []).find((t) => t.module === 'entity' && t.entityKind === kind);
}

export function defaultNodeTemplate(p: Project, nodeType: FlowNodeType): ObjectTemplate | undefined {
  return (p.templates ?? []).find((t) => t.module === 'node' && t.nodeType === nodeType);
}

/** 实体的生效模板字段(供字段编辑器约束、audit 必填、AI 提案权限用) */
export function specsForEntity(p: Project, entity: Pick<Entity, 'templateId'>): EntityTemplateField[] {
  return resolveTemplateFields(p, entity.templateId);
}

export function specsForNode(p: Project, data: FlowNodeData): EntityTemplateField[] {
  return resolveTemplateFields(p, typeof data.templateId === 'string' ? data.templateId : undefined);
}

/** 资源 / 文档 / 地图共用:按对象自身的 templateId 解析 */
export function specsForObject(p: Project, obj: { templateId?: string }): EntityTemplateField[] {
  return resolveTemplateFields(p, obj.templateId);
}

/**
 * 实例安全迁移:被分配模板的对象自动补齐模板新增的字段。
 * 只追加缺失字段,绝不删除或改写实例上已有的值。返回补齐的字段总数。
 */
export function migrateTemplateInstances(p: Project): number {
  let added = 0;
  const ensure = (fields: { id: string; label: string; value: string }[], specs: EntityTemplateField[]) => {
    for (const spec of specs) {
      if (!spec.label || fields.some((f) => f.label === spec.label)) continue;
      fields.push({ id: uid(), label: spec.label, value: '', ...(spec.type ? { type: spec.type } : {}), ...(spec.filterKind ? { filterKind: spec.filterKind } : {}) });
      added++;
    }
  };
  for (const entity of p.entities) {
    if (entity.templateId) ensure(entity.fields, resolveTemplateFields(p, entity.templateId));
  }
  for (const flow of p.flows) {
    walkFlowNodes(flow.nodes, (node) => {
      if (typeof node.data.templateId !== 'string') return;
      const specs = resolveTemplateFields(p, node.data.templateId);
      if (specs.length === 0) return;
      node.data.fields ??= [];
      ensure(node.data.fields, specs);
    });
  }
  for (const obj of [...p.assets, ...p.documents, ...p.maps]) {
    if (!obj.templateId) continue;
    const specs = resolveTemplateFields(p, obj.templateId);
    if (specs.length === 0) continue;
    obj.fields ??= [];
    ensure(obj.fields, specs);
  }
  return added;
}

/**
 * 迁移旧版按类别模板(entityTemplates / nodeTemplates)为命名模板,
 * 并把对应类别的既有对象分配到迁移出的模板上(保持旧行为:类别模板作用于全类别)。
 */
export function migrateLegacyTemplates(p: Project, labels: { entity: Record<string, string>; node: Record<string, string> }) {
  p.templates ??= [];
  const now = Date.now();
  if (p.entityTemplates) {
    for (const [kind, specs] of Object.entries(p.entityTemplates)) {
      if (!specs || specs.length === 0) continue;
      let template = defaultEntityTemplate(p, kind as EntityKind);
      if (!template) {
        template = {
          id: uid(),
          name: `${labels.entity[kind] ?? kind}模板`,
          module: 'entity',
          entityKind: kind as EntityKind,
          fields: specs.map(normTemplateField),
          createdAt: now,
          updatedAt: now,
        };
        p.templates.push(template);
      }
      for (const entity of p.entities) {
        if (entity.kind === kind && !entity.templateId) entity.templateId = template.id;
      }
    }
    delete p.entityTemplates;
  }
  if (p.nodeTemplates) {
    for (const [nodeType, specs] of Object.entries(p.nodeTemplates)) {
      if (!specs || specs.length === 0) continue;
      let template = defaultNodeTemplate(p, nodeType as FlowNodeType);
      if (!template) {
        template = {
          id: uid(),
          name: `${labels.node[nodeType] ?? nodeType}节点模板`,
          module: 'node',
          nodeType: nodeType as FlowNodeType,
          fields: specs.map(normTemplateField),
          createdAt: now,
          updatedAt: now,
        };
        p.templates.push(template);
      }
      for (const flow of p.flows) {
        walkFlowNodes(flow.nodes, (node) => {
          if (node.type === nodeType && typeof node.data.templateId !== 'string') {
            node.data.templateId = template!.id;
          }
        });
      }
    }
    delete p.nodeTemplates;
  }
}

/** 清理:剔除指向缺失模板的分配与非法 parentId(缺失或成环) */
export function cleanTemplateRefs(p: Project) {
  const ids = new Set((p.templates ?? []).map((t) => t.id));
  for (const template of p.templates ?? []) {
    if (template.parentId && (!ids.has(template.parentId) || template.parentId === template.id)) {
      template.parentId = undefined;
    }
  }
  for (const template of p.templates ?? []) {
    const seen = new Set<string>([template.id]);
    let cur = template.parentId;
    while (cur) {
      if (seen.has(cur)) { template.parentId = undefined; break; }
      seen.add(cur);
      cur = (p.templates ?? []).find((t) => t.id === cur)?.parentId;
    }
  }
  for (const entity of p.entities) {
    if (entity.templateId && !ids.has(entity.templateId)) entity.templateId = undefined;
  }
  for (const flow of p.flows) {
    walkFlowNodes(flow.nodes, (node) => {
      if (typeof node.data.templateId === 'string' && !ids.has(node.data.templateId)) {
        delete node.data.templateId;
      }
    });
  }
  for (const obj of [...p.assets, ...p.documents, ...p.maps]) {
    if (obj.templateId && !ids.has(obj.templateId)) obj.templateId = undefined;
  }
}
