import type { Project, SubFlow } from './types';
import { findDuplicateTechnicalNames } from './util';
import { parseProjectData } from './recovery';

const ERROR_LOG_KEY = 'theloom-diagnostic-errors-v1';
const ERROR_LOG_LIMIT = 20;
export const LOCAL_STORAGE_ASSUMED_LIMIT_BYTES = 5 * 1024 * 1024;
export const LOCAL_STORAGE_WARNING_BYTES = 4 * 1024 * 1024;

export interface StorageUsage {
  bytes: number;
  entries: number;
  available: boolean;
}

export interface IntegrityIssue {
  kind: string;
  message: string;
}

export interface ImportInspection {
  fileName: string;
  fileBytes: number;
  storageBytes: number;
  project: Project;
  issues: IntegrityIssue[];
}

export interface DiagnosticError {
  createdAt: number;
  source: string;
  message: string;
  stack?: string;
}

export interface DiagnosticContext {
  storage: StorageUsage;
  saveStatus: string;
  saveError: string | null;
  syncError: string | null;
  recoveryCreatedAt: number | null;
  quarantineCreatedAt: number | null;
  isDesktop: boolean;
}

export function getStorageUsage(storage: Storage): StorageUsage {
  try {
    let bytes = 0;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key) continue;
      const value = storage.getItem(key) ?? '';
      bytes += (key.length + value.length) * 2;
    }
    return { bytes, entries: storage.length, available: true };
  } catch {
    return { bytes: 0, entries: 0, available: false };
  }
}

export function inspectProjectIntegrity(project: Project): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const ids = new Map<string, string>();
  const addId = (id: string, kind: string) => {
    if (!id) {
      issues.push({ kind: '缺少 ID', message: `${kind} 没有 ID` });
      return;
    }
    const existing = ids.get(id);
    if (existing) issues.push({ kind: '重复 ID', message: `${kind} 与 ${existing} 使用了同一个 ID` });
    else ids.set(id, kind);
  };

  const walkFlow = (sub: SubFlow, label: string) => {
    const nodeIds = new Set(sub.nodes.map((node) => node.id));
    for (const node of sub.nodes) {
      addId(node.id, `${label}的节点`);
      if (node.data.speakerId && !project.entities.some((entity) => entity.id === node.data.speakerId)) {
        issues.push({ kind: '缺失实体引用', message: `${label}有节点引用了不存在的说话人` });
      }
      if (node.data.sub) walkFlow(node.data.sub, `${label}的子流程`);
    }
    for (const edge of sub.edges) {
      addId(edge.id, `${label}的连线`);
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        issues.push({ kind: '断裂连线', message: `${label}有连线指向不存在的节点` });
      }
    }
  };

  for (const flow of project.flows) {
    addId(flow.id, '流程');
    walkFlow(flow, `流程「${flow.name}」`);
  }
  for (const entity of project.entities) {
    addId(entity.id, '实体');
    for (const field of entity.fields) {
      if (field.type !== 'entity' && field.type !== 'entities') continue;
      const refs = field.type === 'entity' ? [field.value] : field.value.split(',').map((value) => value.trim());
      for (const ref of refs.filter(Boolean)) {
        if (!project.entities.some((candidate) => candidate.id === ref)) {
          issues.push({ kind: '缺失实体引用', message: `实体「${entity.name}」的字段「${field.label}」引用不存在` });
        }
      }
    }
  }
  for (const note of project.brainstormNotes) addId(note.id, '风暴便签');
  for (const edge of project.brainstormEdges) addId(edge.id, '风暴连线');
  for (const column of project.outlineColumns) addId(column.id, '大纲列');
  for (const row of project.outlineRows) addId(row.id, '大纲行');
  for (const track of project.timelineTracks) addId(track.id, '时间线轨道');
  for (const point of project.timelinePoints) addId(point.id, '时间点');
  const trackIds = new Set(project.timelineTracks.map((track) => track.id));
  const pointIds = new Set(project.timelinePoints.map((point) => point.id));
  const entityIds = new Set(project.entities.map((entity) => entity.id));
  for (const event of project.timelineEvents) {
    addId(event.id, '时间线事件');
    if (!trackIds.has(event.trackId) || !pointIds.has(event.pointId)) {
      issues.push({ kind: '缺失时间线引用', message: `事件「${event.title}」缺少轨道或时间点` });
    }
    if (event.entityIds.some((id) => !entityIds.has(id))) {
      issues.push({ kind: '缺失实体引用', message: `事件「${event.title}」引用了不存在的实体` });
    }
  }
  for (const map of project.maps) {
    addId(map.id, '地图');
    for (const marker of map.markers) {
      addId(marker.id, '地图标记');
      if (marker.entityId && !entityIds.has(marker.entityId)) issues.push({ kind: '缺失实体引用', message: `地图「${map.name}」有标记引用不存在的实体` });
      if ((marker.fromPointId && !pointIds.has(marker.fromPointId)) || (marker.toPointId && !pointIds.has(marker.toPointId))) {
        issues.push({ kind: '缺失时间线引用', message: `地图「${map.name}」有标记引用不存在的时间点` });
      }
    }
    for (const region of map.regions) {
      addId(region.id, '地图区域');
      if (region.entityId && !entityIds.has(region.entityId)) issues.push({ kind: '缺失实体引用', message: `地图「${map.name}」有区域引用不存在的实体` });
    }
  }
  for (const card of project.researchCards) addId(card.id, '资料卡');
  for (const variable of project.variables) addId(variable.id, '变量');
  for (const asset of project.assets) addId(asset.id, '资源');
  for (const document of project.documents) {
    addId(document.id, '文档');
    for (const block of document.blocks) {
      addId(block.id, '文档块');
      if (block.speakerId && !entityIds.has(block.speakerId)) issues.push({ kind: '缺失实体引用', message: `文档「${document.name}」有对白引用不存在的说话人` });
      for (const choice of block.choices ?? []) addId(choice.id, '文档选项');
    }
  }
  const folderIds = new Set(project.folders.map((folder) => folder.id));
  for (const folder of project.folders) {
    addId(folder.id, '文件夹');
    if (folder.parentId && !folderIds.has(folder.parentId)) issues.push({ kind: '缺失文件夹引用', message: `文件夹「${folder.name}」的上级不存在` });
  }
  for (const palette of project.palettes ?? []) addId(palette.id, '配色表');
  if (project.activePaletteId && !(project.palettes ?? []).some((palette) => palette.id === project.activePaletteId)) {
    issues.push({ kind: '缺失配色引用', message: '当前启用的配色表不存在' });
  }
  const assetIds = new Set(project.assets.map((asset) => asset.id));
  for (const idsForOwner of Object.values(project.attachments ?? {})) {
    if (idsForOwner.some((id) => !assetIds.has(id))) issues.push({ kind: '悬挂附件', message: '有对象引用了不存在的资源' });
  }
  for (const duplicate of findDuplicateTechnicalNames(project)) {
    issues.push({ kind: '重复技术名', message: `技术名「${duplicate.name}」重复` });
  }
  return issues;
}

export function inspectProjectImport(data: string, fileName: string): ImportInspection {
  const project = parseProjectData(data);
  if (!project) throw new Error('文件不是有效的 TheLoom 项目，或项目结构已经损坏');
  return {
    fileName,
    fileBytes: new TextEncoder().encode(data).byteLength,
    storageBytes: data.length * 2,
    project,
    issues: inspectProjectIntegrity(project),
  };
}

export function readDiagnosticErrors(storage: Storage): DiagnosticError[] {
  try {
    const raw = storage.getItem(ERROR_LOG_KEY);
    const list = raw ? JSON.parse(raw) as DiagnosticError[] : [];
    return Array.isArray(list) ? list.slice(0, ERROR_LOG_LIMIT) : [];
  } catch {
    return [];
  }
}

export function recordDiagnosticError(storage: Storage, source: string, error: unknown, detail = '', now = Date.now()) {
  try {
    const value = error instanceof Error ? error : new Error(String(error));
    const entry: DiagnosticError = {
      createdAt: now,
      source,
      message: value.message.slice(0, 1000),
      stack: `${value.stack ?? ''}${detail ? `\n${detail}` : ''}`.trim().slice(0, 4000) || undefined,
    };
    storage.setItem(ERROR_LOG_KEY, JSON.stringify([entry, ...readDiagnosticErrors(storage)].slice(0, ERROR_LOG_LIMIT)));
  } catch {
    return;
  }
}

export function createDiagnosticReport(project: Project, context: DiagnosticContext) {
  const issues = inspectProjectIntegrity(project);
  const issueCounts = issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.kind] = (counts[issue.kind] ?? 0) + 1;
    return counts;
  }, {});
  return {
    format: 'theloom-diagnostics-v1',
    generatedAt: new Date().toISOString(),
    app: {
      version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown',
      desktop: context.isDesktop,
      userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    },
    project: {
      name: project.name,
      version: project.version,
      updatedAt: project.updatedAt,
      serializedBytes: JSON.stringify(project).length * 2,
      counts: {
        flows: project.flows.length,
        entities: project.entities.length,
        documents: project.documents.length,
        assets: project.assets.length,
        researchCards: project.researchCards.length,
        timelineEvents: project.timelineEvents.length,
      },
      integrityIssueCounts: issueCounts,
    },
    storage: context.storage,
    save: {
      status: context.saveStatus,
      error: context.saveError,
      syncError: context.syncError,
    },
    recovery: {
      backupCreatedAt: context.recoveryCreatedAt,
      quarantineCreatedAt: context.quarantineCreatedAt,
    },
    recentErrors: typeof localStorage === 'undefined' ? [] : readDiagnosticErrors(localStorage),
    privacy: '不包含流程正文、对白、实体字段、资料卡正文或文档正文。',
  };
}

export function downloadDiagnosticReport(project: Project, context: DiagnosticContext) {
  const report = createDiagnosticReport(project, context);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.name || 'theloom'}-diagnostics.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
