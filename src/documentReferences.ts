import type { Project } from './types';

export function unlinkDocumentReferences(project: Project, documentId: string): void {
  for (const flow of project.flows) if (flow.documentId === documentId) flow.documentId = undefined;
  for (const row of project.outlineRows) if (row.documentId === documentId) row.documentId = undefined;
  for (const event of project.timelineEvents) {
    if (event.documentIds) event.documentIds = event.documentIds.filter((id) => id !== documentId);
    if (event.documentIds?.length === 0) delete event.documentIds;
  }
  for (const stage of project.arcs ?? []) if (stage.docId === documentId) stage.docId = undefined;
  for (const foreshadow of project.foreshadows ?? []) {
    foreshadow.plants = foreshadow.plants.filter((ref) => ref.docId !== documentId);
    foreshadow.payoffs = foreshadow.payoffs.filter((ref) => ref.docId !== documentId);
  }
  project.annotations = (project.annotations ?? []).filter((annotation) => annotation.docId !== documentId);
  project.docSnapshots = (project.docSnapshots ?? []).filter((snapshot) => snapshot.docId !== documentId);
  project.revisionTasks = (project.revisionTasks ?? []).filter((task) => task.docId !== documentId);
}

/**
 * 删掉一行大纲时,清掉指向它的台账锚点。
 *
 * commit 不跑 normalizeProject(只有加载时跑),不显式解绑的话,台账上会挂着
 * 一串「(已删除)」直到下次重新打开项目 —— 与删场景走同一条路。
 */
export function unlinkOutlineRowReferences(project: Project, rowId: string): void {
  for (const foreshadow of project.foreshadows ?? []) {
    foreshadow.plants = foreshadow.plants.filter((ref) => ref.rowId !== rowId);
    foreshadow.payoffs = foreshadow.payoffs.filter((ref) => ref.rowId !== rowId);
  }
}
