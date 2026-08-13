/**
 * 网页版 IndexedDB 数据层(P2)
 *
 * 权威存储迁移策略:「IndexedDB 权威 + localStorage 镜像」。
 *   写入 → 同步写 localStorage(快路径,沿用现有同步 API)+ 异步写 IDB(权威,不受 5MB 配额限制)
 *   启动 → 先从 IDB 读回较新的项目 / 槽位,镜像回 localStorage 后再走原有同步启动逻辑
 *
 * 仅网页模式生效(isTauri 为真时桌面版走文件夹 / localStorage,不碰 IDB)。
 * 测试环境无 indexedDB 时全部 no-op,现有 localStorage 路径不受影响。
 */
import type { StorageUsage } from './diagnostics';
import { isTauri } from './storage';

const DB_NAME = 'theloom-app';
const STORE = 'kv';
let dbPromise: Promise<IDBDatabase> | null = null;

export function webdbAvailable(): boolean {
  return !isTauri && typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  if (!webdbAvailable()) return Promise.reject(new Error('IndexedDB 不可用'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key: string): Promise<string | null> {
  if (!webdbAvailable()) return null;
  const db = await openDb();
  const v = await idbRequest(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
  return typeof v === 'string' ? v : null;
}

export async function idbSet(key: string, value: string): Promise<void> {
  if (!webdbAvailable()) return;
  const db = await openDb();
  await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key));
}

export async function idbRemove(key: string): Promise<void> {
  if (!webdbAvailable()) return;
  const db = await openDb();
  await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
}

export async function idbKeys(prefix?: string): Promise<string[]> {
  if (!webdbAvailable()) return [];
  const db = await openDb();
  const keys = await idbRequest(db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys());
  const all = keys.map(String);
  return prefix ? all.filter((key) => key.startsWith(prefix)) : all;
}

/** 批量读取指定前缀的全部键值(用于启动镜像) */
export async function idbGetMany(prefix: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of await idbKeys(prefix)) {
    const value = await idbGet(key);
    if (value != null) out[key] = value;
  }
  return out;
}

/* ---------- 项目 JSON 的 IDB 键(与 recovery.ts 的 localStorage 键一致) ---------- */

export const WEB_PROJECT_KEY_PREFIX = 'theloom-project-';

/* ---------- 启动镜像:IDB → localStorage ---------- */

/** 比较两份项目 JSON 的 updatedAt,idbRaw 较新返回 true;解析失败时保守返回 false */
function idbNewerThan(localRaw: string, idbRaw: string): boolean {
  try {
    const localUpdatedAt = (JSON.parse(localRaw) as { updatedAt?: unknown }).updatedAt;
    const idbUpdatedAt = (JSON.parse(idbRaw) as { updatedAt?: unknown }).updatedAt;
    if (typeof localUpdatedAt !== 'number' || !Number.isFinite(localUpdatedAt)) return true;
    if (typeof idbUpdatedAt !== 'number' || !Number.isFinite(idbUpdatedAt)) return false;
    return idbUpdatedAt > localUpdatedAt;
  } catch {
    return false;
  }
}

export interface MirrorResult {
  /** 本次被 IDB 覆盖、且值确实比 localStorage 新的项目键 */
  changedProjectKeys: string[];
  slotsUpdated: boolean;
  currentUpdated: boolean;
  snapshotsUpdated: string[];
  /** 补齐到 localStorage 的其他 theloom-* 键(演出存档 / 断点 / AI 会话 / 引擎基线等) */
  filledKeys: string[];
}

/**
 * 把 IDB 中较新的项目 / 槽位 / 当前指针 / 快照镜像回 localStorage。
 * 只覆盖「IDB 严格更新」的数据,镜像失败(localStorage 配额满)静默跳过,不影响启动。
 */
export async function mirrorIdbToLocal(storage: Storage): Promise<MirrorResult> {
  const result: MirrorResult = { changedProjectKeys: [], slotsUpdated: false, currentUpdated: false, snapshotsUpdated: [], filledKeys: [] };
  if (!webdbAvailable()) return result;

  const projectKeys = await idbKeys(WEB_PROJECT_KEY_PREFIX);
  for (const key of projectKeys) {
    const idbRaw = await idbGet(key);
    if (idbRaw == null) continue;
    const localRaw = storage.getItem(key);
    if (localRaw == null || idbNewerThan(localRaw, idbRaw)) {
      try {
        storage.setItem(key, idbRaw);
        result.changedProjectKeys.push(key);
      } catch { /* 镜像尽力而为 */ }
    }
  }

  const mirrorKey = async (key: string, changed: 'slotsUpdated' | 'currentUpdated') => {
    const idbRaw = await idbGet(key);
    if (idbRaw == null) return;
    const localRaw = storage.getItem(key);
    if (localRaw == null || idbNewerThan(localRaw, idbRaw)) {
      try { storage.setItem(key, idbRaw); result[changed] = true; } catch { /* 忽略 */ }
    }
  };
  await mirrorKey('theloom-slots-v1', 'slotsUpdated');
  await mirrorKey('theloom-current-v1', 'currentUpdated');

  for (const key of await idbKeys('theloom-snapshots-')) {
    const idbRaw = await idbGet(key);
    if (idbRaw == null) continue;
    const localRaw = storage.getItem(key);
    if (localRaw == null || localRaw !== idbRaw) {
      try { storage.setItem(key, idbRaw); result.snapshotsUpdated.push(key); } catch { /* 忽略 */ }
    }
  }

  // 其余 theloom-* 键(演出存档 / 断点 / AI 会话 / 引擎基线等):只在本地缺失时补齐,
  // 不做更新比较,避免用可能过期的 IDB 数据覆盖本地。写入是双写的,正常两者一致。
  const processed = new Set([
    ...projectKeys,
    'theloom-slots-v1',
    'theloom-current-v1',
    ...(await idbKeys('theloom-snapshots-')),
  ]);
  for (const key of await idbKeys('theloom-')) {
    if (processed.has(key)) continue;
    if (storage.getItem(key) != null) continue;
    const idbRaw = await idbGet(key);
    if (idbRaw == null) continue;
    try { storage.setItem(key, idbRaw); result.filledKeys.push(key); } catch { /* 忽略 */ }
  }
  return result;
}

/* ---------- 通用双写辅助(P2b):localStorage 镜像 + IDB 权威 ---------- */

/**
 * 写入一个键:同步写 localStorage + 异步写 IDB。
 * 返回 null = 至少一个后端成功;返回字符串 = 两个后端都失败(描述信息)。
 * 无 IDB 环境(localStorage 为唯一存储)时,localStorage 失败即返回错误,与旧行为一致。
 */
export async function writeThrough(key: string, value: string, storage: Storage): Promise<string | null> {
  let localError: string | null = null;
  try {
    storage.setItem(key, value);
  } catch (error) {
    localError = error instanceof Error ? error.message : String(error);
  }
  if (!webdbAvailable()) return localError;
  try {
    await idbSet(key, value);
  } catch {
    if (localError) return localError;
  }
  return null;
}

/** 删除一个键:同步删 localStorage + 异步删 IDB */
export async function removeThrough(key: string, storage: Storage): Promise<void> {
  try { storage.removeItem(key); } catch { /* 忽略 */ }
  if (!webdbAvailable()) return;
  try { await idbRemove(key); } catch { /* 忽略 */ }
}

/** 读取一个键:优先 IDB(权威),回退 localStorage 镜像 */
export async function readThrough(key: string, storage: Storage): Promise<string | null> {
  if (webdbAvailable()) {
    try {
      const idbRaw = await idbGet(key);
      if (idbRaw != null) return idbRaw;
    } catch { /* 回退 localStorage */ }
  }
  try { return storage.getItem(key); } catch { return null; }
}

/* ---------- 存储用量(纳入 IDB / 浏览器整体配额) ---------- */

export async function estimateWebStorage(localEntries: number): Promise<StorageUsage> {
  if (!webdbAvailable()) return { bytes: 0, entries: localEntries, available: true };
  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage ?? 0;
    const quota = estimate.quota;
    const available = typeof quota === 'number' && quota > 0 ? usage < quota : true;
    return { bytes: usage, entries: localEntries, available };
  } catch {
    return { bytes: 0, entries: localEntries, available: true };
  }
}

/** 申请持久化存储,尽量降低被浏览器在存储压力下清理的风险(iOS 需用户手势后调用) */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!webdbAvailable()) return false;
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* 不支持时忽略 */ }
  return false;
}
