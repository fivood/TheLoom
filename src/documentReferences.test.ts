import { describe, expect, it } from 'vitest';
import { unlinkDocumentReferences } from './documentReferences';
import { findDocumentRefs } from './search';
import { longNovelRegressionProject } from './test-fixtures/regressionProjects';
import { normalizeProject } from './util';

describe('R17-2 场景权威引用', () => {
  it('汇总大纲、时间线、流程、弧线和伏笔中的场景引用', () => {
    const project = normalizeProject(longNovelRegressionProject());
    project.flows.push({ id: 'flow-tunnel', name: '隧道流程', documentId: 'doc-tunnel', nodes: [], edges: [] });
    const document = project.documents.find((candidate) => candidate.id === 'doc-tunnel')!;
    const refs = findDocumentRefs(project, document);
    expect(refs.map((ref) => ref.module)).toEqual(['流程', '大纲', '时间线', '规划', '规划']);
    expect(refs.map((ref) => ref.nav.tab)).toEqual(['flow', 'outline', 'timeline', 'planning', 'planning']);
  });

  it('删除场景时只解除引用，保留大纲行、时间线事件和规划条目', () => {
    const project = normalizeProject(longNovelRegressionProject());
    project.flows.push({ id: 'flow-tunnel', name: '隧道流程', documentId: 'doc-tunnel', nodes: [], edges: [] });
    const counts = {
      rows: project.outlineRows.length,
      events: project.timelineEvents.length,
      arcs: (project.arcs ?? []).length,
      foreshadows: (project.foreshadows ?? []).length,
    };
    project.revisionTasks = [{
      id: 'task-tunnel',
      docId: 'doc-tunnel',
      snapshotId: 'snapshot-tunnel',
      snapshotLabel: '初稿',
      title: '隧道修订',
      changes: [{ id: 'change-tunnel', oldText: ['旧'], newText: ['新'] }],
      createdAt: 1,
      updatedAt: 1,
    }];
    unlinkDocumentReferences(project, 'doc-tunnel');
    expect(project.outlineRows).toHaveLength(counts.rows);
    expect(project.timelineEvents).toHaveLength(counts.events);
    expect(project.arcs ?? []).toHaveLength(counts.arcs);
    expect(project.foreshadows ?? []).toHaveLength(counts.foreshadows);
    expect(project.flows.find((flow) => flow.id === 'flow-tunnel')?.documentId).toBeUndefined();
    expect(project.outlineRows[1].documentId).toBeUndefined();
    expect(project.timelineEvents[1].documentIds).toBeUndefined();
    expect(project.arcs?.find((stage) => stage.id === 'arc-lin-2')?.docId).toBeUndefined();
    expect(project.foreshadows?.[0].payoffs).toEqual([]);
    expect(project.revisionTasks).toEqual([]);
  });

  it('迁移时清理失效与重复引用，不从标题推断关联', () => {
    const project = longNovelRegressionProject();
    project.outlineRows.push({
      id: 'legacy-title-only', no: '3', time: '', title: '第三章', main: '', cells: {},
    });
    project.outlineRows[0].chapterFolderId = 'missing-chapter';
    project.outlineRows[1].documentId = 'missing-document';
    project.timelineEvents[0].documentIds = ['doc-locker', 'doc-locker', 'missing-document'];
    normalizeProject(project);
    expect(project.outlineRows[0].chapterFolderId).toBeUndefined();
    expect(project.outlineRows[1].documentId).toBeUndefined();
    expect(project.outlineRows[2]).not.toHaveProperty('documentId');
    expect(project.outlineRows[2]).not.toHaveProperty('chapterFolderId');
    expect(project.timelineEvents[0].documentIds).toEqual(['doc-locker']);
  });
});
