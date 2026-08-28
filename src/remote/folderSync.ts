import type { Project } from '../types';
import { projectFromFolderFiles, projectToFolderFiles, type FolderFile, type ProjectFiles } from '../storage';
import { getObject, listObjects, putObject, deleteObject, type ListedObject } from './s3';
import type { RemoteConfig } from './remoteSync';

/**
 * 按文件夹格式同步项目 —— 远端存的就是桌面版写在磁盘上的那套结构:
 *
 *   projects/{作品名}/project.json
 *   projects/{作品名}/documents/第一章.md
 *   projects/{作品名}/entities/塞梅尔维斯.md
 *
 * 与原先的「整包加密 project.enc」相比有三个实质区别:
 *
 * 1. **一个作品一个前缀**,不再是全局唯一对象 —— 多部作品可以同时在远端,
 *    手机上能挑着拉,不必每换一本就改一次桶内路径。
 * 2. **明文**。这是为了让同一份文件既能被本工具读,也能被 Obsidian 一类的
 *    工具直接读。代价是桶里不再是密文,安全性退回到「桶凭据本身」——
 *    R2 的桶默认私有,等价于放在网盘私人目录里。
 * 3. **逐文件比对**。改一个场景只上传那一个 .md,冲突也落到文件粒度,
 *    而不是整份项目一起覆盖。
 */

/** 远端一个作品的目录前缀 */
export function projectPrefix(name: string): string {
  return `projects/${name.replace(/[\\/]/g, '_')}/`;
}

/** 用于判断「远端这份是不是我上次推的那份」的指纹表 */
export type FileFingerprints = Record<string, string>;

export interface RemoteProjectEntry {
  /** 作品名(远端目录名) */
  name: string;
  prefix: string;
  fileCount: number;
  bytes: number;
  /** 该作品下最新的对象修改时间 */
  updatedAt: number;
}

/** 把列举结果按作品分组 —— 纯函数,便于测试分组与统计口径 */
export function groupRemoteProjects(objects: ListedObject[]): RemoteProjectEntry[] {
  const byName = new Map<string, RemoteProjectEntry>();
  for (const o of objects) {
    const slash = o.key.indexOf('/');
    if (slash <= 0) continue;
    const name = o.key.slice(0, slash);
    const cur = byName.get(name) ?? { name, prefix: `projects/${name}/`, fileCount: 0, bytes: 0, updatedAt: 0 };
    cur.fileCount++;
    cur.bytes += o.size;
    cur.updatedAt = Math.max(cur.updatedAt, o.lastModified);
    byName.set(name, cur);
  }
  return [...byName.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 逐文件比对出要上传 / 要删除的清单。
 *
 * 用内容指纹而不是 ETag:R2 对分片上传的 ETag 不是 MD5,跨实现也不一致;
 * 而我们本来就要读全部内容才能上传,顺手算个哈希是免费的。
 */
export function planFolderPush(
  files: FolderFile[], local: FileFingerprints, remote: ListedObject[], lastSyncAt = 0,
): { upload: FolderFile[]; remove: string[]; conflicts: string[] } {
  const want = new Set(files.map((f) => f.relPath));
  const remoteAt = new Map(remote.map((o) => [o.key, o.lastModified]));
  const upload = files.filter((f) => local[f.relPath] !== fingerprint(f));
  return {
    upload,
    // 远端有、本次不再产出的 → 删除(改名 / 删场景之后的陈旧文件)
    remove: remote.map((o) => o.key).filter((k) => !want.has(k)),
    /*
     * 冲突:我要覆盖的这个文件,别处在我上次同步之后动过。
     * 逐文件判定比整包宽松得多 —— 只有「两边都改了同一个文件」才算冲突,
     * 各改各的场景不会互相拦。但这层保护不能没有:没有它就是静默覆盖。
     */
    conflicts: lastSyncAt
      ? upload.map((f) => f.relPath).filter((k) => (remoteAt.get(k) ?? 0) > lastSyncAt)
      : [],
  };
}

/** 要覆盖的文件在别处被改过 */
export class FolderConflict extends Error {
  constructor(readonly paths: string[]) {
    super(`远端有 ${paths.length} 个文件在别处改过`);
    this.name = 'FolderConflict';
  }
}

/** 作品还没起名,推上去会和别的同名作品互相覆盖 */
export class UnnamedProject extends Error {
  constructor() {
    super('这部作品还没起名字');
    this.name = 'UnnamedProject';
  }
}

/**
 * 远端按**作品名**分目录 —— 那是跨设备唯一的身份(槽位 id 每台机器都不同,
 * 磁盘目录名手机上根本不存在)。所以没起名的作品不能推:两本都叫「未命名项目」
 * 就会静默覆盖对方,而这是本地磁盘上看不出来的。
 */
export function isPushableName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n !== '未命名项目';
}

/** 内容指纹:同内容同串即可,不需要抗碰撞 */
export function fingerprint(f: FolderFile): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = `${f.base64 ? 'b' : 't'}:${f.content}`;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}:${s.length}`;
}

/** 远端文件清单 → projectFromFolderFiles 需要的形状 */
export function assembleProjectFiles(entries: { path: string; content: string }[]): ProjectFiles {
  const files: ProjectFiles = {
    projectJson: null, recoveredFromBackup: false,
    entities: [], research: [], documents: [], assets: [],
  };
  for (const e of entries) {
    if (e.path === 'project.json') { files.projectJson = e.content; continue; }
    const slash = e.path.indexOf('/');
    if (slash < 0) continue;
    const dir = e.path.slice(0, slash);
    const name = e.path.slice(slash + 1);
    if (dir === 'entities') files.entities.push({ name, content: e.content });
    else if (dir === 'research') files.research.push({ name, content: e.content });
    else if (dir === 'documents') files.documents.push({ name, content: e.content });
    else if (dir === 'assets') files.assets.push({ name, content: e.content });
  }
  return files;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 文本按 UTF-8 存;base64 内容(头像)原样存字符串,读回时不解码 */
function bodyOf(f: FolderFile): Uint8Array {
  return enc.encode(f.content);
}

export interface FolderPushResult {
  uploaded: number;
  skipped: number;
  removed: number;
  fingerprints: FileFingerprints;
}

export async function pushProjectFolder(
  cfg: RemoteConfig, project: Project, known: FileFingerprints,
  opts: { lastSyncAt?: number; force?: boolean } = {},
  onProgress?: (done: number, total: number) => void,
): Promise<FolderPushResult> {
  if (!isPushableName(project.name)) throw new UnnamedProject();
  const prefix = projectPrefix(project.name);
  const { files } = projectToFolderFiles(project);
  const listed = await listObjects(cfg, prefix);
  const plan = planFolderPush(files, known, listed, opts.force ? 0 : opts.lastSyncAt ?? 0);
  if (plan.conflicts.length > 0) throw new FolderConflict(plan.conflicts);

  const total = plan.upload.length + plan.remove.length;
  let done = 0;
  const fingerprints: FileFingerprints = {};
  for (const f of files) fingerprints[f.relPath] = fingerprint(f);

  for (const f of plan.upload) {
    const type = f.relPath.endsWith('.json') ? 'application/json; charset=utf-8'
      : f.relPath.endsWith('.md') ? 'text/markdown; charset=utf-8'
        : 'text/plain; charset=utf-8';
    await putObject(cfg, `${prefix}${f.relPath}`, bodyOf(f), type);
    onProgress?.(++done, total);
  }
  for (const key of plan.remove) {
    await deleteObject(cfg, `${prefix}${key}`);
    onProgress?.(++done, total);
  }
  return { uploaded: plan.upload.length, skipped: files.length - plan.upload.length, removed: plan.remove.length, fingerprints };
}

export interface FolderPullResult {
  project: Project;
  fileCount: number;
  fingerprints: FileFingerprints;
}

/** 同时取多个文件时的并发度:蜂窝网络下逐个等往返会很慢 */
const FETCH_POOL = 8;

export async function pullProjectFolder(
  cfg: RemoteConfig, name: string,
  onProgress?: (done: number, total: number) => void,
): Promise<FolderPullResult | null> {
  const prefix = projectPrefix(name);
  const listed = await listObjects(cfg, prefix);
  const keys = listed.map((o) => o.key).filter((k) => k && !k.endsWith('/') && k !== 'project.json.bak');
  if (keys.length === 0) return null;

  const entries: { path: string; content: string }[] = [];
  let done = 0;
  for (let i = 0; i < keys.length; i += FETCH_POOL) {
    const batch = keys.slice(i, i + FETCH_POOL);
    const got = await Promise.all(batch.map(async (k) => {
      const bytes = await getObject(cfg, `${prefix}${k}`);
      return bytes ? { path: k, content: dec.decode(bytes) } : null;
    }));
    for (const g of got) if (g) entries.push(g);
    done += batch.length;
    onProgress?.(Math.min(done, keys.length), keys.length);
  }

  const loaded = projectFromFolderFiles(assembleProjectFiles(entries));
  const fingerprints: FileFingerprints = {};
  for (const f of projectToFolderFiles(loaded.project).files) fingerprints[f.relPath] = fingerprint(f);
  return { project: loaded.project, fileCount: entries.length, fingerprints };
}

export async function listRemoteProjects(cfg: RemoteConfig): Promise<RemoteProjectEntry[]> {
  return groupRemoteProjects(await listObjects(cfg, 'projects/'));
}

/* ---------- 本机指纹表:记住「上次推上去的是什么」,只传变化的文件 ---------- */

const FP_KEY = (slotId: string) => `theloom-remote-fp-${slotId}`;

export function loadFingerprints(slotId: string): FileFingerprints {
  try {
    const raw = localStorage.getItem(FP_KEY(slotId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as FileFingerprints : {};
  } catch {
    return {};
  }
}

export function saveFingerprints(slotId: string, fp: FileFingerprints): void {
  try {
    localStorage.setItem(FP_KEY(slotId), JSON.stringify(fp));
  } catch { /* 存不下只是下次全量重传,不影响正确性 */ }
}
