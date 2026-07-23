import { migrateTemplateInstances } from './templates';
import type { DocStatus, EntityKind, FolderModule, Project } from './types';

export interface BatchEditPatch {
  favorite?: boolean;
  folderId?: string | null;
  templateId?: string | null;
  entityKind?: EntityKind;
  documentCategory?: string;
  documentStatus?: DocStatus | null;
  documentRevision?: number | null;
  documentWordTarget?: number | null;
  researchCategory?: string;
  researchPinned?: boolean;
  addTags?: string[];
  removeTags?: string[];
}

const cleanTags = (tags: string[] | undefined) =>
  [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];

const applyTags = (current: string[], add: string[] | undefined, remove: string[] | undefined) => {
  const removed = new Set(cleanTags(remove));
  const next = current.map((tag) => tag.trim()).filter((tag) => tag && !removed.has(tag));
  for (const tag of cleanTags(add)) {
    if (!next.includes(tag) && !removed.has(tag)) next.push(tag);
  }
  return next;
};

const applyCommon = <T extends { favorite?: boolean; folderId?: string }>(item: T, patch: BatchEditPatch) => {
  if (patch.favorite !== undefined) item.favorite = patch.favorite || undefined;
  if (patch.folderId !== undefined) item.folderId = patch.folderId || undefined;
};

export function setObjectFavorites(project: Project, module: FolderModule, ids: string[], favorite: boolean): number {
  return applyBatchEdit(project, module, ids, { favorite });
}

export function applyBatchEdit(project: Project, module: FolderModule, ids: string[], patch: BatchEditPatch): number {
  const wanted = new Set(ids);
  let changed = 0;
  let templateChanged = false;

  if (module === 'flow') {
    for (const item of project.flows) {
      if (!wanted.has(item.id)) continue;
      applyCommon(item, patch);
      changed++;
    }
  } else if (module === 'entity') {
    for (const item of project.entities) {
      if (!wanted.has(item.id)) continue;
      applyCommon(item, patch);
      if (patch.entityKind !== undefined) item.kind = patch.entityKind;
      if (patch.templateId !== undefined) {
        item.templateId = patch.templateId || undefined;
        templateChanged = true;
      }
      changed++;
    }
  } else if (module === 'asset') {
    for (const item of project.assets) {
      if (!wanted.has(item.id)) continue;
      applyCommon(item, patch);
      if (patch.templateId !== undefined) {
        item.templateId = patch.templateId || undefined;
        templateChanged = true;
      }
      if (patch.addTags !== undefined || patch.removeTags !== undefined) {
        item.tags = applyTags(item.tags, patch.addTags, patch.removeTags);
      }
      changed++;
    }
  } else if (module === 'document') {
    const touchDocument = patch.templateId !== undefined
      || patch.documentCategory !== undefined
      || patch.documentStatus !== undefined
      || patch.documentRevision !== undefined
      || patch.documentWordTarget !== undefined;
    for (const item of project.documents) {
      if (!wanted.has(item.id)) continue;
      applyCommon(item, patch);
      if (patch.templateId !== undefined) {
        item.templateId = patch.templateId || undefined;
        templateChanged = true;
      }
      if (patch.documentCategory !== undefined) item.category = patch.documentCategory;
      if (patch.documentStatus !== undefined) item.status = patch.documentStatus || undefined;
      if (patch.documentRevision !== undefined) item.revision = patch.documentRevision || undefined;
      if (patch.documentWordTarget !== undefined) item.wordTarget = patch.documentWordTarget || undefined;
      if (touchDocument) item.updatedAt = Date.now();
      changed++;
    }
  } else {
    for (const item of project.researchCards) {
      if (!wanted.has(item.id)) continue;
      applyCommon(item, patch);
      if (patch.researchCategory !== undefined) item.category = patch.researchCategory;
      if (patch.researchPinned !== undefined) item.pinned = patch.researchPinned;
      if (patch.addTags !== undefined || patch.removeTags !== undefined) {
        item.tags = applyTags(item.tags, patch.addTags, patch.removeTags);
      }
      changed++;
    }
  }

  if (templateChanged) migrateTemplateInstances(project);
  return changed;
}
