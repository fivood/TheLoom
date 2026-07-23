import type {
  Project, RevisionChange, RevisionDecision, RevisionTask,
} from './types';
import { diffLines, docLines } from './revision';

const workflowUid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export type RevisionTaskStatus = 'open' | 'discuss' | 'completed';

export function revisionTaskStatus(task: RevisionTask): RevisionTaskStatus {
  if (task.changes.some((change) => change.decision === 'discuss')) return 'discuss';
  if (task.changes.length > 0 && task.changes.every((change) =>
    change.decision === 'accept' || change.decision === 'keep')) return 'completed';
  return 'open';
}

export function revisionTaskCounts(task: RevisionTask): {
  total: number;
  decided: number;
  accept: number;
  keep: number;
  discuss: number;
} {
  const result = { total: task.changes.length, decided: 0, accept: 0, keep: 0, discuss: 0 };
  for (const change of task.changes) {
    if (!change.decision) continue;
    result.decided++;
    result[change.decision]++;
  }
  return result;
}

export function revisionChanges(
  oldLines: string[],
  newLines: string[],
  idFactory: () => string = workflowUid,
): RevisionChange[] {
  const changes: RevisionChange[] = [];
  let oldText: string[] = [];
  let newText: string[] = [];
  const flush = () => {
    if (oldText.length === 0 && newText.length === 0) return;
    changes.push({ id: idFactory(), oldText, newText });
    oldText = [];
    newText = [];
  };
  for (const op of diffLines(oldLines, newLines)) {
    if (op.type === 'same') {
      flush();
    } else if (op.type === 'del') {
      oldText.push(op.text);
    } else {
      newText.push(op.text);
    }
  }
  flush();
  return changes;
}

export function createRevisionTask(
  project: Project,
  snapshotId: string,
  now = Date.now(),
  idFactory: () => string = workflowUid,
): RevisionTask | null {
  const snapshot = (project.docSnapshots ?? []).find((item) => item.id === snapshotId);
  if (!snapshot) return null;
  const document = project.documents.find((item) => item.id === snapshot.docId);
  if (!document) return null;
  const changes = revisionChanges(
    docLines(snapshot.blocks, project.entities),
    docLines(document.blocks, project.entities),
    idFactory,
  );
  if (changes.length === 0) return null;
  return {
    id: idFactory(),
    docId: document.id,
    snapshotId: snapshot.id,
    snapshotLabel: snapshot.label,
    title: `${document.name} · ${snapshot.label} → 当前正文`,
    changes,
    createdAt: now,
    updatedAt: now,
  };
}

export function setRevisionDecision(
  project: Project,
  taskId: string,
  changeId: string,
  decision: RevisionDecision | undefined,
  now = Date.now(),
): boolean {
  const task = (project.revisionTasks ?? []).find((item) => item.id === taskId);
  const change = task?.changes.find((item) => item.id === changeId);
  if (!task || !change) return false;
  change.decision = decision;
  task.updatedAt = now;
  return true;
}

export function normalizeRevisionTasks(project: Project): void {
  const docIds = new Set(project.documents.map((document) => document.id));
  const taskIds = new Set<string>();
  project.revisionTasks = (project.revisionTasks ?? []).filter((task) => {
    if (!task || typeof task.id !== 'string' || taskIds.has(task.id) || !docIds.has(task.docId)
      || typeof task.snapshotId !== 'string' || typeof task.snapshotLabel !== 'string'
      || typeof task.title !== 'string' || !Array.isArray(task.changes)) return false;
    taskIds.add(task.id);
    const changeIds = new Set<string>();
    task.changes = task.changes.filter((change) => {
      if (!change || typeof change.id !== 'string' || changeIds.has(change.id)
        || !Array.isArray(change.oldText) || !Array.isArray(change.newText)) return false;
      changeIds.add(change.id);
      change.oldText = change.oldText.filter((line) => typeof line === 'string');
      change.newText = change.newText.filter((line) => typeof line === 'string');
      if (!['accept', 'keep', 'discuss'].includes(change.decision ?? '')) delete change.decision;
      return change.oldText.length > 0 || change.newText.length > 0;
    });
    task.createdAt = Number.isFinite(task.createdAt) ? task.createdAt : Date.now();
    task.updatedAt = Number.isFinite(task.updatedAt) ? task.updatedAt : task.createdAt;
    return task.changes.length > 0;
  });
  project.proofreadingIgnores = [...new Set((project.proofreadingIgnores ?? [])
    .filter((id) => typeof id === 'string' && id.length > 0))].slice(-1000);
}
