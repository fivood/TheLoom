import { useEffect, useState } from 'react';
import { useLoom } from '../store';
import { useToolBus } from '../toolBus';
import { toast } from '../toast';
import { loadRemoteConfig, remoteConfigured } from '../remote/remoteSync';
import { FolderConflict, UnnamedProject } from '../remote/folderSync';
import { pushNow } from '../remote/autoSync';
import Icon from './Icon';

/**
 * 顶栏的一键同步。
 *
 * 同步是高频动作,而原来的入口在「工具菜单 → 外链网盘同步 → 上传本作品」,
 * 三次点击才推得动一次。这里把最常用的那一步提到顶栏:一下就推。
 *
 * **只做推。** 拉取会整份替换当前作品,必须先看清远端是什么、再点头,
 * 那件事仍然走面板 —— 把它做成一键会让「手滑」变成「覆盖今天写的东西」。
 */
export default function SyncButton() {
  const updatedAt = useLoom((s) => s.project.updatedAt);
  const slotId = useLoom((s) => s.currentSlotId);
  const [busy, setBusy] = useState(false);
  /** 推送后配置里的 lastSyncAt 变了,但那不在 store 里,靠这个触发重算 */
  const [tick, setTick] = useState(0);
  const [cfg, setCfg] = useState(loadRemoteConfig);

  useEffect(() => { setCfg(loadRemoteConfig()); }, [updatedAt, slotId, tick]);

  // 没配置就不占位置 —— 顶栏的每一格都是稀缺的
  if (!remoteConfigured(cfg)) return null;

  const boundElsewhere = !!cfg.autoSlotId && cfg.autoSlotId !== slotId;
  const pending = updatedAt > (cfg.lastSyncAt ?? 0);

  const label = busy ? '正在上传…'
    : pending ? '有改动未上传,点击立即上传'
      : cfg.lastSyncAt ? `已同步 · ${new Date(cfg.lastSyncAt).toLocaleTimeString()}`
        : '尚未上传过,点击上传';

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await pushNow();
      toast(r.uploaded === 0 && r.removed === 0
        ? '远端已是最新'
        : `已上传 ${r.uploaded} 个文件${r.removed ? `,删陈旧 ${r.removed}` : ''}`);
    } catch (e) {
      if (e instanceof UnnamedProject) {
        toast('这部作品还没起名字,远端按作品名分目录', {
          actionLabel: '去处理', onAction: () => useToolBus.getState().open('remoteSync'),
        });
      } else if (e instanceof FolderConflict) {
        toast(`有 ${e.paths.length} 个文件在别处改过`, {
          actionLabel: '去处理', onAction: () => useToolBus.getState().open('remoteSync'),
        });
      } else {
        toast(`上传失败:${e instanceof Error ? e.message : String(e)}`, {
          actionLabel: '打开同步', onAction: () => useToolBus.getState().open('remoteSync'),
        });
      }
    }
    setBusy(false);
    setTick((n) => n + 1);
  };

  return (
    <button
      className={`ghost icon-btn sync-btn${pending ? ' pending' : ''}${busy ? ' busy' : ''}`}
      title={boundElsewhere ? `${label}(自动同步绑的是另一部作品)` : label}
      aria-label={label}
      disabled={busy}
      onClick={run}
      onContextMenu={(e) => { e.preventDefault(); useToolBus.getState().open('remoteSync'); }}
    >
      <Icon name="cloud" size={15} />
      {pending && !busy && <span className="sync-dot" aria-hidden="true" />}
    </button>
  );
}
