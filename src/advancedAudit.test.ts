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
      { id: 'event-1', trackId: 'track-1', pointId: 'point', title: '事件一', text: '', entityIds: ['char'], documentIds: ['missing-doc'] },
      { id: 'event-2', trackId: 'track-2', pointId: 'point', title: '事件二', text: '', entityIds: ['char'] },
    ];
    p.maps = [{ id: 'map', name: '地图', markers: [{ id: 'marker', x: 0, y: 0, label: '标记', entityId: 'missing' }], regions: [] }];
    p.attachments = { 'missing-owner': [] };
    p.brainstormEdges = [{ id: 'brain-edge', source: 'missing-a', target: 'missing-b' }];
    p.outlineRows = [{ id: 'row', no: '1', time: '', title: '章节', main: '', cells: { missing: '遗留内容' }, documentId: 'missing-doc' }];
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
      'reference.outline-document',
      'reference.timeline-document',
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

  it('卷章层级错误以警告报告且不改动项目', () => {
    const p = project();
    p.folders = [
      { id: 'chapter', name: '孤立章', module: 'document', documentRole: 'chapter' },
      { id: 'volume', name: '第一卷', module: 'document', documentRole: 'volume' },
    ];
    p.documents = [{
      id: 'scene', name: '直属卷场景', folderId: 'volume', category: '', blocks: [], notes: '', createdAt: 1, updatedAt: 1,
    }];
    const before = structuredClone(p);
    const issues = advancedAuditProject(p).filter((issue) => issue.code.startsWith('document-structure.'));
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(p).toEqual(before);
  });
});

describe('R19-2 跨流程调用的引用完整性', () => {
  const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({
    id, type, position: { x: 0, y: 0 }, data: { title: id, text: '', ...data },
  }) as Project['flows'][number]['nodes'][number];

  it('目标流程与入口不存在时各报一条', () => {
    const p = project();
    p.flows = [
      {
        id: 'main', name: '主线', technicalName: 'main',
        nodes: [
          node('a', 'call', { targetFlow: '不存在' }),
          node('b', 'call', { targetFlow: 'side', targetEntry: '没这个入口' }),
        ],
        edges: [],
      },
      { id: 'side', name: '支线', technicalName: 'side', nodes: [node('s', 'dialogue')], edges: [] },
    ];
    const codes = advancedAuditProject(p).map((i) => i.code);
    expect(codes).toContain('reference.flow-target');
    expect(codes).toContain('reference.flow-entry');
  });

  it('未指定入口且目标有多个起点时警告进入位置不稳定', () => {
    const p = project();
    p.flows = [
      { id: 'main', name: '主线', nodes: [node('a', 'call', { targetFlow: 'side' })], edges: [] },
      {
        id: 'side', name: '支线', technicalName: 'side',
        nodes: [node('s1', 'dialogue'), node('s2', 'dialogue')],
        edges: [],
      },
    ];
    const issue = advancedAuditProject(p).find((i) => i.code === 'consistency.flow-entry-ambiguous');
    expect(issue).toBeTruthy();
    expect(issue!.message).toContain('2 个起点');
  });

  it('跳转节点设了接收返回值、以及多余实参都会警告', () => {
    const p = project();
    p.flows = [
      {
        id: 'main', name: '主线',
        nodes: [node('j', 'jump', {
          targetFlow: 'side', targetEntry: 'go', returnVar: 'x',
          args: [{ name: '没声明的参数', expr: '1' }],
        })],
        edges: [],
      },
      {
        id: 'side', name: '支线', technicalName: 'side',
        entries: [{ key: 'go', nodeId: 's' }],
        nodes: [node('s', 'dialogue')], edges: [],
      },
    ];
    const codes = advancedAuditProject(p).map((i) => i.code);
    expect(codes).toContain('consistency.flow-jump-return');
    expect(codes).toContain('reference.flow-arg');
  });

  it('无人调用的流程里带返回值的 return 会提示;有调用方则不提示', () => {
    const lone = project();
    lone.flows = [{ id: 'f', name: '孤立', nodes: [node('r', 'return', { returnExpr: '1' })], edges: [] }];
    expect(advancedAuditProject(lone).map((i) => i.code)).toContain('consistency.flow-return-unused');

    const called = project();
    called.flows = [
      { id: 'main', name: '主线', nodes: [node('c', 'call', { targetFlow: 'sub' })], edges: [] },
      { id: 'sub', name: '被调', technicalName: 'sub', nodes: [node('r', 'return', { returnExpr: '1' })], edges: [] },
    ];
    expect(advancedAuditProject(called).map((i) => i.code)).not.toContain('consistency.flow-return-unused');
  });
});
