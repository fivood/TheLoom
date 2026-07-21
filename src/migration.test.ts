import { describe, expect, it } from 'vitest';
import { normalizeProject, uid } from './util';
import type { Project } from './types';

/**
 * R16-5 · 升级迁移测试:v0.9 → v0.32 各代新增字段都能被 normalizeProject
 * 自动补齐,老 JSON 加载后不崩、不丢数据。相当于把「旧项目导入不炸」这道
 * 底线用 unit test 焊死:未来任何新字段引入都必须走 ??= 补齐路径。
 *
 * 每代最小 JSON 覆盖那一代的字段集合,依次经过 normalizeProject 后验证。
 */

function v09MinimalJson() {
  // v0.9(工程安全基线)时的最小项目 —— 只有基础模块 + 变量 + 附件
  return {
    version: 1,
    name: 'v0.9 老项目',
    flows: [{ id: 'f1', name: '第一章', nodes: [], edges: [] }],
    entities: [],
    brainstormNotes: [],
    brainstormEdges: [],
    outlineColumns: [],
    outlineRows: [],
    timelineTracks: [],
    timelinePoints: [],
    timelineEvents: [],
    maps: [],
    researchCards: [],
    researchCategories: [],
    variables: [],
    assets: [],
    documents: [],
    documentCategories: [],
    attachments: {},
    updatedAt: Date.now(),
  } as unknown as Project;
}

function v11MinimalJson() {
  // v0.11 新增文件夹与拖拽
  return { ...v09MinimalJson(), folders: [] } as Project;
}

function v12MinimalJson() {
  // v0.12 新增叙事单元
  return { ...v11MinimalJson(), units: [] } as Project;
}

function v16MinimalJson() {
  // v0.16 (R4) 规划模块 - relations / arcs / foreshadows
  return { ...v12MinimalJson(), relations: [], arcs: [], foreshadows: [] } as Project;
}

function v17MinimalJson() {
  // v0.17 (R5) 修订系统 - annotations / docSnapshots
  return { ...v16MinimalJson(), annotations: [], docSnapshots: [] } as Project;
}

describe('R16-5 升级迁移:老版本 JSON 加载后不炸', () => {
  it('v0.9 极简项目 → normalizeProject 后所有必要字段就位', () => {
    const p = v09MinimalJson();
    // 关键:v0.9 里没有 folders / units / relations / palettes / templates 等
    delete (p as unknown as Record<string, unknown>).folders;
    normalizeProject(p);
    expect(Array.isArray(p.folders)).toBe(true);
    expect(Array.isArray(p.relations)).toBe(true);
    expect(Array.isArray(p.arcs)).toBe(true);
    expect(Array.isArray(p.foreshadows)).toBe(true);
    expect(Array.isArray(p.units)).toBe(true);
    expect(Array.isArray(p.annotations)).toBe(true);
    expect(Array.isArray(p.docSnapshots)).toBe(true);
    expect(Array.isArray(p.palettes)).toBe(true);
    expect(Array.isArray(p.savedQueries)).toBe(true);
  });

  it('v0.11 → 当前:folder 树无破损', () => {
    const p = v11MinimalJson();
    normalizeProject(p);
    expect(p.folders).toEqual([]);
  });

  it('v0.14(带 documents 但无 units)迁移后 units 数组非空(单元被建)', () => {
    const p = v12MinimalJson();
    // 塞一个带块的文档但不带 unitId,syncNarrativeUnits 应该建单元
    p.documents.push({
      id: uid(), name: '开场', category: '正文',
      blocks: [{ id: uid(), type: 'dialogue', text: '雨。' }],
      notes: '', createdAt: Date.now(), updatedAt: Date.now(),
    });
    normalizeProject(p);
    expect(p.units.length).toBeGreaterThan(0);
    // 文档块应被回填 unitId
    const block = p.documents[0].blocks[0];
    expect(typeof block.unitId).toBe('string');
  });

  it('v0.16 → 当前:规划模块 relations / arcs / foreshadows 保留', () => {
    const p = v16MinimalJson();
    p.entities.push({
      id: 'e1', name: '甲', kind: 'character', color: '#000', emoji: '',
      summary: '', notes: '', fields: [], createdAt: Date.now(),
    });
    p.entities.push({
      id: 'e2', name: '乙', kind: 'character', color: '#000', emoji: '',
      summary: '', notes: '', fields: [], createdAt: Date.now(),
    });
    p.relations = [{ id: 'r1', fromId: 'e1', toId: 'e2', label: '搭档' }];
    p.arcs = [{ id: 'a1', entityId: 'e1', title: '起始', note: '' }];
    p.foreshadows = [{ id: 'fs1', title: '伏笔', note: '', plants: [], payoffs: [], createdAt: Date.now() }];
    normalizeProject(p);
    expect(p.relations).toHaveLength(1);
    expect(p.arcs).toHaveLength(1);
    expect(p.foreshadows).toHaveLength(1);
  });

  it('v0.17 修订字段无损(annotations / docSnapshots 幂等)', () => {
    const p = v17MinimalJson();
    p.documents.push({
      id: 'd1', name: '场景', category: '正文', blocks: [],
      notes: '', createdAt: Date.now(), updatedAt: Date.now(),
    });
    p.annotations = [{ id: 'an1', docId: 'd1', text: '备注', resolved: false }];
    p.docSnapshots = [{ id: 'sn1', docId: 'd1', label: '存档', blocks: [], revision: 1 }];
    normalizeProject(p);
    expect(p.annotations).toHaveLength(1);
    expect(p.docSnapshots).toHaveLength(1);
  });

  it('极端老项目(缺全部新字段)normalize 不抛异常且字段齐全', () => {
    // 只保留最原始的字段,连很多老基础字段都缺
    const p = {
      version: 1,
      name: '化石项目',
      flows: [],
      entities: [],
      documents: [],
      variables: [],
      updatedAt: Date.now(),
    } as unknown as Project;
    expect(() => normalizeProject(p)).not.toThrow();
    // 关键字段都在
    for (const k of ['flows', 'entities', 'brainstormNotes', 'brainstormEdges',
      'outlineColumns', 'outlineRows', 'timelineTracks', 'timelinePoints',
      'timelineEvents', 'maps', 'researchCards', 'researchCategories',
      'variables', 'assets', 'documents', 'documentCategories',
      'folders', 'palettes', 'relations', 'arcs', 'foreshadows',
      'units', 'annotations', 'docSnapshots', 'savedQueries'] as const) {
      expect(Array.isArray((p as unknown as Record<string, unknown>)[k])).toBe(true);
    }
    expect(typeof p.attachments).toBe('object');
  });
});
