import { useEffect, useState } from 'react';
import { useLoom } from '../store';
import {
  flushPendingPush, hasPendingPush, loadSyncConfig, pullProject,
  pushProject, queuePendingPush, saveSyncConfig, SyncError, type SyncConfig,
} from '../sync';
import { isTauri } from '../storage';
import { confirmDialog } from '../dialog';
import Icon from './Icon';

export default function SyncPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<SyncConfig>(loadSyncConfig);
  const [busy, setBusy] = useState<'push' | 'pull' | 'flush' | null>(null);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(() => hasPendingPush());

  useEffect(() => { setPending(hasPendingPush()); }, []);

  const refresh = () => {
    setPending(hasPendingPush());
    useLoom.getState().refreshSyncState();
  };

  const patch = (p: Partial<SyncConfig>) => {
    const next = { ...cfg, ...p };
    setCfg(next);
    saveSyncConfig(next);
  };

  const ready = cfg.room.trim().length >= 3 && cfg.pass.length >= 4;

  // 云房间只传项目 JSON(正文 / 结构 / 缩略图)。资源原文件按内容寻址存在本机
  // (桌面 assets/ 目录、网页 IndexedDB),不进密文 —— 对端拉取后这些资源会显示「缺失」。
  const assets = useLoom((s) => s.project.assets);
  const originalCount = assets.filter((a) => a.hash).length;

  const doPull = async (silent = false) => {
    setBusy('pull');
    setStatus('正在拉取…');
    try {
      const { project, version } = await pullProject(cfg);
      if (!silent && !await confirmDialog({ message: `拉取云端版本 v${version}「${project.name}」并替换当前打开的项目?` })) {
        setStatus('已取消');
        setBusy(null);
        return;
      }
      useLoom.getState().replaceProject(project);
      patch({ lastVersion: version, lastSyncAt: Date.now() });
      refresh();
      setStatus(`已拉取云端 v${version}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const doPush = async () => {
    setBusy('push');
    setStatus('正在推送…');
    try {
      const version = await pushProject(cfg, useLoom.getState().project);
      patch({ lastVersion: version, lastSyncAt: Date.now() });
      refresh();
      setStatus(`已推送,云端现为 v${version}`);
    } catch (e) {
      if (e instanceof TypeError) {
        // 网络不可用 / 服务器未部署协作接口 → 存进离线队列,恢复联网后自动补发
        const shouldQueue = await confirmDialog({
          message: '网络不可用,推送没有成功。\n\n把当前改动存进「待推送」队列,恢复联网后自动补发?',
          confirmText: '存入队列',
        });
        if (shouldQueue) {
          await queuePendingPush(cfg, useLoom.getState().project);
          refresh();
          setStatus('已存入待推送队列;联网后会自动补发,也可点下方「立即补发」。');
        } else {
          setStatus('未推送(网络不可用)');
        }
      } else if (e instanceof SyncError && e.status === 409) {
        setStatus(`冲突:云端已是 v${e.cloudVersion},比你的基线(v${cfg.lastVersion})新`);
        if (await confirmDialog({ message: `云端已有更新版本(v${e.cloudVersion}),可能是同伴推送的。\n\n【确定】拉取云端版本(覆盖你的本地改动)\n【取消】保留本地,稍后自行处理`, confirmText: '拉取云端' })) {
          await doPull(true);
        } else if (await confirmDialog({ message: `要用你的本地版本强制覆盖云端 v${e.cloudVersion} 吗?\n对方未同步的改动将丢失!`, danger: true, confirmText: '强制覆盖' })) {
          patch({ lastVersion: e.cloudVersion ?? cfg.lastVersion });
          const next = { ...cfg, lastVersion: e.cloudVersion ?? cfg.lastVersion };
          try {
            const version = await pushProject(next, useLoom.getState().project);
            patch({ lastVersion: version, lastSyncAt: Date.now() });
            refresh();
            setStatus(`已强制推送,云端现为 v${version}`);
          } catch (e2) {
            setStatus(e2 instanceof Error ? e2.message : String(e2));
          }
        }
      } else {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(null);
  };

  /** 用给定配置拉取(补发冲突后的跟随拉取) */
  const doPullWith = async (nextCfg: SyncConfig) => {
    try {
      const { project, version } = await pullProject(nextCfg);
      useLoom.getState().replaceProject(project);
      const merged = { ...nextCfg, lastVersion: version, lastSyncAt: Date.now() };
      setCfg(merged);
      saveSyncConfig(merged);
      refresh();
      setStatus(`已拉取云端 v${version}(冲突解决)`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const doFlushPending = async () => {
    if (!pending) return;
    setBusy('flush');
    setStatus('正在补发…');
    try {
      const result = await flushPendingPush();
      if (result.ok) {
        const merged = { ...cfg, lastVersion: result.version ?? cfg.lastVersion, lastSyncAt: Date.now() };
        setCfg(merged);
        saveSyncConfig(merged);
        refresh();
        setStatus(result.message);
      } else if (result.conflict) {
        setStatus(result.message);
        if (await confirmDialog({ message: `${result.message}\n\n拉取云端版本,放弃待补发的本地改动?`, confirmText: '拉取云端' })) {
          await doPullWith(cfg);
        }
      } else {
        setStatus(result.message);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <Icon name="cloud" size={18} />
          <span>协作同步</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          {isTauri || !window.location.origin.startsWith('http') ? (
            <div className="field">
              <label>服务器地址(部署了 TheLoom 的站点)</label>
              <input
                value={cfg.server}
                onChange={(e) => patch({ server: e.target.value })}
                placeholder="https://theloom.pages.dev"
              />
            </div>
          ) : (
            cfg.server !== '' && (
              <div className="field">
                <label>服务器地址(留空 = 当前站点)</label>
                <input value={cfg.server} onChange={(e) => patch({ server: e.target.value })} />
              </div>
            )
          )}
          <div className="field">
            <label>房间码(字母 / 数字 / - / _,和同伴保持一致)</label>
            <input
              value={cfg.room}
              onChange={(e) => patch({ room: e.target.value })}
              placeholder="例如 our-novel-2026"
            />
          </div>
          <div className="field">
            <label>口令(即端到端加密密钥,服务器看不到内容;忘记则无法找回)</label>
            <input
              type="password"
              value={cfg.pass}
              onChange={(e) => patch({ pass: e.target.value })}
              placeholder="至少 4 位,首次推送时确定"
            />
          </div>

          {pending && (
            <div className="sync-pending-box">
              <div>
                <b>待推送队列</b> · 有 1 份离线改动
                <span className="hint" style={{ marginLeft: 6 }}>
                  存于 {new Date(pending.queuedAt).toLocaleString()} · 联网后会自动补发
                </span>
              </div>
              <button className="primary" disabled={busy !== null} onClick={doFlushPending}>
                {busy === 'flush' ? '补发中…' : '立即补发'}
              </button>
            </div>
          )}

          <div className="sync-actions">
            <button className="primary" disabled={!ready || busy !== null} onClick={doPush}>
              <Icon name="upload" /> {busy === 'push' ? '推送中…' : '推送到云端'}
            </button>
            <button disabled={!ready || busy !== null} onClick={() => doPull()}>
              <Icon name="download" /> {busy === 'pull' ? '拉取中…' : '从云端拉取'}
            </button>
          </div>

          <div className="sync-status">
            {cfg.lastVersion > 0 && (
              <div>本地基线:云端 v{cfg.lastVersion}{cfg.lastSyncAt ? ` · ${new Date(cfg.lastSyncAt).toLocaleString()}` : ''}</div>
            )}
            {status && <div className="sync-msg">{status}</div>}
          </div>

          {originalCount > 0 && (
            <div className="player-tip" style={{ marginTop: 4 }}>
              ⚠ 云房间<b>只传项目文本与缩略图</b>,不传资源原文件。
              当前有 <b>{originalCount}</b> 个资源挂着原文件,对端拉取后会显示「缺失」
              (缩略图仍在,可正常预览与排版)。
            </div>
          )}

          <div className="player-tip" style={{ marginTop: 4 }}>
            <b>多设备同步</b>:桌面之间建议改用「文件夹模式」—— 把项目文件夹放进
            OneDrive / Dropbox,正文与 <code>assets/</code> 原文件一并同步,不受 20MB 上限约束。
            云房间更适合把文本推给手机 / 网页版查看与轻量编辑。
            <br />
            用法:先「推送」创建房间,另一台设备填入相同房间码与口令后「拉取」。
            之后遵循<b>先拉取、改完就推送</b>的节奏,版本冲突会提示;同一时间只在一台设备上编辑。
          </div>
        </div>
      </div>
    </div>
  );
}
