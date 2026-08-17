import type { Project } from '../types';
import { normalizeProject } from '../util';
import { decryptBytes, deriveAesKey, encryptBytes, gzip } from '../crypto';
import { getObject, headObject, putObject, type S3Config } from './s3';
import { mergeInbox, type IdeaCard } from '../inbox';

/**
 * 外链网盘同步:把整个项目加密后写进用户自己的 S3 兼容存储。
 *
 * 与云房间的区别:数据在**你自己的桶**里,没有 20MB 上限,也不经过本项目的
 * 服务器。口令只在本机派生密钥,桶里只有密文——口令丢了数据同样不可恢复。
 *
 * 冲突判定用 ETag 而不是时间戳:对象存储的 Last-Modified 只精确到秒,
 * 多设备同一秒写入分不出先后;ETag 是内容指纹,变了就是别人写过。
 */

const PROJECT_KEY = 'project.enc';
const CONFIG_KEY = 'theloom-remote-v1';

export interface RemoteConfig extends S3Config {
  /** 端到端加密口令;只存本机,永不上传 */
  pass: string;
  /** 上次同步时远端对象的 ETag,用来判断别人有没有写过 */
  lastEtag: string;
  lastSyncAt: number;
}

export function loadRemoteConfig(): RemoteConfig {
  const blank: RemoteConfig = {
    endpoint: '', region: 'auto', bucket: '', accessKeyId: '', secretAccessKey: '',
    prefix: 'theloom/', pass: '', lastEtag: '', lastSyncAt: 0,
  };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...blank, ...JSON.parse(raw) };
  } catch { /* 忽略 */ }
  return blank;
}

export function saveRemoteConfig(cfg: RemoteConfig): void {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch { /* 忽略 */ }
}

export function remoteConfigured(cfg: RemoteConfig): boolean {
  return !!(cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey && cfg.pass);
}

/** 密钥作用域绑定桶与前缀:同一口令在不同桶派生出不同密钥 */
function keyFor(cfg: RemoteConfig): Promise<CryptoKey> {
  return deriveAesKey(`theloom:${cfg.bucket}/${cfg.prefix ?? ''}`, cfg.pass);
}

export class RemoteConflict extends Error {
  constructor(readonly remoteEtag: string | null, readonly remoteAt: number) {
    super('远端已被其他设备更新');
    this.name = 'RemoteConflict';
  }
}

async function encodeProject(project: Project, key: CryptoKey): Promise<Uint8Array> {
  const plain = await gzip(new TextEncoder().encode(JSON.stringify(project)), 'gzip');
  return encryptBytes(plain, key);
}

async function decodeProject(bytes: Uint8Array, key: CryptoKey): Promise<Project> {
  const plain = await decryptBytes(bytes, key);
  const p = JSON.parse(new TextDecoder().decode(await gzip(plain, 'gunzip'))) as Project;
  if (!p || p.version !== 1) throw new Error('远端数据格式不正确');
  return normalizeProject(p);
}

/**
 * 推送。`force` 为假时先比对 ETag:远端与本地基线不符说明别人写过,抛
 * RemoteConflict 交给用户决定,而不是默默覆盖对方的稿子。
 *
 * 注意:检查与写入之间有几秒窗口,两台设备恰好同时推送仍可能后者覆盖前者。
 * 单人多设备够用;要真正杜绝需要对象存储支持条件写入(If-Match),
 * R2 与 MinIO 支持而并非所有 S3 兼容实现都支持,故未依赖。
 */
export async function pushToRemote(
  cfg: RemoteConfig, project: Project, force = false,
): Promise<{ etag: string | null; at: number }> {
  if (!force && cfg.lastEtag) {
    const head = await headObject(cfg, PROJECT_KEY);
    if (head && head.etag && head.etag !== cfg.lastEtag) {
      throw new RemoteConflict(head.etag, head.lastModified);
    }
  }
  const key = await keyFor(cfg);
  const etag = await putObject(cfg, PROJECT_KEY, await encodeProject(project, key), 'application/octet-stream');
  return { etag, at: Date.now() };
}

/** 拉取;远端还没有项目时返回 null(首次使用不是错误) */
export async function pullFromRemote(
  cfg: RemoteConfig,
): Promise<{ project: Project; etag: string | null; at: number } | null> {
  const bytes = await getObject(cfg, PROJECT_KEY);
  if (!bytes) return null;
  const head = await headObject(cfg, PROJECT_KEY);
  const key = await keyFor(cfg);
  return { project: await decodeProject(bytes, key), etag: head?.etag ?? null, at: Date.now() };
}

/* ---------- 灵感库 ---------- */

const INBOX_KEY = 'inbox.enc';

/**
 * 灵感库同步。与项目不同,这里**不做冲突判定**:收件箱以追加为主,
 * 拉下远端后按 id 取并集合并再写回,两台设备各记各的点子都能留下。
 * 删除靠墓碑传播(见 inbox.ts)。
 */
export async function syncInbox(cfg: RemoteConfig, local: IdeaCard[]): Promise<IdeaCard[]> {
  const key = await keyFor(cfg);
  const bytes = await getObject(cfg, INBOX_KEY);
  let merged = local;
  if (bytes) {
    const plain = await decryptBytes(bytes, key);
    const remote = JSON.parse(new TextDecoder().decode(await gzip(plain, 'gunzip'))) as IdeaCard[];
    if (Array.isArray(remote)) merged = mergeInbox(local, remote);
  }
  const out = await gzip(new TextEncoder().encode(JSON.stringify(merged)), 'gzip');
  await putObject(cfg, INBOX_KEY, await encryptBytes(out, key));
  return merged;
}

/** 远端当前状态,供面板显示「是否有更新」 */
export async function remoteStatus(
  cfg: RemoteConfig,
): Promise<{ exists: boolean; etag: string | null; changed: boolean; at: number }> {
  const head = await headObject(cfg, PROJECT_KEY);
  return {
    exists: !!head,
    etag: head?.etag ?? null,
    changed: !!head && !!head.etag && head.etag !== cfg.lastEtag,
    at: head?.lastModified ?? 0,
  };
}
