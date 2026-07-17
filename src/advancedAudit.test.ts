import { describe, expect, it } from 'vitest';
import { advancedAuditProject } from './advancedAudit';
import type { Project } from './types';

function project(): Project {
  return {
    version: 1,
    name: '体检测试',
    flows: [],
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
    folders: [],
    units: [],
    updatedAt: 1,
  };
}

describe('R10 高级体检', () => {
  it('发现跨模块无效引用与角色类型不一致', () => {
    const p = project();
    p.entities = [
      { id: 'char', kind: 'character', name: '角色', color: '', emoji: '', summary: '', fields: [], notes: '', createdAt: 1 },
      { id: 'loc', kind: 'location', name: '地点', color: '', emoji: '', summary: '', fields: [], notes: '', createdAt: 1 },
      {
        id: 'item',
        kind: 'item',
        name: '物品',
        color: '',
        emoji: '',
        summary: '',
        fields: [
          { id: 'f1', label: '持有者', value: 'loc', type: 'entity', filterKind: 'character' },
          { id: 'f2', label: '制造者', value: 'missing', type: 'entity' },
        ],
        notes: '',
        createdAt: 1,
      },
    ];
    p.flows = [{
      id: 'flow',
      name: '流程',
      nodes: [{ id: 'node', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '对白', text: '文本', speakerId: 'item' } }],
      edges: [{ id: 'bad-edge', source: 'node', target: 'missing' }],
    }];
    p.documents = [{
      id: 'doc',
      name: '场景',
      category: '',
      blocks: [{ id: 'block', type: 'dialogue', text: '文本', speakerId: 'missing' }],
      notes: '',
      povId: 'loc',
      locationId: 'char',
      createdAt: 1,
      updatedAt: 1,
    }];
    p.timelineTracks = [
      { id: 'track-1', name: '主线', color: '' },
      { id: 'track-2', name: '支线', color: '' },
    ];
    p.timelinePoints = [{ id: 'point', label: '午夜' }];
    p.timelineEvents = [
      { id: 'event-1', trackId: 'track-1', pointId: 'point', title: '事件一', text: '', entityIds: ['char'] },
      { id: 'event-2', trackId: 'track-2', pointId: 'point', title: '事件二', text: '', entityIds: ['char'] },
    ];
    p.maps = [{ id: 'map', name: '地图', markers: [{ id: 'marker', x: 0, y: 0, label: '标记', entityId: 'missing' }], regions: [] }];
    p.attachments = { 'missing-owner': [] };
    p.brainstormEdges = [{ id: 'brain-edge', source: 'missing-a', target: 'missing-b' }];
    p.outlineRows = [{ id: 'row', no: '1', time: '', title: '章节', main: '', cells: { missing: '遗留内容' } }];
    p.arcs = [{ id: 'arc', entityId: 'item', title: '错误弧线', note: '' }];

    const issues = advancedAuditProject(p);
    const codes = new Set(issues.map((issue) => issue.code));

    const expectedCodes = [
      'consistency.entity-field-kind',
      'reference.entity-field',
      'consistency.flow-speaker-kind',
      'reference.flow-edge',
      'reference.document-speaker',
      'consistency.document-pov-kind',
      'consistency.document-location-kind',
      'timeline.character-conflict',
      'reference.map-entity',
      'reference.attachment-owner',
      'reference.brain-edge',
      'reference.outline-column',
      'consistency.arc-entity-kind',
    ];
    expect(expectedCodes.every((code) => codes.has(code))).toBe(true);
    expect(issues.find((issue) => issue.code === 'timeline.character-conflict')?.severity).toBe('warning');
  });

  it('把全项目路径死循环纳入体检', () => {
    const p = project();
    p.flows = [{
      id: 'loop-flow',
      name: '循环流程',
      nodes: [{ id: 'loop-node', type: 'hub', position: { x: 0, y: 0 }, data: { title: '循环', text: '' } }],
      edges: [{ id: 'self', source: 'loop-node', target: 'loop-node' }],
    }];

    const issues = advancedAuditProject(p);
    expect(issues.some((issue) => issue.code === 'path.loop')).toBe(true);
  });
});
