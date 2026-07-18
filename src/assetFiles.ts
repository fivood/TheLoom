/**
 * 资源原文件存储层(R8)
 *
 * 原文件按内容 SHA-256 寻址,同内容天然去重:
 *   桌面文件夹模式 → 项目文件夹 assets/asset-{hash前16位}.{ext},随文件夹迁移仍可用
 *   网页 / 未绑定文件夹 → IndexedDB theloom-assets,按完整 hash 全局共享(跨槽位去重)
 *
 * 字节永不被自动删除:删除 / 替换资源只改项目元数据(保证撤销安全),
 * 孤儿字节由「清理未引用原文件」工具显式列出并确认后回收。
 */
import type { Project } from './types';

export interface AssetFileRef {
  hash?: string;
  ext?: string;
  mime?: string;
}

/* ---------- 哈希与命名 ---------- */

export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/mp4': 'm4a',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'application/pdf': 'pdf', 'application/zip': 'zip', 'text/plain': 'txt',
};

/** 从原始文件名 / mime 推导扩展名(小写、无点、≤8 字符);推不出时回 bin */
export function assetExt(fileName: string, mime: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(fileName);
  if (m) return m[1].toLowerCase();
  return MIME_EXT[mime] ?? 'bin';
}

/** 落盘文件名:asset-{hash前16}.{ext};hash 非法时抛错(不该发生) */
export function assetFileName(hash: string, ext?: string): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`非法资源哈希:${hash}`);
  const safeExt = ext && /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
  return `asset-${hash.slice(0, 16)}.${safeExt}`;
}

/* ---------- base64 ---------- */

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

/* ---------- IndexedDB 后端(网页 / 未绑定文件夹) ---------- */

const DB_NAME = 'theloom-assets';
const STORE = 'blobs';
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
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

async function idbPut(hash: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, hash));
}

async function idbGet(hash: string): Promise<Blob | null> {
  const db = await openDb();
  const v = await idbRequest(db.transaction(STORE, 'readonly').objectStore(STORE).get(hash));
  return v instanceof Blob ? v : null;
}

async function idbKeys(): Promise<string[]> {
  const db = await openDb();
  const keys = await idbRequest(db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys());
  return keys.map(String);
}

async function idbDelete(hashes: string[]): Promise<void> {
  const db = await openDb();
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  for (const h of hashes) await idbRequest(store.delete(h));
}

/* ---------- Tauri 文件夹后端 ---------- */

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/* ---------- 统一 API(folder = null 走 IndexedDB,否则走项目文件夹) ---------- */

/** 写入原文件;同 hash 已存在时后端自行跳过 */
export async function storeAssetFile(folder: string | null, hash: string, ext: string | undefined, blob: Blob): Promise<void> {
  if (folder) {
    await invoke('write_asset_file', { dir: folder, name: assetFileName(hash, ext), content: await blobToBase64(blob) });
  } else {
    await idbPut(hash, blob);
  }
}

/** 读取原文件字节;不存在时返回 null */
export async function loadAssetBlob(folder: string | null, ref: AssetFileRef): Promise<Blob | null> {
  if (!ref.hash) return null;
  try {
    if (folder) {
      const b64 = await invoke<string>('read_asset_file', { dir: folder, name: assetFileName(ref.hash, ref.ext) });
      return base64ToBlob(b64, ref.mime ?? '');
    }
    return await idbGet(ref.hash);
  } catch {
    return null;
  }
}

/** 对象 URL 缓存:同一原文件一个会话内只读一次 */
const urlCache = new Map<string, string>();

export async function getAssetUrl(folder: string | null, ref: AssetFileRef): Promise<string | null> {
  if (!ref.hash) return null;
  const cached = urlCache.get(ref.hash);
  if (cached) return cached;
  const blob = await loadAssetBlob(folder, ref);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(ref.hash, url);
  return url;
}

/** 替换 / 重定位后让旧 URL 失效,下次重新读取 */
export function invalidateAssetUrl(hash: string) {
  const url = urlCache.get(hash);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(hash);
  }
}

export interface StoredAssetFile {
  /** 存储键:桌面 = 文件名 asset-…,网页 = 完整 hash */
  key: string;
  size?: number;
}

/** 列出当前后端已存的原文件 */
export async function listStoredFiles(folder: string | null): Promise<StoredAssetFile[]> {
  if (folder) {
    const files = await invoke<{ name: string; size: number }[]>('list_asset_files', { dir: folder });
    return files.map((f) => ({ key: f.name, size: f.size }));
  }
  return (await idbKeys()).map((key) => ({ key }));
}

/** 判断某资源的原文件是否在已存键集合里 */
export function isAssetStored(ref: AssetFileRef, keys: Set<string>, folder: string | null): boolean {
  if (!ref.hash) return false;
  return folder ? keys.has(assetFileName(ref.hash, ref.ext)) : keys.has(ref.hash);
}

/** 删除一组存储键对应的字节(仅供清理工具显式调用) */
export async function deleteStoredFiles(folder: string | null, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  if (folder) await invoke('delete_asset_files', { dir: folder, names: keys });
  else await idbDelete(keys);
}

/**
 * 孤儿计算(纯函数):已存键中,其哈希片段未出现在任何引用文本里的即孤儿。
 * 引用文本 = 各槽位项目 / 快照 / 恢复点的原始 JSON —— 用子串匹配,
 * 哈希 16 位十六进制起步,误伤概率可忽略,且宁可漏删不可误删。
 */
export function computeOrphans(stored: StoredAssetFile[], referencedTexts: string[]): StoredAssetFile[] {
  return stored.filter((f) => {
    const m = /^asset-([0-9a-f]{16})\./.exec(f.key);
    const fragment = m ? m[1] : f.key;
    return !referencedTexts.some((t) => t.includes(fragment));
  });
}

/** 收集本机所有可能引用资源哈希的文本:一切 theloom-* localStorage 值 + 当前项目 JSON */
export function collectReferencedTexts(currentProject: Project): string[] {
  return [JSON.stringify(currentProject), ...collectLocalStorageTexts()];
}

function collectLocalStorageTexts(): string[] {
  const texts: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('theloom-')) {
      const v = localStorage.getItem(key);
      if (v) texts.push(v);
    }
  }
  return texts;
}

export async function clearProjectBrowserBlobs(project: Project): Promise<number> {
  const referencedTexts = collectLocalStorageTexts();
  const removable = projectBrowserBlobKeysToClear(project, referencedTexts);
  if (removable.length === 0) return 0;
  await idbDelete(removable);
  for (const hash of removable) invalidateAssetUrl(hash);
  return removable.length;
}

export function projectBrowserBlobKeysToClear(project: Project, referencedTexts: string[]): string[] {
  return [...new Set(project.assets.map((asset) => asset.hash).filter((hash): hash is string => !!hash))]
    .filter((hash) => !referencedTexts.some((text) => text.includes(hash)));
}

/** 绑定项目文件夹时:把 IndexedDB 里本项目引用的原文件落盘到 assets/ */
export async function exportBlobsToFolder(project: Project, dir: string): Promise<{ written: number; missing: number }> {
  return transferProjectAssetsToFolder(project, null, dir);
}

export async function transferProjectAssetsToFolder(
  project: Project,
  sourceFolder: string | null,
  dir: string,
): Promise<{ written: number; missing: number }> {
  let written = 0;
  let missing = 0;
  const seen = new Set<string>();
  for (const a of project.assets) {
    if (!a.hash || seen.has(a.hash)) continue;
    seen.add(a.hash);
    const blob = await loadAssetBlob(sourceFolder, a);
    if (!blob) {
      missing++;
      continue;
    }
    await invoke('write_asset_file', { dir, name: assetFileName(a.hash, a.ext), content: await blobToBase64(blob) });
    written++;
  }
  return { written, missing };
}
