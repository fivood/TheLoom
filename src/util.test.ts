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
      'researchCategories', 'variables', 'entityTemplates', 'assets', 'documents',
      'documentCategories', 'attachments', 'folders', 'nodeTemplates', 'palettes',
    ];
    for (const key of keys) delete legacy[key];

    const project = normalizeProject(legacy as unknown as Project) as unknown as Record<string, unknown>;

    for (const key of keys) expect(project[key]).toBeDefined();
    expect(project.timelineTracks).toEqual([]);
    expect(project.attachments).toEqual({});
    expect(project.nodeTemplates).toEqual({});
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
