import { describe, expect, it } from 'vitest';
import {
  documentIdsInFolder,
  mergeAdjacentDocuments,
  nextAdjacentDocument,
  previewDocumentMerge,
  renumberDocumentFolders,
  splitDocumentAfterBlock,
} from './documentOperations';
import { longNovelRegressionProject } from './test-fixtures/regressionProjects';

describe('R18-1 场景拆分', () => {
  it('按块边界拆分正文，批注随块移动，跨模块引用保留在前场景', () => {
    const project = longNovelRegressionProject();
    const document = project.documents.find((item) => item.id === 'doc-platform')!;
    project.annotations!.push({
      id: 'annotation-moved',
      docId: document.id,
      blockId: 'block-platform-2',
      text: '跟随对白移动',
      createdAt: 70,
    });
    project.flows.push({
      id: 'flow-platform',
      name: '空站台流程',
      documentId: document.id,
      nodes: [],
      edges: [],
    });
    document.linkedFlowId = 'flow-platform';
    document.wordTarget = 1800;

    const result = splitDocumentAfterBlock(project, document.id, 'block-platform-1', '值班员的警告', {
      newId: 'doc-platform-part-2',
      now: 100,
    });
    const second = project.documents.find((item) => item.id === 'doc-platform-part-2')!;

    expect(document.blocks.map((block) => block.id)).toEqual(['block-platform-1']);
    expect(second.blocks.map((block) => block.id)).toEqual(['block-platform-2']);
    expect(second).toMatchObject({
      name: '值班员的警告',
      folderId: document.folderId,
      category: document.category,
      revision: document.revision,
      createdAt: 100,
      updatedAt: 100,
    });
    expect(second.technicalName).toBeUndefined();
    expect(second.linkedFlowId).toBeUndefined();
    expect(project.annotations!.find((item) => item.id === 'annotation-moved')?.docId).toBe(second.id);
    expect(project.flows[0].documentId).toBe(document.id);
    expect(document.wordTarget! + second.wordTarget!).toBe(1800);
    expect(result).toMatchObject({
      newDocumentId: second.id,
      movedBlockIds: ['block-platform-2'],
      movedAnnotationCount: 1,
      retainedReferenceCount: 2,
    });
    expect(nextAdjacentDocument(project, document.id)?.id).toBe(second.id);
  });

  it('拒绝在最后一个块后拆分', () => {
    const project = longNovelRegressionProject();
    expect(() => splitDocumentAfterBlock(project, 'doc-locker', 'block-locker-1', '空场景'))
      .toThrow('最后一个块之后没有可拆分的正文');
  });
});

describe('R18-1 场景合并', () => {
  it('预览元数据冲突并把第二场景的所有引用迁移到第一场景', () => {
    const project = longNovelRegressionProject();
    const first = project.documents.find((item) => item.id === 'doc-platform')!;
    const second = project.documents.find((item) => item.id === 'doc-locker')!;
    first.fields = [{ id: 'field-shared-first', label: '冲突字段', value: '保留前场景' }];
    second.fields = [
      { id: 'field-shared-second', label: '冲突字段', value: '来自后场景' },
      { id: 'field-second-only', label: '新增字段', value: '应迁移' },
    ];
    project.outlineRows[0].documentId = second.id;
    project.flows.push({
      id: 'flow-locker',
      name: '寄存柜流程',
      documentId: second.id,
      nodes: [],
      edges: [],
    });
    second.linkedFlowId = 'flow-locker';
    project.docSnapshots!.push({
      id: 'snapshot-locker',
      docId: second.id,
      label: '第二稿',
      blocks: structuredClone(second.blocks),
      createdAt: 80,
    });
    project.revisionTasks = [{
      id: 'task-locker',
      docId: second.id,
      snapshotId: 'snapshot-locker',
      snapshotLabel: '第二稿',
      title: '寄存柜修订',
      changes: [{ id: 'change-locker', oldText: ['旧'], newText: ['新'] }],
      createdAt: 90,
      updatedAt: 90,
    }];
    project.attachments![second.id] = ['asset-one'];

    const preview = previewDocumentMerge(project, first.id, second.id);
    expect(preview.conflicts.map((conflict) => conflict.field)).toEqual(expect.arrayContaining([
      'status',
      'wordTarget',
      'timeLabel',
      'tension',
      'fields',
    ]));
    expect(preview.migratedReferenceCount).toBe(4);

    mergeAdjacentDocuments(project, first.id, second.id, 200);

    expect(project.documents.some((item) => item.id === second.id)).toBe(false);
    expect(first.blocks.map((block) => block.id)).toEqual([
      'block-platform-1',
      'block-platform-2',
      'block-locker-1',
    ]);
    expect(project.flows.find((flow) => flow.id === 'flow-locker')?.documentId).toBe(first.id);
    expect(project.outlineRows[0].documentId).toBe(first.id);
    expect(project.timelineEvents[0].documentIds).toEqual([first.id]);
    expect(project.foreshadows![0].plants[0].docId).toBe(first.id);
    expect(project.annotations![0].docId).toBe(first.id);
    expect(project.docSnapshots!.find((item) => item.id === 'snapshot-locker')).toMatchObject({
      docId: first.id,
      label: '寄存柜 · 第二稿',
    });
    expect(project.revisionTasks?.[0]).toMatchObject({
      docId: first.id,
      title: '寄存柜 · 寄存柜修订',
    });
    expect(project.attachments![first.id]).toEqual(['asset-one']);
    expect(first.fields).toEqual([
      { id: 'field-shared-first', label: '冲突字段', value: '保留前场景' },
      { id: 'field-second-only', label: '新增字段', value: '应迁移' },
    ]);
    expect(first.status).toBe('done');
  });

  it('拒绝跨章节或非相邻合并', () => {
    const project = longNovelRegressionProject();
    expect(() => previewDocumentMerge(project, 'doc-platform', 'doc-tunnel'))
      .toThrow('只能合并同一文件夹内相邻的场景');
  });
});

describe('R18-1 卷章批量工具', () => {
  it('按卷收集所有后代场景', () => {
    const project = longNovelRegressionProject();
    expect(documentIdsInFolder(project, 'folder-volume-1')).toEqual([
      'doc-platform',
      'doc-locker',
      'doc-tunnel',
    ]);
    expect(documentIdsInFolder(project, 'folder-chapter-1')).toEqual(['doc-platform', 'doc-locker']);
  });

  it('中文、阿拉伯和无编号三种方式可重复切换，章节按卷重新计数', () => {
    const project = longNovelRegressionProject();
    project.folders.push(
      { id: 'folder-volume-2', module: 'document', name: '尾声卷', documentRole: 'volume', order: 1 },
      {
        id: 'folder-chapter-3',
        module: 'document',
        name: '终点',
        documentRole: 'chapter',
        parentId: 'folder-volume-2',
        order: 0,
      },
    );

    renumberDocumentFolders(project, 'chinese');
    expect(project.folders.find((folder) => folder.id === 'folder-volume-1')?.name).toBe('第一卷');
    expect(project.folders.find((folder) => folder.id === 'folder-volume-2')?.name).toBe('第二卷 · 尾声卷');
    expect(project.folders.find((folder) => folder.id === 'folder-chapter-2')?.name).toBe('第二章 · 回声');
    expect(project.folders.find((folder) => folder.id === 'folder-chapter-3')?.name).toBe('第一章 · 终点');

    renumberDocumentFolders(project, 'arabic');
    expect(project.folders.find((folder) => folder.id === 'folder-chapter-2')?.name).toBe('第 2 章 · 回声');

    renumberDocumentFolders(project, 'none');
    expect(project.folders.find((folder) => folder.id === 'folder-chapter-2')?.name).toBe('回声');
    expect(project.folders.find((folder) => folder.id === 'folder-volume-2')?.name).toBe('尾声卷');
    expect(project.folders.find((folder) => folder.id === 'folder-volume-1')?.name).toBe('未命名卷');
  });
});
