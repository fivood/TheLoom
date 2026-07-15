import type { Project } from './types';
import { normalizeProject } from './util';

const RECOVERY_PREFIX = 'theloom-recovery-v1-';
const QUARANTINE_PREFIX = 'theloom-corrupt-v1-';
export const AUTO_BACKUP_INTERVAL_MS = 10 * 60 * 1000;

export const storedProjectKey = (slotId: string) => `theloom-project-${slotId}`;
const recoveryKey = (slotId: string) => `${RECOVERY_PREFIX}${slotId}`;
const quarantineKey = (slotId: string) => `${QUARANTINE_PREFIX}${slotId}`;

export interface RecoveryBackup {
  createdAt: number;
  data: string;
}

export interface ProjectReadResult {
  project: Project | null;
  backup: RecoveryBackup | null;
  quarantine: RecoveryBackup | null;
  recovered: boolean;
  notice: string | null;
}

export interface ProjectSaveResult {
  backup: RecoveryBackup | null;
  backupError: string | null;
}

const ARRAY_FIELDS = [
  'flows', 'entities', 'brainstormNotes', 'brainstormEdges', 'outlineColumns', 'outlineRows',
  'timelineTracks', 'timelinePoints', 'timelineEvents', 'maps', 'researchCards',
  'researchCategories', 'variables', 'assets', 'documents', 'documentCategories', 'folders',
] as const;

export function parseProjectData(data: string): Project | null {
  try {
    const project = JSON.parse(data) as Project;
    if (!project || typeof project !== 'object' || project.version !== 1) return null;
    normalizeProject(project);
    if (ARRAY_FIELDS.some((field) => !Array.isArray(project[field]))) return null;
    if (typeof project.name !== 'string' || typeof project.updatedAt !== 'number') return null;
    return project;
  } catch {
    return null;
  }
}

function readBackupAt(storage: Storage, key: string): RecoveryBackup | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const backup = JSON.parse(raw) as RecoveryBackup;
    if (!backup || typeof backup.createdAt !== 'number' || typeof backup.data !== 'string') return null;
    return backup;
  } catch {
    return null;
  }
}

export function readRecoveryBackup(storage: Storage, slotId: string): RecoveryBackup | null {
  const backup = readBackupAt(storage, recoveryKey(slotId));
  return backup && parseProjectData(backup.data) ? backup : null;
}

export function readQuarantinedProject(storage: Storage, slotId: string): RecoveryBackup | null {
  return readBackupAt(storage, quarantineKey(slotId));
}

export function readProjectWithRecovery(storage: Storage, slotId: string, now = Date.now()): ProjectReadResult {
  const backup = readRecoveryBackup(storage, slotId);
  const existingQuarantine = readQuarantinedProject(storage, slotId);
  const raw = storage.getItem(storedProjectKey(slotId));
  if (!raw) {
    return { project: null, backup, quarantine: existingQuarantine, recovered: false, notice: null };
  }

  const project = parseProjectData(raw);
  if (project) {
    return { project, backup, quarantine: existingQuarantine, recovered: false, notice: null };
  }

  const quarantine: RecoveryBackup = { createdAt: now, data: raw };
  try {
    storage.setItem(quarantineKey(slotId), JSON.stringify(quarantine));
  } catch {
    quarantine.data = '';
  }
  const recoveredProject = backup ? parseProjectData(backup.data) : null;
  return {
    project: recoveredProject,
    backup,
    quarantine: quarantine.data ? quarantine : existingQuarantine,
    recovered: !!recoveredProject,
    notice: recoveredProject
      ? '当前存档无法读取，已临时载入最近的自动恢复点。请检查后保存。'
      : '当前存档无法读取，也没有可用的自动恢复点。已打开空白项目。',
  };
}

export function saveProjectWithRecovery(
  storage: Storage,
  slotId: string,
  project: Project,
  now = Date.now(),
): ProjectSaveResult {
  const key = storedProjectKey(slotId);
  const next = JSON.stringify(project);
  const previous = storage.getItem(key);
  let backup = readRecoveryBackup(storage, slotId);
  let backupError: string | null = null;

  if (
    previous && previous !== next && parseProjectData(previous)
    && (!backup || now - backup.createdAt >= AUTO_BACKUP_INTERVAL_MS)
  ) {
    const candidate: RecoveryBackup = { createdAt: now, data: previous };
    try {
      storage.setItem(recoveryKey(slotId), JSON.stringify(candidate));
      backup = candidate;
    } catch (error) {
      backupError = error instanceof Error ? error.message : String(error);
    }
  }

  storage.setItem(key, next);
  return { backup, backupError };
}

export function clearProjectRecovery(storage: Storage, slotId: string) {
  storage.removeItem(recoveryKey(slotId));
  storage.removeItem(quarantineKey(slotId));
}

export function clearQuarantinedProject(storage: Storage, slotId: string) {
  storage.removeItem(quarantineKey(slotId));
}
