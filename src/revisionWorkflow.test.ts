import { describe, expect, it } from 'vitest';
import { sampleProject } from './sample';
import {
  createRevisionTask, normalizeRevisionTasks, revisionChanges, revisionTaskCounts,
  revisionTaskStatus, setRevisionDecision,
} from './revisionWorkflow';

function ids() {
  let index = 0;
  return () => `id-${++index}`;
}

describe('revisionWorkflow', () => {
  it('把相邻删除和新增合并为可逐项决策的差异组', () => {
    const changes = revisionChanges(['a', '旧句', 'c', '删掉'], ['a', '新句', 'c', '补充'], ids());
    expect(changes).toEqual([
      { id: 'id-1', oldText: ['旧句'], newText: ['新句'] },
      { id: 'id-2', oldText: ['删掉'], newText: ['补充'] },
    ]);
  });

  it('从快照与当前正文建立任务并派生完成状态', () => {
    const project = sampleProject();
    const document = project.documents[0];
    const snapshot = {
      id: 'snapshot-1',
      docId: document.id,
      label: '初稿',
      blocks: structuredClone(document.blocks),
      createdAt: 1,
    };
    project.docSnapshots = [snapshot];
    document.blocks[0].text += '新内容';
    const task = createRevisionTask(project, snapshot.id, 100, ids());
    expect(task).not.toBeNull();
    expect(task?.changes).toHaveLength(1);
    expect(revisionTaskStatus(task!)).toBe('open');

    project.revisionTasks = [task!];
    expect(setRevisionDecision(project, task!.id, task!.changes[0].id, 'discuss', 110)).toBe(true);
    expect(revisionTaskStatus(task!)).toBe('discuss');
    expect(setRevisionDecision(project, task!.id, task!.changes[0].id, 'accept', 120)).toBe(true);
    expect(revisionTaskStatus(task!)).toBe('completed');
    expect(revisionTaskCounts(task!)).toEqual({
      total: 1, decided: 1, accept: 1, keep: 0, discuss: 0,
    });
  });

  it('没有差异时不建立任务，迁移时清理孤儿与非法决策', () => {
    const project = sampleProject();
    const document = project.documents[0];
    project.docSnapshots = [{
      id: 'snapshot-same', docId: document.id, label: '相同', blocks: structuredClone(document.blocks), createdAt: 1,
    }];
    expect(createRevisionTask(project, 'snapshot-same')).toBeNull();

    project.revisionTasks = [
      {
        id: 'valid',
        docId: document.id,
        snapshotId: 'removed-snapshot',
        snapshotLabel: '已删快照',
        title: '仍可审阅',
        changes: [{ id: 'change', oldText: ['旧'], newText: ['新'], decision: 'bad' as never }],
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'orphan',
        docId: 'missing',
        snapshotId: 'x',
        snapshotLabel: 'x',
        title: 'x',
        changes: [{ id: 'c', oldText: ['旧'], newText: [] }],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    project.proofreadingIgnores = ['a', 'a', ''];
    normalizeRevisionTasks(project);
    expect(project.revisionTasks).toHaveLength(1);
    expect(project.revisionTasks?.[0].changes[0].decision).toBeUndefined();
    expect(project.proofreadingIgnores).toEqual(['a']);
  });
});
