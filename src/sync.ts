/**
 * 云端房间同步客户端
 *
 * - 口令通过 PBKDF2(12 万次)派生 512 位:前 256 位作为鉴权令牌
 *   (服务端只存其哈希),后 256 位作为 AES-GCM 加密密钥
 * - 项目 JSON 先 gzip 再加密,服务端只见密文——忘记口令数据即不可恢复
 * - 版本号乐观锁:推送携带本地基线版本,云端更新过则 409 冲突
 */
import type { Project } from './types';
import { normalizeProject } from './util';
import { decryptBytes, encryptBytes, fromBase64, gzip, toBase64 } from './crypto';

const CONFIG_KEY = 'theloom-sync-v1';

export interface SyncConfig {
  server: string;      // 空 = 当前站点
  room: string;
  pass: string;
  lastVersion: number; // 本地已同步到的云端版本
  lastSyncAt: number;
}

export function loadSyncConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { server: '', room: '', pass: '', lastVersion: 0, lastSyncAt: 0, ...JSON.parse(raw) };
  } catch { /* 忽略 */ }
  return { server: '', room: '', pass: '', lastVersion: 0, lastSyncAt: 0 };
}

export function saveSyncConfig(cfg: SyncConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

/* ---------- 密钥派生与加解密 ---------- */

interface Keys {
  authToken: string;
  encKey: CryptoKey;
}

const keyCache = new Map<string, Promise<Keys>>();

function deriveKeys(room: string, pass: string): Promise<Keys> {
  const cacheKey = `${room}\0${pass}`;
  if (!keyCache.has(cacheKey)) {
    keyCache.set(cacheKey, (async () => {
      const enc = new TextEncoder();
      const material = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
      const bits = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(`theloom:${room}`), iterations: 120_000, hash: 'SHA-256' },
        material,
        512,
      ));
      const authToken = [...bits.slice(0, 32)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const encKey = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      return { authToken, encKey };
    })());
  }
  return keyCache.get(cacheKey)!;
}

/**
 * 缩略图必须随密文一起走:接力的对端没有本机 IDB 缩略图库,
 * 桌面端更是连回填路径都没有(hydrateAssetThumbs 在 Tauri 下直接 return),
 * 这里剥掉就是对端永久丢失。服务端上限 20MB,缩略图是 256px jpeg,留得下。
 */
async function encryptProject(project: Project, key: CryptoKey): Promise<string> {
  const plain = await gzip(new TextEncoder().encode(JSON.stringify(project)), 'gzip');
  return toBase64(await encryptBytes(plain, key));
}

async function decryptProject(payload: string, key: CryptoKey): Promise<Project> {
  const plain = await decryptBytes(fromBase64(payload), key);
  const json = new TextDecoder().decode(await gzip(plain, 'gunzip'));
  const p = JSON.parse(json) as Project;
  if (!p || p.version !== 1) throw new Error('云端数据格式不正确');
  return normalizeProject(p);
}

/* ---------- API ---------- */

export class SyncError extends Error {
  constructor(message: string, public status: number, public cloudVersion?: number) {
    super(message);
  }
}

function apiUrl(cfg: SyncConfig): string {
  const base = cfg.server.trim().replace(/\/+$/, '') || window.location.origin;
  return `${base}/api/room/${encodeURIComponent(cfg.room.trim())}`;
}

async function parseError(res: Response): Promise<SyncError> {
  let msg = `请求失败(HTTP ${res.status})`;
  let version: number | undefined;
  try {
    const data = await res.json() as { error?: string; version?: number };
    if (data.error) msg = data.error;
    version = data.version;
  } catch { /* 保留默认信息 */ }
  return new SyncError(msg, res.status, version);
}

/** 推送本地项目;返回新的云端版本号 */
export async function pushProject(cfg: SyncConfig, project: Project): Promise<number> {
  const { authToken, encKey } = await deriveKeys(cfg.room.trim(), cfg.pass);
  const payload = await encryptProject(project, encKey);
  const res = await fetch(apiUrl(cfg), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ baseVersion: cfg.lastVersion, payload }),
  });
  if (!res.ok) throw await parseError(res);
  const { version } = await res.json() as { version: number };
  return version;
}

/** 拉取云端项目 */
export async function pullProject(cfg: SyncConfig): Promise<{ project: Project; version: number }> {
  const { authToken, encKey } = await deriveKeys(cfg.room.trim(), cfg.pass);
  const res = await fetch(apiUrl(cfg), {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) throw await parseError(res);
  const { version, payload } = await res.json() as { version: number; payload: string };
  let project: Project;
  try {
    project = await decryptProject(payload, encKey);
  } catch {
    throw new SyncError('解密失败:口令不匹配或数据损坏', 0);
  }
  return { project, version };
}

/* ---------- 离线推送队列(P3) ---------- */

/**
 * 离线 / 断网时推送失败,把「要推的版本」暂存本地,恢复联网后自动补发。
 * 接力式模型下同一时刻只会有一次待补发,队列固定存一份。
 *
 * 存储拆两半:
 *   - 重负载(完整项目 + 配置)进 IndexedDB —— 它和项目本体一样大(还含缩略图),
 *     放 localStorage 会直接吃掉 5MB 配额里的一大块。**不能靠剥缩略图来省** ——
 *     队列里存的就是稍后要推送的内容,剥了等于把缩略图丢给对端。
 *   - 轻量标记(只有 queuedAt)留 localStorage —— store 的初始状态与
 *     refreshSyncState 需要同步判断「有没有待推送」,不能 await。
 *
 * 这里的 IDB 不走 webdb.ts:那边 `webdbAvailable()` 对 Tauri 恒假,
 * 而桌面版的 localStorage 一样有配额,队列同样该进 IDB。
 */
const PENDING_KEY = 'theloom-sync-pending-v1';        // 旧格式:完整负载,仅作读取迁移
const PENDING_MARK_KEY = 'theloom-sync-pending-mark-v1';
const PENDING_DB = 'theloom-sync';
const PENDING_STORE = 'pending';
const PENDING_ID = 'current';

export interface PendingPush {
  cfg: SyncConfig;
  project: Project;
  queuedAt: number;
}

/** 待推送的轻量元信息(同步可读) */
export interface PendingPushMeta {
  queuedAt: number;
}

let pendingDbPromise: Promise<IDBDatabase> | null = null;

function pendingDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB 不可用'));
  pendingDbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(PENDING_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PENDING_STORE)) db.createObjectStore(PENDING_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return pendingDbPromise;
}

function pendingRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readMark(): PendingPushMeta | null {
  try {
    const raw = localStorage.getItem(PENDING_MARK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingPushMeta>;
    return typeof parsed?.queuedAt === 'number' ? { queuedAt: parsed.queuedAt } : null;
  } catch { return null; }
}

function readLegacy(): PendingPush | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingPush>;
    if (!parsed || typeof parsed !== 'object' || !parsed.cfg || !parsed.project) return null;
    return {
      cfg: parsed.cfg as SyncConfig,
      project: parsed.project as Project,
      queuedAt: typeof parsed.queuedAt === 'number' ? parsed.queuedAt : Date.now(),
    };
  } catch { return null; }
}

/**
 * 同步判断有没有待推送。旧格式的完整负载也算数(升级前存下的队列不能凭空消失)。
 */
export function hasPendingPush(): PendingPushMeta | null {
  const mark = readMark();
  if (mark) return mark;
  const legacy = readLegacy();
  return legacy ? { queuedAt: legacy.queuedAt } : null;
}

export async function queuePendingPush(cfg: SyncConfig, project: Project): Promise<void> {
  const payload: PendingPush = { cfg, project, queuedAt: Date.now() };
  try {
    const db = await pendingDb();
    await pendingRequest(
      db.transaction(PENDING_STORE, 'readwrite').objectStore(PENDING_STORE).put(payload, PENDING_ID),
    );
    try { localStorage.setItem(PENDING_MARK_KEY, JSON.stringify({ queuedAt: payload.queuedAt })); } catch { /* 标记写不进也还有 IDB */ }
    // 迁移完成,旧格式的大负载可以让出配额
    try { localStorage.removeItem(PENDING_KEY); } catch { /* 忽略 */ }
  } catch {
    // IDB 不可用(隐私模式等)时退回旧格式,功能不能因此消失
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(payload)); } catch { /* 配额满则放弃 */ }
  }
}

export async function loadPendingPush(): Promise<PendingPush | null> {
  try {
    const db = await pendingDb();
    const v = await pendingRequest(
      db.transaction(PENDING_STORE, 'readonly').objectStore(PENDING_STORE).get(PENDING_ID),
    );
    const p = v as Partial<PendingPush> | undefined;
    if (p && p.cfg && p.project) {
      return {
        cfg: p.cfg as SyncConfig,
        project: p.project as Project,
        queuedAt: typeof p.queuedAt === 'number' ? p.queuedAt : Date.now(),
      };
    }
  } catch { /* 落到旧格式 */ }
  return readLegacy();
}

export async function clearPendingPush(): Promise<void> {
  try {
    const db = await pendingDb();
    await pendingRequest(
      db.transaction(PENDING_STORE, 'readwrite').objectStore(PENDING_STORE).delete(PENDING_ID),
    );
  } catch { /* 忽略 */ }
  try { localStorage.removeItem(PENDING_MARK_KEY); } catch { /* 忽略 */ }
  try { localStorage.removeItem(PENDING_KEY); } catch { /* 忽略 */ }
}

export interface FlushResult {
  ok: boolean;
  version?: number;
  conflict?: boolean;
  message: string;
}

/** 补发队列里的一份推送;成功即清除队列。409 冲突留给用户手动处理。 */
export async function flushPendingPush(): Promise<FlushResult> {
  const pending = await loadPendingPush();
  if (!pending) return { ok: false, message: '没有待推送的版本' };
  try {
    const version = await pushProject(pending.cfg, pending.project);
    await clearPendingPush();
    return { ok: true, version, message: `已补发,云端现为 v${version}` };
  } catch (e) {
    if (e instanceof SyncError && e.status === 409) {
      return { ok: false, conflict: true, message: `云端已是 v${e.cloudVersion},需要手动处理冲突` };
    }
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
