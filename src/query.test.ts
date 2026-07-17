import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_QUERY, queryProject } from './query';
import type { Project } from './types';

function fixture(): Project {
  return {
    version: 1,
    name: '查询测试',
    flows: [],
    entities: [{
      id: 'character',
      folderId: 'entity-folder',
      kind: 'character',
      name: '林岚',
      color: '',
      emoji: '',
      summary: '调查员',
      fields: [{ id: 'motive', label: '动机', value: '寻找真相' }],
      notes: '',
      createdAt: 1,
    }],
    brainstormNotes: [],
    brainstormEdges: [],
    outlineColumns: [],
    outlineRows: [],
    timelineTracks: [],
    timelinePoints: [],
    timelineEvents: [],
    maps: [],
    researchCards: [{
      id: 'card',
      title: '旧报纸',
      content: '港口失踪案',
      category: '考据',
      tags: ['港口', '历史'],
      color: '',
      source: '档案馆',
      pinned: false,
      createdAt: 1,
    }],
    researchCategories: ['考据'],
    variables: [],
    assets: [{
      id: 'asset',
      folderId: 'asset-folder',
      name: '港口地图',
      kind: 'image',
      mime: 'image/png',
      size: 10,
      tags: ['港口', '红色'],
      source: '自绘',
      license: 'CC-BY 4.0',
      notes: '',
      createdAt: 1,
    }],
    documents: [{
      id: 'document',
      folderId: 'document-folder',
      name: '雨夜调查',
      category: '正文',
      status: 'draft',
      povId: 'character',
      timeLabel: '午夜',
      blocks: [],
      notes: '',
      createdAt: 1,
      updatedAt: 1,
    }],
    documentCategories: ['正文'],
    attachments: { owner: ['asset'] },
    folders: [
      { id: 'entity-folder', module: 'entity', name: '角色', parentId: null },
      { id: 'asset-folder', module: 'asset', name: '地图', parentId: null },
      { id: 'document-folder', module: 'document', name: '第一卷', parentId: null },
    ],
    arcs: [{ id: 'arc', entityId: 'character', title: '觉醒', note: '', docId: 'document' }],
    updatedAt: 1,
  };
}

describe('组合查询', () => {
  it('组合文档类型、文件夹、属性、状态和引用状态', () => {
    const results = queryProject(fixture(), {
      ...DEFAULT_PROJECT_QUERY,
      objectType: 'document',
      folderId: 'document-folder',
      attributeName: 'POV',
      attributeValue: '林岚',
      status: 'draft',
      references: 'referenced',
    });
    expect(results.map((result) => result.id)).toEqual(['document']);
  });

  it('组合资源标签、授权属性和引用状态', () => {
    const results = queryProject(fixture(), {
      ...DEFAULT_PROJECT_QUERY,
      objectType: 'asset',
      tags: ['港口', '红色'],
      attributeName: '授权',
      attributeValue: 'cc-by',
      references: 'referenced',
    });
    expect(results.map((result) => result.id)).toEqual(['asset']);
  });

  it('查询实体自定义字段并返回跨模块导航', () => {
    const results = queryProject(fixture(), {
      ...DEFAULT_PROJECT_QUERY,
      objectType: 'entity',
      folderId: 'entity-folder',
      attributeName: '动机',
      attributeValue: '真相',
    });
    expect(results).toHaveLength(1);
    expect(results[0].nav).toEqual({ tab: 'entities', entityId: 'character' });
    expect(results[0].referenceCount).toBeGreaterThan(0);
  });

  it('支持未分组、未引用和全文条件叠加', () => {
    const results = queryProject(fixture(), {
      ...DEFAULT_PROJECT_QUERY,
      objectType: 'research',
      text: '失踪案',
      folderId: 'ungrouped',
      tags: ['历史'],
      references: 'unreferenced',
    });
    expect(results.map((result) => result.id)).toEqual(['card']);
  });

  it('文档与流程共享叙事单元时双方都视为被引用', () => {
    const p = fixture();
    p.arcs = [];
    p.units = [{ id: 'unit', kind: 'scene', title: '共享场景', text: '', createdAt: 1, updatedAt: 1 }];
    p.documents[0].blocks = [{ id: 'block', type: 'heading', text: '共享场景', unitId: 'unit' }];
    p.flows = [{
      id: 'flow',
      name: '共享流程',
      nodes: [{ id: 'node', type: 'fragment', position: { x: 0, y: 0 }, data: { title: '共享场景', text: '', unitId: 'unit' } }],
      edges: [],
    }];

    const results = queryProject(p, { ...DEFAULT_PROJECT_QUERY, references: 'referenced' });
    expect(results.map((result) => result.id)).toEqual(expect.arrayContaining(['document', 'flow']));
  });
});
