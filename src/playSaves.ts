import type { VarValue } from './script';

/**
 * R7 演出运行态的本机存储:存档 / 读档 + 节点断点。
 * 属于调试工具状态,只存本机 localStorage,不写入项目、不参与云同步。
 */

export interface SavedBeat {
  id: string;
  kind: string;
  title: string;
  text: string;
  speakerId?: string;
  note?: string;
}

export interface PlaySave {
  at: number;
  seed: number;
  /** 已消耗的随机数个数(恢复时快进 RNG) */
  rolls: number;
  vars: Record<string, VarValue>;
  seen: string[];
  taken: string[];
  checks: [string, boolean][];
  entityProps: Record<string, Record<string, VarValue>>;
  curPath: string[];
  choices: { label: string; nodeId: string | null; edgeId?: string; effect?: string; once?: boolean }[];
  ended: boolean;
  log: SavedBeat[];
}

const savesKey = (slotId: string) => `theloom-plays-${slotId}`;
const bpKey = (slotId: string) => `theloom-breakpoints-${slotId}`;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* 忽略 */ }
  return null;
}

export function loadPlaySave(slotId: string, flowId: string): PlaySave | null {
  return readJson<Record<string, PlaySave>>(savesKey(slotId))?.[flowId] ?? null;
}

export function storePlaySave(slotId: string, flowId: string, save: PlaySave): string | null {
  try {
    const all = readJson<Record<string, PlaySave>>(savesKey(slotId)) ?? {};
    all[flowId] = save;
    localStorage.setItem(savesKey(slotId), JSON.stringify(all));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function clearPlaySave(slotId: string, flowId: string) {
  try {
    const all = readJson<Record<string, PlaySave>>(savesKey(slotId)) ?? {};
    delete all[flowId];
    localStorage.setItem(savesKey(slotId), JSON.stringify(all));
  } catch { /* 忽略 */ }
}

export function loadBreakpoints(slotId: string, flowId: string): Set<string> {
  return new Set(readJson<Record<string, string[]>>(bpKey(slotId))?.[flowId] ?? []);
}

export function toggleBreakpoint(slotId: string, flowId: string, nodeId: string): Set<string> {
  const set = loadBreakpoints(slotId, flowId);
  if (set.has(nodeId)) set.delete(nodeId);
  else set.add(nodeId);
  try {
    const all = readJson<Record<string, string[]>>(bpKey(slotId)) ?? {};
    if (set.size) all[flowId] = [...set];
    else delete all[flowId];
    localStorage.setItem(bpKey(slotId), JSON.stringify(all));
  } catch { /* 忽略 */ }
  return set;
}
