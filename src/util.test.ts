import { describe, expect, it } from 'vitest';
import { sampleProject } from './sample';
import type { Project } from './types';
import {
  addAttachment, detachAssetEverywhere, documentWordCount, folderPath, linearizeByFolders,
  normalizeHex, normalizeProject, parsePaletteJson, removeAttachment,
} from './util';

describe('normalizeProject', () => {
  it('补齐旧项目缺失的模块字段', () => {
    const legacy = sampleProject() as unknown as Record<string, unknown>;
    const keys = [
      'flows', 'entities', 'brainstormNotes', 'brainstormEdges', 'outlineColumns', 'outlineRows',
      'timelineTracks', 'timelinePoints', 'timelineEvents', 'maps', 'researchCards',
      'researchCategories', 'variables', 'assets', 'documents',
      'documentCategories', 'attachments', 'folders', 'templates', 'palettes', 'savedQueries',
    ];
    for (const key of keys) delete legacy[key];
    delete legacy.entityTemplates;
    delete legacy.nodeTemplates;

    const project = normalizeProject(legacy as unknown as Project) as unknown as Record<string, unknown>;

    for (const key of keys) expect(project[key]).toBeDefined();
    expect(project.timelineTracks).toEqual([]);
    expect(project.attachments).toEqual({});
    expect(project.templates).toEqual([]);
    expect(project.savedQueries).toEqual([]);
  });

  it('迁移并清理保存查询,保留有效的文件夹条件', () => {
    const project = sampleProject();
    project.folders = [
      { id: 'docs', name: '正文', module: 'document' },
      { id: 'entities', name: '人物', module: 'entity' },
    ];
    project.savedQueries = [
      {
        id: 'valid', name: '  待修订  ', createdAt: 1, updatedAt: 2,
        query: {
          objectType: 'document', text: '雨', folderId: 'docs', attributeName: '', attributeValue: '',
          tags: [' 主线 ', '主线', ''], status: 'revising', references: 'referenced',
        },
      },
      {
        id: 'wrong-folder', name: '错位文件夹', createdAt: 1, updatedAt: 2,
        query: {
          objectType: 'document', text: '', folderId: 'entities', attributeName: '', attributeValue: '',
          tags: [], status: 'any', references: 'any',
        },
      },
      {
        id: 'broken', name: '', createdAt: 1, updatedAt: 2,
        query: {
          objectType: 'all', text: '', folderId: 'any', attributeName: '', attributeValue: '',
          tags: [], status: 'any', references: 'any',
        },
      },
    ];

    normalizeProject(project);

    expect(project.savedQueries).toHaveLength(2);
    expect(project.savedQueries?.[0]).toMatchObject({
      name: '待修订',
      query: { folderId: 'docs', tags: ['主线'], status: 'revising', references: 'referenced' },
    });
    expect(project.savedQueries?.[1].query.folderId).toBe('any');
  });

  it('清理跨模块和不存在的文件夹归属', () => {
    const project = sampleProject();
    project.folders = [
      { id: 'entities', name: '人物', module: 'entity' },
      { id: 'docs', name: '正文', module: 'document' },
      { id: 'broken-parent', name: '孤立', module: 'entity', parentId: 'docs' },
      { id: 'cycle-a', name: '循环 A', module: 'entity', parentId: 'cycle-b' },
      { id: 'cycle-b', name: '循环 B', module: 'entity', parentId: 'cycle-a' },
    ];
    project.entities[0].folderId = 'entities';
    project.entities[1].folderId = 'docs';
    project.documents[0].folderId = 'missing';

    normalizeProject(project);

    expect(project.entities[0].folderId).toBe('entities');
    expect(project.entities[1].folderId).toBeUndefined();
    expect(project.documents[0].folderId).toBeUndefined();
    expect(project.folders[2].parentId).toBeNull();
    expect(project.folders[3].parentId).toBeNull();
  });

  it('规范化 order:非法值剔除,合法数字保留,旧项目无 order 不受影响', () => {
    const project = sampleProject();
    project.folders = [
      { id: 'f1', name: '文件夹1', module: 'entity', order: 2 },
      { id: 'f2', name: '文件夹2', module: 'entity', order: 'oops' as unknown as number },
      { id: 'f3', name: '文件夹3', module: 'entity', order: NaN },
    ];
    project.entities[0].order = 5;
    (project.entities[1] as { order: unknown }).order = 'bad';
    normalizeProject(project);

    expect(project.folders[0].order).toBe(2);
    expect(project.folders[1].order).toBeUndefined();
    expect(project.folders[2].order).toBeUndefined();
    expect(project.entities[0].order).toBe(5);
    expect(project.entities[1].order).toBeUndefined();
    expect(project.entities[2]?.order).toBeUndefined();
  });

  it('R8 资源原文件字段:非法 hash / ext / license 剔除,合法保留', () => {
    const project = sampleProject();
    const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    project.assets = [
      {
        id: 'a1', name: '合法', kind: 'image', mime: 'image/png', size: 1,
        tags: [], source: '', notes: '', createdAt: 1,
        hash, ext: 'png', license: 'CC-BY 4.0',
      },
      {
        id: 'a2', name: '非法', kind: 'audio', mime: 'audio/mpeg', size: 1,
        tags: [], source: '', notes: '', createdAt: 1,
        hash: '不是哈希', ext: '../x' as string, license: 42 as unknown as string,
      },
    ];
    normalizeProject(project);

    expect(project.assets[0].hash).toBe(hash);
    expect(project.assets[0].ext).toBe('png');
    expect(project.assets[0].license).toBe('CC-BY 4.0');
    expect(project.assets[1].hash).toBeUndefined();
    expect(project.assets[1].ext).toBeUndefined();
    expect(project.assets[1].license).toBeUndefined();
  });
});

describe('R2 长篇正文工作台', () => {
  it('normalizeProject 剔除非法场景元数据', () => {
    const project = sampleProject();
    const doc = project.documents[0];
    (doc as { status: unknown }).status = 'nonsense';
    (doc as { wordTarget: unknown }).wordTarget = -3;
    normalizeProject(project);
    expect(doc.status).toBeUndefined();
    expect(doc.wordTarget).toBeUndefined();

    doc.status = 'draft';
    doc.wordTarget = 2000;
    normalizeProject(project);
    expect(doc.status).toBe('draft');
    expect(doc.wordTarget).toBe(2000);
  });

  it('documentWordCount 统计正文 / 表达式 / 选项 / 列表项', () => {
    const doc = {
      id: 'd', name: '', category: '', notes: '', createdAt: 0, updatedAt: 0,
      blocks: [
        { id: 'a', type: 'action', text: '12345' },
        { id: 'b', type: 'condition', text: '', condition: '123' },
        { id: 'c', type: 'choice', text: '12', choices: [{ id: 'x', label: '1234' }] },
        { id: 'e', type: 'list', text: '', items: ['12', '3'] },
      ],
    } as unknown as import('./types').Document;
    expect(documentWordCount(doc)).toBe(5 + 3 + 2 + 4 + 3);
  });

  it('linearizeByFolders 按文件夹树序排列:子文件夹优先、order 稳定', () => {
    const folders: import('./types').Folder[] = [
      { id: 'vol1', name: '第一卷', module: 'document', order: 0 },
      { id: 'vol2', name: '第二卷', module: 'document', order: 1 },
      { id: 'ch1', name: '第一章', module: 'document', parentId: 'vol1', order: 0 },
      { id: 'ch2', name: '第二章', module: 'document', parentId: 'vol1', order: 1 },
      { id: 'other', name: '其他模块', module: 'entity' },
    ];
    const docs = [
      { id: 'root-late', order: 1 },
      { id: 'root-early', order: 0 },
      { id: 's-ch2', folderId: 'ch2' },
      { id: 's-ch1-b', folderId: 'ch1', order: 2 },
      { id: 's-ch1-a', folderId: 'ch1', order: 1 },
      { id: 's-vol1', folderId: 'vol1' },
      { id: 's-vol2', folderId: 'vol2' },
      { id: 's-lost', folderId: 'missing' },
    ];
    const ordered = linearizeByFolders(docs, folders, 'document').map((d) => d.id);
    expect(ordered).toEqual([
      's-ch1-a', 's-ch1-b', 's-ch2', 's-vol1', 's-vol2',
      'root-early', 'root-late', 's-lost',
    ]);
  });

  it('folderPath 拼出卷 · 章路径并容忍循环', () => {
    const folders: import('./types').Folder[] = [
      { id: 'vol1', name: '第一卷', module: 'document' },
      { id: 'ch1', name: '第三章', module: 'document', parentId: 'vol1' },
      { id: 'loop-a', name: 'A', module: 'document', parentId: 'loop-b' },
      { id: 'loop-b', name: 'B', module: 'document', parentId: 'loop-a' },
    ];
    expect(folderPath('ch1', folders)).toBe('第一卷 · 第三章');
    expect(folderPath(undefined, folders)).toBe('');
    expect(folderPath('loop-a', folders)).toBe('B · A');
  });
});

describe('配色导入', () => {
  it('规范化颜色并忽略无效值', () => {
    expect(normalizeHex('ABC')).toBe('#aabbcc');
    expect(normalizeHex('#12ef90')).toBe('#12ef90');
    expect(normalizeHex('not-a-color')).toBeNull();
    expect(parsePaletteJson(JSON.stringify([
      { name: '夜景', colors: ['#123', '445566', 'oops'] },
    ]))).toEqual([{ name: '夜景', colors: ['#112233', '#445566'] }]);
  });
});

describe('附件级联', () => {
  it('避免重复附件并在移除最后一项时清理映射', () => {
    const project = sampleProject();
    project.attachments = {};

    expect(addAttachment(project, 'owner', 'asset-a')).toEqual(['asset-a']);
    expect(addAttachment(project, 'owner', 'asset-a')).toEqual(['asset-a']);
    expect(removeAttachment(project, 'owner', 'asset-a')).toEqual([]);
    expect(project.attachments).toEqual({});
  });

  it('从所有对象引用中级联移除已删除资源', () => {
    const project = sampleProject();
    project.attachments = {
      first: ['asset-a', 'asset-b', 'asset-a'],
      second: ['asset-a'],
      third: ['asset-b'],
    };

    detachAssetEverywhere(project, 'asset-a');

    expect(project.attachments).toEqual({ first: ['asset-b'], third: ['asset-b'] });
  });
});

describe('R14 地图图层与矢量形状 normalize', () => {
  const baseMap = () => ({
    id: 'm1', name: '大陆', markers: [] as any[], regions: [] as any[],
  });

  it('旧地图(无 layers)有 markers 时自动补默认图层', () => {
    const p = sampleProject();
    p.maps = [{ ...baseMap(), markers: [{ id: 'k1', x: 0.5, y: 0.5, label: '灯塔' }] }] as any;
    normalizeProject(p);
    expect(p.maps[0].layers).toHaveLength(1);
    expect(p.maps[0].layers?.[0]).toMatchObject({ name: '默认', visible: true, locked: false, order: 0 });
    expect(p.maps[0].shapes).toEqual([]);
  });

  it('空地图不自动建图层(避免噪声)', () => {
    const p = sampleProject();
    p.maps = [baseMap()] as any;
    normalizeProject(p);
    expect(p.maps[0].layers).toEqual([]);
  });

  it('已有 layers 保留 + 归一化布尔与 order', () => {
    const p = sampleProject();
    p.maps = [{
      ...baseMap(),
      layers: [
        { id: 'L1', name: '地形', visible: false, locked: 1, order: 'x' },
        { id: 'L2', name: '城市' },
      ],
      shapes: [],
    }] as any;
    normalizeProject(p);
    const layers = p.maps[0].layers!;
    expect(layers).toHaveLength(2);
    expect(layers[0]).toMatchObject({ id: 'L1', visible: false, locked: true, order: 0 });
    expect(layers[1]).toMatchObject({ id: 'L2', visible: true, locked: false, order: 1 });
  });

  it('剔除坏形状:未知类型 / 空点 / 未知图层指针', () => {
    const p = sampleProject();
    p.maps = [{
      ...baseMap(),
      layers: [{ id: 'L1', name: '默认', visible: true, locked: false, order: 0 }],
      shapes: [
        { id: 's1', type: 'polyline', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
        { id: 's2', type: 'polyline', points: [] },
        { id: 's3', type: '外星', points: [{ x: 0, y: 0 }] },
        { id: 's4', type: 'rect', points: [{ x: 0.1, y: 0.1 }] },
        { id: 's5', type: 'text', points: [{ x: 0.3, y: 0.3 }], text: '首都', layerId: 'ghost' },
      ],
    }] as any;
    normalizeProject(p);
    const shapes = p.maps[0].shapes!;
    expect(shapes.map((s) => s.id)).toEqual(['s1', 's5']);
    // s5 的 ghost 图层引用被清除(项目此时只有一个图层 L1,清除后归 undefined = 未指定)
    expect(shapes[1].layerId).toBe(undefined);
  });

  it('shapes 有内容但无图层时也自动补默认图层', () => {
    const p = sampleProject();
    p.maps = [{
      ...baseMap(),
      shapes: [{ id: 's1', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
    }] as any;
    normalizeProject(p);
    expect(p.maps[0].layers).toHaveLength(1);
    expect(p.maps[0].shapes).toHaveLength(1);
  });
});
