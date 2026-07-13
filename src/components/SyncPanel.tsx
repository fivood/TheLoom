import { useState } from 'react';
import { useLoom } from '../store';
import {
  loadSyncConfig, pullProject, pushProject, saveSyncConfig, SyncError, type SyncConfig,
} from '../sync';
import { isTauri } from '../storage';
import Icon from './Icon';

export default function SyncPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<SyncConfig>(loadSyncConfig);
  const [busy, setBusy] = useState<'push' | 'pull' | null>(null);
  const [status, setStatus] = useState('');

  const patch = (p: Partial<SyncConfig>) => {
    const next = { ...cfg, ...p };
    setCfg(next);
    saveSyncConfig(next);
  };

  const ready = cfg.room.trim().length >= 3 && cfg.pass.length >= 4;

  const doPull = async (silent = false) => {
    setBusy('pull');
    setStatus('正在拉取…');
    try {
      const { project, version } = await pullProject(cfg);
      if (!silent && !confirm(`拉取云端版本 v${version}「${project.name}」并替换当前打开的项目?`)) {
        setStatus('已取消');
        setBusy(null);
        return;
      }
      useLoom.getState().replaceProject(project);
      patch({ lastVersion: version, lastSyncAt: Date.now() });
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
      setStatus(`已推送,云端现为 v${version}`);
    } catch (e) {
      if (e instanceof SyncError && e.status === 409) {
        setStatus(`冲突:云端已是 v${e.cloudVersion},比你的基线(v${cfg.lastVersion})新`);
        if (confirm(`云端已有更新版本(v${e.cloudVersion}),可能是同伴推送的。\n\n【确定】拉取云端版本(覆盖你的本地改动)\n【取消】保留本地,稍后自行处理`)) {
          await doPull(true);
        } else if (confirm(`要用你的本地版本强制覆盖云端 v${e.cloudVersion} 吗?\n对方未同步的改动将丢失!`)) {
          patch({ lastVersion: e.cloudVersion ?? cfg.lastVersion });
          const next = { ...cfg, lastVersion: e.cloudVersion ?? cfg.lastVersion };
          try {
            const version = await pushProject(next, useLoom.getState().project);
            patch({ lastVersion: version, lastSyncAt: Date.now() });
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

          <div className="player-tip" style={{ marginTop: 4 }}>
            用法:一人先「推送」创建房间并把房间码和口令告诉同伴;
            同伴填入后「拉取」。之后遵循<b>先拉取、改完就推送</b>的节奏,
            版本冲突时会提示。同一时间仍建议只有一人编辑。
          </div>
        </div>
      </div>
    </div>
  );
}
