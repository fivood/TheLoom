import { useState } from 'react';
import { useLoom } from '../store';
import { confirmDialog } from '../dialog';
import { deriveAesKey } from '../crypto';
import { testConnection } from '../remote/s3';
import {
  RemoteConflict, loadRemoteConfig, pullFromRemote, pushToRemote, remoteConfigured,
  remoteStatus, saveRemoteConfig, type RemoteConfig,
} from '../remote/remoteSync';
import { syncAssets } from '../remote/assetSync';
import Icon from './Icon';
import SecretInput from './SecretInput';

/**
 * 外链网盘(S3 兼容)同步面板。
 * 与「协作」面板的区别:数据在用户自己的桶里,没有 20MB 上限,资源原文件
 * 也跟着走,且不经过本项目的服务器。
 */
export default function RemotePanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<RemoteConfig>(loadRemoteConfig);
  const [busy, setBusy] = useState<'push' | 'pull' | 'test' | null>(null);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState('');
  const folder = useLoom((s) => s.folder);
  const assets = useLoom((s) => s.project.assets);
  const withBytes = assets.filter((a) => a.hash).length;

  const patch = (p: Partial<RemoteConfig>) => {
    const next = { ...cfg, ...p };
    setCfg(next);
    saveRemoteConfig(next);
  };

  const ready = remoteConfigured(cfg);

  const runTest = async () => {
    setBusy('test');
    setStatus('正在连接…');
    const r = await testConnection(cfg);
    setStatus(r.ok ? '连接正常,桶可读写。' : `连接失败:${r.reason}`);
    setBusy(null);
  };

  const doPush = async (force = false) => {
    setBusy('push');
    setStatus('正在加密并上传…');
    setProgress('');
    try {
      const project = useLoom.getState().project;
      const res = await pushToRemote(cfg, project, force);
      const key = await deriveAesKey(`theloom:${cfg.bucket}/${cfg.prefix ?? ''}`, cfg.pass);
      const a = await syncAssets(cfg, project, folder, key,
        (done, total, label) => setProgress(total ? `${label} ${done}/${total}` : ''));
      patch({ lastEtag: res.etag ?? '', lastSyncAt: res.at });
      setProgress('');
      setStatus(`已上传。资源:传 ${a.uploaded} / 跳过 ${a.skipped}`
        + (a.failed.length ? ` / 失败 ${a.failed.length}` : ''));
    } catch (e) {
      if (e instanceof RemoteConflict) {
        const ok = await confirmDialog({
          title: '远端已被其他设备更新',
          message: '继续上传会覆盖对方的版本。建议先「拉取」查看,确认无误再上传。\n\n仍要强制覆盖?',
          danger: true,
          confirmText: '强制覆盖',
        });
        setBusy(null);
        if (ok) return doPush(true);
        setStatus('已取消,远端未改动。');
        return;
      }
      setStatus(`上传失败:${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(null);
  };

  const doPull = async () => {
    const ok = await confirmDialog({
      title: '用远端版本替换当前项目?',
      message: '当前项目会被远端内容覆盖。可用 Ctrl+Z 撤销,或先在「版本历史」存一个快照。',
      danger: true,
      confirmText: '拉取并替换',
    });
    if (!ok) return;
    setBusy('pull');
    setStatus('正在下载并解密…');
    try {
      const got = await pullFromRemote(cfg);
      if (!got) { setStatus('远端还没有项目,先上传一次。'); setBusy(null); return; }
      useLoom.getState().replaceProject(got.project);
      const key = await deriveAesKey(`theloom:${cfg.bucket}/${cfg.prefix ?? ''}`, cfg.pass);
      const a = await syncAssets(cfg, got.project, folder, key,
        (done, total, label) => setProgress(total ? `${label} ${done}/${total}` : ''));
      patch({ lastEtag: got.etag ?? '', lastSyncAt: got.at });
      setProgress('');
      setStatus(`已拉取。资源:取 ${a.downloaded} / 跳过 ${a.skipped}`
        + (a.failed.length ? ` / 失败 ${a.failed.length}` : ''));
    } catch (e) {
      setStatus(`拉取失败:${e instanceof Error ? e.message : String(e)}(口令不对也会解不开)`);
    }
    setBusy(null);
  };

  const checkRemote = async () => {
    setBusy('test');
    try {
      const s = await remoteStatus(cfg);
      setStatus(!s.exists ? '远端还没有项目。'
        : s.changed ? `远端有更新(${new Date(s.at).toLocaleString()}),建议先拉取。`
          : '远端与本机上次同步一致。');
    } catch (e) {
      setStatus(`查询失败:${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(null);
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <div className="sync-head">
          <Icon name="cloud" size={14} />
          <span>外链网盘同步(S3 兼容)</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="player-tip">
            数据存进<b>你自己的对象存储</b>(Cloudflare R2 / Backblaze B2 / MinIO / 阿里云 OSS 等),
            端到端加密,不经过本项目服务器。没有 20MB 上限,<b>资源原文件也一起同步</b>。
            <br />网页版需先在桶上配置 CORS(允许本站 origin 与 GET/PUT/HEAD、暴露 ETag);桌面版无此要求。
          </div>

          <div className="field">
            <label>Endpoint</label>
            <input
              value={cfg.endpoint}
              placeholder="https://<账号>.r2.cloudflarestorage.com"
              onChange={(e) => patch({ endpoint: e.target.value.trim() })}
            />
          </div>
          <div className="field-row2">
            <div className="field">
              <label>存储桶</label>
              <input value={cfg.bucket} onChange={(e) => patch({ bucket: e.target.value.trim() })} />
            </div>
            <div className="field">
              <label>区域(R2 填 auto)</label>
              <input value={cfg.region} onChange={(e) => patch({ region: e.target.value.trim() })} />
            </div>
          </div>
          <div className="field">
            <label>Access Key ID</label>
            <input value={cfg.accessKeyId} onChange={(e) => patch({ accessKeyId: e.target.value.trim() })} />
          </div>
          <div className="field">
            <label>Secret Access Key</label>
            <SecretInput
              value={cfg.secretAccessKey}
              onChange={(v) => patch({ secretAccessKey: v.trim() })}
            />
          </div>
          <div className="field-row2">
            <div className="field">
              <label>桶内路径</label>
              <input value={cfg.prefix ?? ''} placeholder="theloom/" onChange={(e) => patch({ prefix: e.target.value })} />
            </div>
            <div className="field">
              <label>加密口令</label>
              <SecretInput
                value={cfg.pass}
                placeholder="忘记即无法恢复"
                onChange={(v) => patch({ pass: v })}
              />
            </div>
          </div>

          <div className="hint">
            密钥与口令只存本机,不上传。口令与「桶 + 路径」共同派生密钥 ——
            换桶或改路径后需用同一口令才能解开原有数据。本项目共 {withBytes} 个资源带原文件。
          </div>

          {status && <div className="player-tip" style={{ marginTop: 8 }}>{status}</div>}
          {progress && <div className="hint">{progress}</div>}

          <div className="sync-actions">
            <button className="ghost" disabled={!ready || busy !== null} onClick={runTest}>
              {busy === 'test' ? '检查中…' : '测试连接'}
            </button>
            <button className="ghost" disabled={!ready || busy !== null} onClick={checkRemote}>查看远端状态</button>
            <span style={{ flex: 1 }} />
            <button className="ghost" disabled={!ready || busy !== null} onClick={doPull}>
              {busy === 'pull' ? '拉取中…' : '拉取'}
            </button>
            <button className="primary" disabled={!ready || busy !== null} onClick={() => doPush()}>
              {busy === 'push' ? '上传中…' : '上传'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
