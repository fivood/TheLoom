import { describe, expect, it } from 'vitest';
import {
  cleanTemplateRefs,
  defaultEntityTemplate,
  migrateLegacyTemplates,
  migrateTemplateInstances,
  resolveTemplateFields,
  specsForEntity,
} from './templates';
import { sampleProject } from './sample';
import type { ObjectTemplate, Project } from './types';
import { ENTITY_KIND_LABEL, FLOW_NODE_LABEL } from './types';
import { normalizeProject } from './util';

function tpl(partial: Partial<ObjectTemplate> & Pick<ObjectTemplate, 'id' | 'name' | 'module'>): ObjectTemplate {
  return { fields: [], createdAt: 1, updatedAt: 1, ...partial };
}

function baseProject(): Project {
  const p = structuredClone(sampleProject());
  return normalizeProject(p);
}

describe('R11 模板解析与继承', () => {
  it('父模板字段先出,同名字段子模板覆盖', () => {
    const p = baseProject();
    p.templates = [
      tpl({ id: 'base', name: '基础', module: 'entity', fields: [{ label: '出身' }, { label: '目标', required: true }] }),
      tpl({ id: 'child', name: '角色', module: 'entity', parentId: 'base', fields: [{ label: '目标', enumValues: ['复仇', '救赎'] }, { label: '口头禅' }] }),
    ];
    const fields = resolveTemplateFields(p, 'child');
    expect(fields.map((f) => f.label)).toEqual(['出身', '目标', '口头禅']);
    expect(fields[1].enumValues).toEqual(['复仇', '救赎']);
    expect(fields[1].required).toBeUndefined();
  });

  it('继承环与缺失父模板被安全忽略 / 清理', () => {
    const p = baseProject();
    p.templates = [
      tpl({ id: 'a', name: 'A', module: 'entity', parentId: 'b', fields: [{ label: 'x' }] }),
      tpl({ id: 'b', name: 'B', module: 'entity', parentId: 'a', fields: [{ label: 'y' }] }),
      tpl({ id: 'c', name: 'C', module: 'entity', parentId: 'ghost', fields: [{ label: 'z' }] }),
    ];
    expect(resolveTemplateFields(p, 'a').map((f) => f.label)).toEqual(['y', 'x']);
    cleanTemplateRefs(p);
    expect(p.templates.find((t) => t.id === 'c')?.parentId).toBeUndefined();
    expect(p.templates.filter((t) => t.parentId).length).toBeLessThan(2);
  });
});

describe('R11 旧模板迁移', () => {
  it('entityTemplates / nodeTemplates 迁移为命名模板并分配到既有对象', () => {
    const p = baseProject();
    delete p.templates;
    for (const e of p.entities) e.templateId = undefined;
    p.entityTemplates = { character: ['口头禅', { label: '阵营立场', required: true }] };
    p.nodeTemplates = { dialogue: [{ label: '情绪' }] };
    normalizeProject(p);

    expect(p.entityTemplates).toBeUndefined();
    expect(p.nodeTemplates).toBeUndefined();
    const charTpl = defaultEntityTemplate(p, 'character');
    expect(charTpl?.name).toBe(`${ENTITY_KIND_LABEL.character}模板`);
    expect(charTpl?.fields).toEqual([{ label: '口头禅' }, { label: '阵营立场', required: true }]);
    const nodeTpl = p.templates!.find((t) => t.module === 'node' && t.nodeType === 'dialogue');
    expect(nodeTpl?.name).toBe(`${FLOW_NODE_LABEL.dialogue}节点模板`);
    for (const e of p.entities.filter((x) => x.kind === 'character')) {
      expect(e.templateId).toBe(charTpl!.id);
      // 实例安全迁移:模板字段已补齐到实例
      expect(e.fields.some((f) => f.label === '口头禅')).toBe(true);
      expect(e.fields.some((f) => f.label === '阵营立场')).toBe(true);
    }
  });
});

describe('R11 实例安全迁移(验收)', () => {
  it('模板新增字段后实例自动补齐,已有值绝不被改写', () => {
    const p = baseProject();
    const character = p.entities.find((e) => e.kind === 'character')!;
    p.templates = [tpl({ id: 't1', name: '角色卡', module: 'entity', fields: [{ label: '目标' }] })];
    character.templateId = 't1';
    migrateTemplateInstances(p);
    expect(character.fields.some((f) => f.label === '目标' && f.value === '')).toBe(true);

    const existing = character.fields.find((f) => f.label === '目标')!;
    existing.value = '找到妹妹';
    p.templates[0].fields.push({ label: '弱点', type: 'text' });
    const added = migrateTemplateInstances(p);
    expect(added).toBeGreaterThan(0);
    expect(character.fields.find((f) => f.label === '目标')!.value).toBe('找到妹妹');
    expect(character.fields.some((f) => f.label === '弱点')).toBe(true);

    // 幂等:再跑一次不重复添加
    expect(migrateTemplateInstances(p)).toBe(0);
  });

  it('specsForEntity 走分配的模板;模板删除后引用被清理', () => {
    const p = baseProject();
    p.templates = [tpl({ id: 't1', name: '角色卡', module: 'entity', fields: [{ label: '目标', required: true }] })];
    const character = p.entities.find((e) => e.kind === 'character')!;
    character.templateId = 't1';
    expect(specsForEntity(p, character).map((f) => f.label)).toEqual(['目标']);

    p.templates = [];
    cleanTemplateRefs(p);
    expect(character.templateId).toBeUndefined();
    expect(specsForEntity(p, character)).toEqual([]);
  });

  it('流程节点实例同样按分配模板补齐字段', () => {
    const p = baseProject();
    p.templates = [tpl({ id: 'nt', name: '对白节点', module: 'node', nodeType: 'dialogue', fields: [{ label: '情绪' }] })];
    const flow = p.flows[0];
    const dialogue = flow.nodes.find((n) => n.type === 'dialogue')!;
    dialogue.data.templateId = 'nt';
    migrateTemplateInstances(p);
    expect((dialogue.data.fields ?? []).some((f) => f.label === '情绪')).toBe(true);
  });
});

describe('R11-2 资源 / 文档 / 地图套用模板', () => {
  it('三类对象按分配模板补齐字段,清理失效引用', () => {
    const p = baseProject();
    p.templates = [
      tpl({ id: 'ta', name: '素材卡', module: 'asset', fields: [{ label: '用途' }] }),
      tpl({ id: 'td', name: '场景卡', module: 'document', fields: [{ label: '钩子', required: true }] }),
      tpl({ id: 'tm', name: '地图卡', module: 'map', fields: [{ label: '气候' }] }),
    ];
    p.assets.push({ id: 'a1', name: '图', kind: 'image', mime: 'image/png', size: 1, tags: [], source: '', notes: '', createdAt: 1, templateId: 'ta' } as never);
    p.documents[0].templateId = 'td';
    p.maps.push({ id: 'm1', name: '大陆', markers: [], regions: [], templateId: 'tm' } as never);

    migrateTemplateInstances(p);
    expect(p.assets.find((a) => a.id === 'a1')!.fields!.map((f) => f.label)).toEqual(['用途']);
    expect(p.documents[0].fields!.map((f) => f.label)).toEqual(['钩子']);
    expect(p.maps.find((m) => m.id === 'm1')!.fields!.map((f) => f.label)).toEqual(['气候']);

    p.templates = [];
    cleanTemplateRefs(p);
    expect(p.assets.find((a) => a.id === 'a1')!.templateId).toBeUndefined();
    expect(p.documents[0].templateId).toBeUndefined();
    expect(p.maps.find((m) => m.id === 'm1')!.templateId).toBeUndefined();
  });

  it('文档 templateId 与 fields 经 md frontmatter 无损往返', async () => {
    const { documentToMd, mdToDocument } = await import('./storage');
    const p = baseProject();
    const doc = structuredClone(p.documents[0]);
    doc.templateId = 'td';
    doc.fields = [
      { id: 'f1', label: '钩子', value: '断电的电梯' },
      { id: 'f2', label: '嫌疑人', value: 'e9', type: 'entity', filterKind: 'character' },
    ];
    const md = documentToMd(doc, p.entities);
    const back = mdToDocument(`${doc.name}.md`, md, 0);
    expect(back.templateId).toBe('td');
    expect(back.fields).toEqual(doc.fields);
  });
});

describe('R11 旧模板迁移不影响审计与提案约束', () => {
  it('必填约束经命名模板继续生效(audit 必填缺失)', async () => {
    const p = baseProject();
    delete p.templates;
    p.entityTemplates = { character: [{ label: '软肋', required: true }] };
    normalizeProject(p);
    const { auditProject } = await import('./audit');
    const issues = auditProject(p);
    expect(issues.some((issue) => issue.kind === '必填缺失' && issue.message.includes('软肋'))).toBe(true);
  });
});
