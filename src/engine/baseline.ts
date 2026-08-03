/**
 * 增量导出基线(R20-1)
 *
 * 基线 = 上一次导出的内容哈希清单,决定「增量包里带哪些对象」。
 * R9 把它放在 localStorage,换机器 / 换浏览器 / 桌面与网页之间基线就对不上,
 * 只能退回全量导出;CLI(R20-3)更是读不到。所以按配置绑定并落到项目文件夹:
 *
 *   桌面绑定文件夹 → 项目文件夹 engine/baseline-{configId}.json,随文件夹迁移
 *   网页 / 未绑定   → localStorage theloom-engine-baseline-{slotId}-{configId}
 *
 * 两种后端都支持显式导出 / 导入 JSON,便于团队之间搬运同一份基线。
 */
import type { EngineBaselineFile } from './package';

export type { EngineBaselineFile };

export const BASELINE_SCHEMA = 'theloom-engine-baseline';

/** R9 的旧键:全项目一份、无配置概念;迁移后删除 */
const legacyKey = (slotId: string) => `theloom-engine-manifest-${slotId}`;
const localKey = (slotId: string, configId: string) => `theloom-engine-baseline-${slotId}-${configId}`;

/** 基线文件名;configId 由 uid() 生成,这里仍做一次白名单过滤防御 */
export function baselineFileName(configId: string): string {
  const safe = configId.replace(/[^A-Za-z0-9_-]/g, '');
  if (!safe) throw new Error(`非法导出配置 id:${configId}`);
  return `baseline-${safe}.json`;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** 校验并规整外部读入的基线(手动导入的文件可能是任意 JSON) */
export function parseBaseline(text: string): EngineBaselineFile | null {
  try {
    const raw = JSON.parse(text) as Partial<EngineBaselineFile>;
    if (!raw || raw.schema !== BASELINE_SCHEMA) return null;
    if (!raw.manifest || typeof raw.manifest !== 'object' || Array.isArray(raw.manifest)) return null;
    const manifest: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.manifest)) {
      if (typeof value === 'string') manifest[key] = value;
    }
    return {
      schema: BASELINE_SCHEMA,
      configId: typeof raw.configId === 'string' ? raw.configId : '',
      configName: typeof raw.configName === 'string' ? raw.configName : '',
      schemaVersion: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : '',
      exportedAt: Number.isFinite(raw.exportedAt) ? Number(raw.exportedAt) : 0,
      manifest,
    };
  } catch {
    return null;
  }
}

export function serializeBaseline(baseline: EngineBaselineFile): string {
  return JSON.stringify(baseline, null, 2);
}

/** 基线来源:界面据此说明「这份基线来自哪里」 */
export type BaselineSource = 'folder' | 'local' | 'legacy' | 'none';

export interface LoadedBaseline {
  baseline: EngineBaselineFile | null;
  source: BaselineSource;
}

/**
 * 读取某个配置的基线。
 * 绑定文件夹时以文件夹内的为准(团队共享的那份);读不到再看本机;
 * 都没有时回落 R9 旧键,让老用户的增量历史不断档。
 */
export async function loadBaseline(
  folder: string | null,
  slotId: string,
  configId: string,
): Promise<LoadedBaseline> {
  if (folder) {
    try {
      const text = await invoke<string | null>('read_engine_file', {
        dir: folder,
        name: baselineFileName(configId),
      });
      if (text) {
        const baseline = parseBaseline(text);
        if (baseline) return { baseline, source: 'folder' };
      }
    } catch { /* 文件夹不可用时回落本机 */ }
  }
  try {
    const raw = localStorage.getItem(localKey(slotId, configId));
    if (raw) {
      const baseline = parseBaseline(raw);
      if (baseline) return { baseline, source: 'local' };
    }
  } catch { /* 忽略 */ }
  const legacy = readLegacyManifest(slotId);
  if (legacy) {
    return {
      baseline: {
        schema: BASELINE_SCHEMA,
        configId,
        configName: '',
        schemaVersion: '',
        exportedAt: 0,
        manifest: legacy,
      },
      source: 'legacy',
    };
  }
  return { baseline: null, source: 'none' };
}

/** 写入基线;绑定文件夹时两边都写,拔掉文件夹也还有本机副本 */
export async function saveBaseline(
  folder: string | null,
  slotId: string,
  baseline: EngineBaselineFile,
): Promise<BaselineSource> {
  let source: BaselineSource = 'local';
  if (folder) {
    try {
      await invoke('write_engine_file', {
        dir: folder,
        name: baselineFileName(baseline.configId),
        content: serializeBaseline(baseline),
      });
      source = 'folder';
    } catch { /* 落盘失败时至少留本机副本 */ }
  }
  try {
    localStorage.setItem(localKey(slotId, baseline.configId), serializeBaseline(baseline));
  } catch { /* 配额不足不阻塞导出 */ }
  // 迁移完成:旧的全项目单份基线不再需要
  try { localStorage.removeItem(legacyKey(slotId)); } catch { /* 忽略 */ }
  return source;
}

/** 删除配置时一并清掉它的基线 */
export async function deleteBaseline(
  folder: string | null,
  slotId: string,
  configId: string,
): Promise<void> {
  if (folder) {
    try {
      await invoke('delete_engine_file', { dir: folder, name: baselineFileName(configId) });
    } catch { /* 忽略 */ }
  }
  try { localStorage.removeItem(localKey(slotId, configId)); } catch { /* 忽略 */ }
}

function readLegacyManifest(slotId: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(legacyKey(slotId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const manifest: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') manifest[key] = value;
    }
    return Object.keys(manifest).length > 0 ? manifest : null;
  } catch {
    return null;
  }
}
