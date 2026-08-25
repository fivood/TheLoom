import type { Project } from '../types';
import { assetFileName, loadAssetBlob, storeAssetFile, type AssetFileRef } from '../assetFiles';
import { decryptBytes, encryptBytes } from '../crypto';
import { getObject, headObject, putObject } from './backend';
import type { RemoteConfig } from './remoteSync';

/**
 * 资源原文件同步。这是外链网盘相对云房间的真正增量:
 * 云房间只传文本与缩略图(20MB 上限),原文件进不去;网页端的 IndexedDB
 * 附件因此换台设备就没了。
 *
 * 资源按**内容寻址**存 `assets/{hash}.{ext}` —— 同一份字节永远同一个 key,
 * 天然幂等、天然去重,也就不存在冲突:两台设备上传同一张图是同一个对象。
 * 不需要清单文件,要拉哪些由解密后的 project.assets 直接得出。
 */

/** 已确认带内容哈希的资源引用(referencedAssets 的产物) */
export type HashedAsset = AssetFileRef & { hash: string };

export interface AssetPlan {
  /** 本机有字节、远端还没有的 */
  upload: HashedAsset[];
  /** 项目引用了、本机没有的(需从远端取) */
  download: HashedAsset[];
}

/** 项目里所有有内容哈希的资源(R8 之前的老资源没有 hash,跳过) */
export function referencedAssets(project: Project): HashedAsset[] {
  const seen = new Set<string>();
  const out: HashedAsset[] = [];
  for (const a of project.assets) {
    if (!a.hash || seen.has(a.hash)) continue;
    seen.add(a.hash);
    out.push({ hash: a.hash, ext: a.ext });
  }
  return out;
}

/**
 * 纯逻辑:给定项目引用、本机已存哈希、远端已存哈希,算出要传哪些、要拉哪些。
 * 分开成纯函数是为了能测——真跑一遍要有桶。
 */
export function planAssetSync(
  refs: HashedAsset[], localHashes: Set<string>, remoteHashes: Set<string>,
): AssetPlan {
  return {
    upload: refs.filter((r) => localHashes.has(r.hash) && !remoteHashes.has(r.hash)),
    download: refs.filter((r) => !localHashes.has(r.hash) && remoteHashes.has(r.hash)),
  };
}

function keyOf(ref: HashedAsset): string {
  return `assets/${assetFileName(ref.hash, ref.ext)}`;
}

/** 探明哪些资源远端已有(HEAD 不取正文,只花一个往返)。按批并发:资源多时
 * 串行一个个等往返,蜂窝网络下同步前的等待会非常明显 */
const PROBE_POOL = 8;
export async function probeRemote(cfg: RemoteConfig, refs: HashedAsset[]): Promise<Set<string>> {
  const present = new Set<string>();
  for (let i = 0; i < refs.length; i += PROBE_POOL) {
    const batch = refs.slice(i, i + PROBE_POOL);
    const results = await Promise.all(
      batch.map(async (ref) => ({ hash: ref.hash, ok: await headObject(cfg, keyOf(ref)) })),
    );
    for (const r of results) if (r.ok) present.add(r.hash);
  }
  return present;
}

export interface AssetSyncResult {
  uploaded: number;
  downloaded: number;
  skipped: number;
  failed: { hash: string; reason: string }[];
}

/**
 * 执行同步。单个资源失败不中断整批——一张图坏了不该让整次同步失败,
 * 失败项列出来由用户决定。
 */
export async function syncAssets(
  cfg: RemoteConfig,
  project: Project,
  folder: string | null,
  key: CryptoKey,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<AssetSyncResult> {
  const refs = referencedAssets(project);
  const local = new Set<string>();
  for (const ref of refs) {
    if (await loadAssetBlob(folder, ref)) local.add(ref.hash);
  }
  const remote = await probeRemote(cfg, refs);
  const plan = planAssetSync(refs, local, remote);

  const result: AssetSyncResult = {
    uploaded: 0, downloaded: 0, skipped: refs.length - plan.upload.length - plan.download.length, failed: [],
  };
  const total = plan.upload.length + plan.download.length;
  let done = 0;

  for (const ref of plan.upload) {
    try {
      const blob = await loadAssetBlob(folder, ref);
      if (!blob) { result.skipped++; continue; }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await putObject(cfg, keyOf(ref), await encryptBytes(bytes, key));
      result.uploaded++;
    } catch (e) {
      result.failed.push({ hash: ref.hash, reason: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.(++done, total, '上传资源');
  }

  for (const ref of plan.download) {
    try {
      const bytes = await getObject(cfg, keyOf(ref));
      if (!bytes) { result.skipped++; continue; }
      const plain = await decryptBytes(bytes, key);
      await storeAssetFile(folder, ref.hash, ref.ext, new Blob([plain as BlobPart]));
      result.downloaded++;
    } catch (e) {
      result.failed.push({ hash: ref.hash, reason: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.(++done, total, '下载资源');
  }

  return result;
}
