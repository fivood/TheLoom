import { useLoom } from '../store';
import { assetSignature, shouldAutoPush } from './autoRules';
import { toast } from '../toast';
import { useToolBus } from '../toolBus';
import { loadInbox, saveInbox } from '../inbox';
import { syncAssets } from './assetSync';
import {
  RemoteConflict, loadRemoteConfig, pushToRemote, remoteConfigured, remoteKey,
  remoteStatus, saveRemoteConfig, syncInbox,
} from './remoteSync';

/**
 * 自动同步。两条触发:停手一段时间后推,回到窗口时查远端。
 *
 * **只自动推,不自动拉**。推是加内容,冲突有 ETag 挡着;拉是整份替换当前项目,
 * 那必须由人点头 —— 所以查到远端有更新时只弹 toast 提示,替换仍走面板。
 */

/** 停手多久算写完一段 */
const IDLE_MS = 30_000;
let timer: ReturnType<typeof setTimeout> | null = null;
let busy = false;
let lastPushAt = 0;
/** 已经同步过的项目时间戳;拉取后回填,避免刚拉下来又原样推回去 */
let syncedAt = 0;
/** 撞上冲突后暂停自动推送,等用户在面板里处理完再恢复 */
let paused = false;

/** 手动上传 / 拉取成功后调用:登记已同步到哪一版,并解除冲突暂停 */
export function noteSynced(updatedAt: number): void {
  syncedAt = updatedAt;
  paused = false;
}

function openPanel(): void {
  useToolBus.getState().open('remoteSync');
}

async function autoPush(): Promise<void> {
  const cfg = loadRemoteConfig();
  const { project, currentSlotId } = useLoom.getState();
  const ok = shouldAutoPush({
    auto: !!cfg.auto,
    configured: remoteConfigured(cfg),
    busy,
    paused,
    projectUpdatedAt: project.updatedAt,
    syncedAt,
    now: Date.now(),
    lastPushAt,
    boundSlotId: cfg.autoSlotId,
    currentSlotId,
  });
  if (!ok) return;

  busy = true;
  try {
    const res = await pushToRemote(cfg, project);
    const sig = assetSignature(project);
    if (sig !== cfg.assetSig) {
      const key = await remoteKey(cfg);
      await syncAssets(cfg, project, useLoom.getState().folder, key);
    }
    saveInbox(await syncInbox(cfg, loadInbox()));
    // 重新读一次:配置面板可能在上传期间被改过
    saveRemoteConfig({ ...loadRemoteConfig(), lastEtag: res.etag ?? '', lastSyncAt: res.at, assetSig: sig });
    syncedAt = project.updatedAt;
    lastPushAt = Date.now();
  } catch (e) {
    lastPushAt = Date.now();
    if (e instanceof RemoteConflict) {
      paused = true;
      toast('远端有其他设备的更新,自动上传已暂停', { actionLabel: '去处理', onAction: openPanel });
    } else {
      toast(`自动上传失败:${e instanceof Error ? e.message : String(e)}`,
        { actionLabel: '打开同步', onAction: openPanel });
    }
  } finally {
    busy = false;
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void autoPush(); }, IDLE_MS);
}

/** 回到窗口时查一次远端;有更新只提示,替换由用户在面板里决定 */
async function checkRemote(): Promise<void> {
  const cfg = loadRemoteConfig();
  if (!cfg.auto || !remoteConfigured(cfg) || busy) return;
  // 绑的不是当前这本,远端状态与眼前的项目无关,提示只会误导
  if (cfg.autoSlotId && cfg.autoSlotId !== useLoom.getState().currentSlotId) return;
  try {
    const s = await remoteStatus(cfg);
    if (s.changed) {
      toast(`远端有更新(${new Date(s.at).toLocaleString()})`,
        { actionLabel: '去拉取', onAction: openPanel });
    }
  } catch {
    // 离线或令牌过期都会落到这里;静默,推送时再报
  }
}

/** 在 App 挂载时调一次;返回停止函数 */
export function startAutoSync(): () => void {
  syncedAt = useLoom.getState().project.updatedAt;

  const unsub = useLoom.subscribe((s, prev) => {
    if (s?.project && prev?.project && s.project !== prev.project && (s.project.updatedAt ?? 0) > syncedAt) schedule();
  });
  const onVisible = () => { if (document.visibilityState === 'visible') void checkRemote(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  void checkRemote();

  return () => {
    unsub();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    if (timer) clearTimeout(timer);
  };
}
