import type { Document, DocumentFolderRole, Folder, Project } from './types';
import { orderedDocumentFolders } from './documentStructure';
import { documentWordCount, uid } from './util';

export interface SplitDocumentResult {
  originalId: string;
  newDocumentId: string;
  movedBlockIds: string[];
  movedAnnotationCount: number;
  retainedReferenceCount: number;
}

export interface DocumentMetadataConflict {
  field: 'category' | 'status' | 'revision' | 'wordTarget' | 'povId' | 'locationId' | 'timeLabel' | 'tension'
    | 'templateId' | 'technicalName' | 'linkedFlowId' | 'fields';
  label: string;
  first: unknown;
  second: unknown;
}

export interface MergeDocumentPreview {
  first: Document;
  second: Document;
  conflicts: DocumentMetadataConflict[];
  migratedReferenceCount: number;
}

const METADATA_FIELDS: Array<{
  field: DocumentMetadataConflict['field'];
  label: string;
}> = [
  { field: 'category', label: '分类' },
  { field: 'status', label: '写作状态' },
  { field: 'revision', label: '修订轮次' },
  { field: 'wordTarget', label: '字数目标' },
  { field: 'povId', label: 'POV 角色' },
  { field: 'locationId', label: '地点' },
  { field: 'timeLabel', label: '故事时间' },
  { field: 'tension', label: '情节张力' },
  { field: 'templateId', label: '命名模板' },
  { field: 'technicalName', label: '技术名' },
  { field: 'linkedFlowId', label: '主关联流程' },
  { field: 'fields', label: '自定义字段' },
];

function orderedSiblings(project: Project, document: Document): Document[] {
  return project.documents
    .filter((candidate) => (candidate.folderId ?? '') === (document.folderId ?? ''))
    .sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY));
}

export function countDocumentReferences(project: Project, documentId: string): number {
  let count = 0;
  const linkedFlows = project.flows.filter((flow) => flow.documentId === documentId);
  count += linkedFlows.length;
  const document = project.documents.find((candidate) => candidate.id === documentId);
  if (document?.linkedFlowId && !linkedFlows.some((flow) => flow.id === document.linkedFlowId)) count++;
  count += project.outlineRows.filter((row) => row.documentId === documentId).length;
  count += project.timelineEvents.filter((event) => event.documentIds?.includes(documentId)).length;
  count += (project.arcs ?? []).filter((stage) => stage.docId === documentId).length;
  for (const foreshadow of project.foreshadows ?? []) {
    count += foreshadow.plants.filter((ref) => ref.docId === documentId).length;
    count += foreshadow.payoffs.filter((ref) => ref.docId === documentId).length;
  }
  return count;
}

export function nextAdjacentDocument(project: Project, documentId: string): Document | undefined {
  const document = project.documents.find((candidate) => candidate.id === documentId);
  if (!document) return undefined;
  const siblings = orderedSiblings(project, document);
  const index = siblings.findIndex((candidate) => candidate.id === documentId);
  return index >= 0 ? siblings[index + 1] : undefined;
}

export function splitDocumentAfterBlock(
  project: Project,
  documentId: string,
  blockId: string,
  newName: string,
  options: { newId?: string; now?: number } = {},
): SplitDocumentResult {
  const document = project.documents.find((candidate) => candidate.id === documentId);
  if (!document) throw new Error('找不到要拆分的场景');
  const splitIndex = document.blocks.findIndex((block) => block.id === blockId);
  if (splitIndex < 0) throw new Error('找不到拆分位置');
  if (splitIndex >= document.blocks.length - 1) throw new Error('最后一个块之后没有可拆分的正文');

  const now = options.now ?? Date.now();
  const newDocumentId = options.newId ?? uid();
  const originalBlocks = document.blocks.slice(0, splitIndex + 1);
  const movedBlocks = document.blocks.slice(splitIndex + 1);
  const originalWords = documentWordCount({ ...document, blocks: originalBlocks });
  const movedWords = documentWordCount({ ...document, blocks: movedBlocks });
  const originalTarget = document.wordTarget;
  const totalWords = originalWords + movedWords;
  const movedRatio = totalWords > 0
    ? movedWords / totalWords
    : movedBlocks.length / document.blocks.length;
  const movedTarget = originalTarget && originalTarget > 1
    ? Math.min(originalTarget - 1, Math.max(1, Math.round(originalTarget * movedRatio)))
    : undefined;
  const retainedTarget = originalTarget && movedTarget
    ? Math.max(1, originalTarget - movedTarget)
    : originalTarget;

  const nextDocument: Document = structuredClone(document);
  nextDocument.id = newDocumentId;
  nextDocument.name = newName.trim() || `${document.name}（后半）`;
  nextDocument.blocks = movedBlocks;
  nextDocument.createdAt = now;
  nextDocument.updatedAt = now;
  nextDocument.wordTarget = movedTarget;
  delete nextDocument.technicalName;
  delete nextDocument.linkedFlowId;
  delete nextDocument.favorite;

  document.blocks = originalBlocks;
  document.updatedAt = now;
  document.wordTarget = retainedTarget;

  const siblings = orderedSiblings(project, document);
  const documentIndex = siblings.findIndex((candidate) => candidate.id === document.id);
  siblings.splice(documentIndex + 1, 0, nextDocument);
  for (const [index, sibling] of siblings.entries()) sibling.order = index;
  project.documents.push(nextDocument);

  const movedBlockIds = new Set(movedBlocks.map((block) => block.id));
  let movedAnnotationCount = 0;
  for (const annotation of project.annotations ?? []) {
    if (annotation.docId !== documentId || !annotation.blockId || !movedBlockIds.has(annotation.blockId)) continue;
    annotation.docId = newDocumentId;
    movedAnnotationCount++;
  }

  return {
    originalId: documentId,
    newDocumentId,
    movedBlockIds: [...movedBlockIds],
    movedAnnotationCount,
    retainedReferenceCount: countDocumentReferences(project, documentId),
  };
}

export function previewDocumentMerge(project: Project, firstId: string, secondId: string): MergeDocumentPreview {
  const first = project.documents.find((document) => document.id === firstId);
  const second = project.documents.find((document) => document.id === secondId);
  if (!first || !second) throw new Error('找不到要合并的场景');
  if (nextAdjacentDocument(project, firstId)?.id !== secondId) throw new Error('只能合并同一文件夹内相邻的场景');
  const conflicts = METADATA_FIELDS
    .filter(({ field }) => JSON.stringify(first[field]) !== JSON.stringify(second[field])
      && second[field] !== undefined && second[field] !== '')
    .map(({ field, label }) => ({ field, label, first: first[field], second: second[field] }));
  return {
    first,
    second,
    conflicts,
    migratedReferenceCount: countDocumentReferences(project, secondId),
  };
}

export function mergeAdjacentDocuments(project: Project, firstId: string, secondId: string, now = Date.now()): void {
  const preview = previewDocumentMerge(project, firstId, secondId);
  const { first, second } = preview;
  first.blocks.push(...second.blocks);
  first.updatedAt = now;
  if (second.notes.trim()) {
    first.notes = [first.notes.trim(), `【合并自 ${second.name}】\n${second.notes.trim()}`].filter(Boolean).join('\n\n');
  }
  if (!first.linkedFlowId && second.linkedFlowId) first.linkedFlowId = second.linkedFlowId;
  if (second.fields?.length) {
    first.fields ??= [];
    const labels = new Set(first.fields.map((field) => field.label));
    first.fields.push(...structuredClone(second.fields.filter((field) => !labels.has(field.label))));
  }

  for (const flow of project.flows) if (flow.documentId === secondId) flow.documentId = firstId;
  for (const row of project.outlineRows) if (row.documentId === secondId) row.documentId = firstId;
  for (const event of project.timelineEvents) {
    if (!event.documentIds?.includes(secondId)) continue;
    event.documentIds = [...new Set(event.documentIds.map((id) => id === secondId ? firstId : id))];
  }
  for (const stage of project.arcs ?? []) if (stage.docId === secondId) stage.docId = firstId;
  for (const foreshadow of project.foreshadows ?? []) {
    for (const ref of [...foreshadow.plants, ...foreshadow.payoffs]) {
      if (ref.docId === secondId) ref.docId = firstId;
    }
  }
  for (const annotation of project.annotations ?? []) if (annotation.docId === secondId) annotation.docId = firstId;
  for (const snapshot of project.docSnapshots ?? []) {
    if (snapshot.docId !== secondId) continue;
    snapshot.docId = firstId;
    snapshot.label = `${second.name} · ${snapshot.label}`;
  }
  for (const task of project.revisionTasks ?? []) {
    if (task.docId !== secondId) continue;
    task.docId = firstId;
    task.title = `${second.name} · ${task.title}`;
  }
  if (project.attachments?.[secondId]) {
    project.attachments[firstId] = [...new Set([
      ...(project.attachments[firstId] ?? []),
      ...project.attachments[secondId],
    ])];
    delete project.attachments[secondId];
  }

  project.documents = project.documents.filter((document) => document.id !== secondId);
  const siblings = orderedSiblings(project, first);
  for (const [index, sibling] of siblings.entries()) sibling.order = index;
}

export function documentIdsInFolder(project: Project, folderId: string): string[] {
  const descendants = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of project.folders) {
      if (folder.module !== 'document' || !folder.parentId || !descendants.has(folder.parentId) || descendants.has(folder.id)) continue;
      descendants.add(folder.id);
      changed = true;
    }
  }
  return project.documents.filter((document) => document.folderId && descendants.has(document.folderId)).map((document) => document.id);
}

export type DocumentNumberingStyle = 'chinese' | 'arabic' | 'none';

function chineseNumber(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value < 10) return digits[value];
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${tens === 1 ? '' : digits[tens]}十${ones ? digits[ones] : ''}`;
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    return `${digits[hundreds]}百${rest === 0 ? '' : rest < 10 ? `零${digits[rest]}` : chineseNumber(rest)}`;
  }
  return String(value);
}

function baseFolderName(folder: Folder): string {
  const unit = folder.documentRole === 'volume' ? '卷' : '章';
  return folder.name
    .replace(new RegExp(`^第[零〇一二三四五六七八九十百千万两\\d\\s]+${unit}\\s*[·.、:：\\-—]?\\s*`), '')
    .trim();
}

function numberedFolderName(folder: Folder, index: number, style: DocumentNumberingStyle): string {
  const base = baseFolderName(folder);
  if (style === 'none') return base || `未命名${folder.documentRole === 'volume' ? '卷' : '章'}`;
  const unit = folder.documentRole === 'volume' ? '卷' : '章';
  const number = style === 'chinese' ? chineseNumber(index) : String(index);
  const prefix = style === 'chinese' ? `第${number}${unit}` : `第 ${number} ${unit}`;
  return base ? `${prefix} · ${base}` : prefix;
}

export function renumberDocumentFolders(project: Project, style: DocumentNumberingStyle): number {
  const folders = project.folders.filter((folder) => folder.module === 'document');
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const ordered = orderedDocumentFolders(folders);
  const volumes = ordered.filter((folder) => folder.documentRole === 'volume');
  let changed = 0;
  for (const [index, folder] of volumes.entries()) {
    const name = numberedFolderName(folder, index + 1, style);
    if (name !== folder.name) {
      folder.name = name;
      changed++;
    }
  }
  const chaptersByVolume = new Map<string, Folder[]>();
  for (const folder of ordered.filter((candidate) => candidate.documentRole === 'chapter')) {
    let current = folder.parentId ? byId.get(folder.parentId) : undefined;
    const seen = new Set<string>();
    while (current && current.documentRole !== 'volume' && !seen.has(current.id)) {
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    const key = current?.id ?? '__root__';
    chaptersByVolume.set(key, [...(chaptersByVolume.get(key) ?? []), folder]);
  }
  for (const chapters of chaptersByVolume.values()) {
    for (const [index, folder] of chapters.entries()) {
      const name = numberedFolderName(folder, index + 1, style);
      if (name !== folder.name) {
        folder.name = name;
        changed++;
      }
    }
  }
  return changed;
}

export function documentStructureScopes(project: Project): Array<Folder & { documentCount: number }> {
  const roles = new Set<DocumentFolderRole>(['volume', 'chapter']);
  return orderedDocumentFolders(project.folders)
    .filter((folder) => folder.module === 'document' && folder.documentRole && roles.has(folder.documentRole))
    .map((folder) => ({ ...folder, documentCount: documentIdsInFolder(project, folder.id).length }));
}
