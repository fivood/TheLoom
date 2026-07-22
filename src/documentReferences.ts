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
}
