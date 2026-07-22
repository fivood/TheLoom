import type { Document, DocumentFolderRole, Folder } from './types';
import { folderPath } from './util';

const DOCUMENT_FOLDER_ROLES = new Set<DocumentFolderRole>(['volume', 'chapter', 'section']);

export function isDocumentFolderRole(value: unknown): value is DocumentFolderRole {
  return typeof value === 'string' && DOCUMENT_FOLDER_ROLES.has(value as DocumentFolderRole);
}

export function documentFolderAncestors(folderId: string | undefined, folders: Folder[]): Folder[] {
  if (!folderId) return [];
  const byId = new Map(folders.filter((folder) => folder.module === 'document').map((folder) => [folder.id, folder]));
  const result: Folder[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}

export function orderedDocumentFolders(folders: Folder[]): Folder[] {
  const source = folders.filter((folder) => folder.module === 'document');
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of source) {
    const parentId = folder.parentId ?? null;
    const list = byParent.get(parentId) ?? [];
    list.push(folder);
    byParent.set(parentId, list);
  }
  const sort = (items: Folder[]) => [...items].sort((a, b) =>
    (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY));
  const result: Folder[] = [];
  const visit = (parentId: string | null, trail: Set<string>) => {
    for (const folder of sort(byParent.get(parentId) ?? [])) {
      if (trail.has(folder.id)) continue;
      result.push(folder);
      visit(folder.id, new Set(trail).add(folder.id));
    }
  };
  visit(null, new Set());
  return result;
}

export function documentSceneLabel(document: Document, folders: Folder[]): string {
  const path = folderPath(document.folderId, folders);
  return path ? `${path} · ${document.name}` : document.name;
}

export function documentChapterFolder(folderId: string | undefined, folders: Folder[]): Folder | undefined {
  const ancestors = documentFolderAncestors(folderId, folders);
  for (let index = ancestors.length - 1; index >= 0; index--) {
    if (ancestors[index].documentRole === 'chapter') return ancestors[index];
  }
  return undefined;
}

export function documentChapterIdentity(document: Document, folders: Folder[]): {
  key: string;
  folderId?: string;
  label: string;
} {
  const validFolders = new Map(folders.filter((folder) => folder.module === 'document').map((folder) => [folder.id, folder]));
  const assigned = document.folderId ? validFolders.get(document.folderId) : undefined;
  const chapter = documentChapterFolder(assigned?.id, folders);
  const groupingFolder = chapter ?? assigned;
  return {
    key: groupingFolder?.id ?? '',
    folderId: groupingFolder?.id,
    label: groupingFolder ? folderPath(groupingFolder.id, folders) : '未分组',
  };
}

export function suggestedDocumentChildRole(parent: Folder | undefined): DocumentFolderRole | undefined {
  if (parent?.documentRole === 'volume') return 'chapter';
  if (parent?.documentRole === 'chapter' || parent?.documentRole === 'section') return 'section';
  return undefined;
}

export interface DocumentStructureIssue {
  code: 'document-structure.folder-parent' | 'document-structure.scene-parent';
  folderId?: string;
  documentId?: string;
  message: string;
}

export function inspectDocumentStructure(documents: Document[], folders: Folder[]): DocumentStructureIssue[] {
  const documentFolders = folders.filter((folder) => folder.module === 'document');
  const byId = new Map(documentFolders.map((folder) => [folder.id, folder]));
  const issues: DocumentStructureIssue[] = [];

  for (const folder of documentFolders) {
    const role = folder.documentRole;
    if (!role) continue;
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    const parentRole = parent?.documentRole;
    const valid = role === 'volume'
      ? !parentRole
      : role === 'chapter'
        ? parentRole === 'volume'
        : parentRole === 'chapter' || parentRole === 'section';
    if (valid) continue;
    const expected = role === 'volume' ? '顶层或普通文件夹' : role === 'chapter' ? '卷' : '章或小节';
    issues.push({
      code: 'document-structure.folder-parent',
      folderId: folder.id,
      message: `「${folder.name}」标记为${role === 'volume' ? '卷' : role === 'chapter' ? '章' : '小节'}，但上级不是${expected}`,
    });
  }

  for (const document of documents) {
    const folder = document.folderId ? byId.get(document.folderId) : undefined;
    if (folder?.documentRole !== 'volume') continue;
    issues.push({
      code: 'document-structure.scene-parent',
      documentId: document.id,
      folderId: folder.id,
      message: `场景「${document.name}」直接放在卷「${folder.name}」下，建议先建立章节`,
    });
  }

  return issues;
}
