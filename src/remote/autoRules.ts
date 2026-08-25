import type { Project } from '../types';

/**
 * 自动同步的判定规则。单独成文件是为了能测 —— autoSync 顶层依赖 store,
 * 而 store 一加载就读 localStorage,vitest 的 node 环境里没有。
 */

/** 两次自动推送的最小间隔,避免长时间写作时反复上传 */
export const MIN_GAP_MS = 60_000;

/** 资源指纹:只有资源集合变了才值得跑一遍原文件同步(那要按资源数发 HEAD) */
export function assetSignature(project: Project): string {
  return project.assets.map((a) => a.hash ?? '').join(',');
}

export function shouldAutoPush(s: {
  auto: boolean; configured: boolean; busy: boolean; paused: boolean;
  projectUpdatedAt: number; syncedAt: number; now: number; lastPushAt: number;
  /** 开自动同步时绑定的槽位;远端只存一个项目,换作品自动推会覆盖另一本 */
  boundSlotId?: string; currentSlotId: string;
}): boolean {
  if (!s.auto || !s.configured || s.busy || s.paused) return false;
  if (s.boundSlotId && s.boundSlotId !== s.currentSlotId) return false;
  if (s.projectUpdatedAt <= s.syncedAt) return false;
  return s.now - s.lastPushAt >= MIN_GAP_MS;
}
