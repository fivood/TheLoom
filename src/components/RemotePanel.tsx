import { useEffect, useState } from 'react';
import { useLoom } from '../store';
import { confirmDialog } from '../dialog';
import { testConnection } from '../remote/backend';
import * as onedrive from '../remote/onedrive';
import {
  RemoteConflict, loadRemoteConfig, pullFromRemote, pushToRemote, remoteConfigured,
  remoteKey, remoteStatus, saveRemoteConfig, syncInbox, type RemoteConfig,
} from '../remote/remoteSync';
import { syncAssets } from '../remote/assetSync';
import { assetSignature } from '../remote/autoRules';
import { noteSynced } from '../remote/autoSync';
import { loadInbox, saveInbox } from '../inbox';
import Icon from './Icon';
import SecretInput from './SecretInput';
import { useEscape } from '../hooks/useEscape';

/**
 * 外链网盘(S3 兼容)同步面板。
 * 与「协作」面板的区别:数据在用户自己的桶里,没有 20MB 上限,资源原文件
 * 也跟着走,且不经过本项目的服务器。
 */
export default function RemotePanel({ onClose }: { onClose: () => void }) {
  useEscape(true, onClose);
  const [cfg, setCfg] = useState<RemoteConfig>(loadRemoteConfig);
  const [busy, setBusy] = useState<'push' | 'pull' | 'test' | null>(null);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState('');
  const folder = useLoom((s) => s.folder);
  const currentSlotId = useLoom((s) => s.currentSlotId);
  const assets = useLoom((s) => s.project.assets);
  const withBytes = assets.filter((a) => a.hash).length;

  const patch = (p: Partial<RemoteConfig>) => {
    const next = { ...cfg, ...p };
    setCfg(next);
    saveRemoteConfig(next);
  };

  const od = cfg.provider === 'onedrive';
  const [signedIn, setSignedIn] = useState(onedrive.signedIn);
  const ready = remoteConfigured(cfg) && (!od || signedIn);

  // 从微软登录页跳回来时,URL 上带着授权码,在这里换成令牌
  useEffect(() => {
    onedrive.completeAuth()
      .then((r) => { if (r === 'ok') { setSignedIn(true); setStatus('OneDrive 已登录。'); } })
      .catch((e: unknown) => setStatus(e instanceof Error ? e.message : String(e)));
  }, []);

  const doLogin = async () => {
    const id = (cfg.clientId ?? '').trim();
    if (!id) { setStatus('请先填写应用 ID。'); return; }
    await onedrive.beginAuth(id);
  };

  const doLogout = () => {
    onedrive.signOut();
    setSignedIn(false);
    setStatus('已退出 OneDrive 登录(本机数据不受影响)。');
  };

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
      const key = await remoteKey(cfg);
      const a = await syncAssets(cfg, project, folder, key,
        (done, total, label) => setProgress(total ? `${label} ${done}/${total}` : ''));
      // 灵感库跨项目,与项目并行同步;按 id 并集合并,不需要冲突判定
      saveInbox(await syncInbox(cfg, loadInbox()));
      patch({ lastEtag: res.etag ?? '', lastSyncAt: res.at, assetSig: assetSignature(project) });
      noteSynced(project.updatedAt);
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
      message: '当前项目会被远端内容覆盖。拉取前会自动存一个快照,反悔了可在桌面端「历史」面板还原。',
      danger: true,
      confirmText: '拉取并替换',
    });
    if (!ok) return;
    // 移动端没有版本历史入口也没有 Ctrl+Z,拉取前先存快照是唯一的后悔药
    useLoom.getState().createSnapshot(`拉取前自动 ${new Date().toLocaleString()}`);
    setBusy('pull');
    setStatus('正在下载并解密…');
    try {
      const got = await pullFromRemote(cfg);
      if (!got) { setStatus('远端还没有项目,先上传一次。'); setBusy(null); return; }
      useLoom.getState().replaceProject(got.project);
      const key = await remoteKey(cfg);
      const a = await syncAssets(cfg, got.project, folder, key,
        (done, total, label) => setProgress(total ? `${label} ${done}/${total}` : ''));
      saveInbox(await syncInbox(cfg, loadInbox()));
      patch({ lastEtag: got.etag ?? '', lastSyncAt: got.at, assetSig: assetSignature(got.project) });
      noteSynced(got.project.updatedAt);
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
      const local = cfg.lastSyncAt ? `(本机上次同步:${new Date(cfg.lastSyncAt).toLocaleString()})` : '';
      setStatus(!s.exists ? '远端还没有项目。'
        : s.changed ? `远端有更新(${new Date(s.at).toLocaleString()}),建议先拉取。${local}`
          : `远端与本机上次同步一致。${local}`);
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
          <span>外链网盘同步</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="field">
            <label>存放位置</label>
            <select
              value={cfg.provider ?? 's3'}
              onChange={(e) => patch({ provider: e.target.value as 's3' | 'onedrive', lastEtag: '' })}
            >
              <option value="s3">S3 兼容存储(R2 / B2 / MinIO / OSS)</option>
              <option value="onedrive">OneDrive</option>
            </select>
          </div>

          <div className="player-tip">
            数据端到端加密后存进<b>你自己的网盘</b>,不经过本项目服务器。没有 20MB 上限,
            <b>资源原文件也一起同步</b>。
            <br />远端只存<b>一个</b>项目对象,对应当前打开的项目槽位;换一部作品再上传会覆盖远端。
            {od ? (
              <>
                <br />只申请 <b>应用文件夹</b>权限,写在 OneDrive 的
                「应用/TheLoom」下,碰不到你的其他文件。切换后端相当于换了一个仓库,需重新上传一次。
              </>
            ) : (
              <>
                <br />网页版需先在桶上配置 CORS(允许本站 origin 与 GET/PUT/HEAD、暴露 ETag);桌面版无此要求。
              </>
            )}
          </div>

          {od ? (
            <>
              <div className="field">
                <label>应用 ID(Azure 应用注册的 Application ID)</label>
                <input
                  value={cfg.clientId ?? ''}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  onChange={(e) => patch({ clientId: e.target.value.trim() })}
                />
              </div>
              <div className="hint">
                在 Azure 门户「应用注册」建一个应用,平台选 <b>单页应用程序(SPA)</b>,
                重定向 URI 填 <code>{onedrive.redirectUri()}</code>,把 Application ID 粘到上面。
                这不是密钥,可以公开。
              </div>
              <div className="sync-actions" style={{ marginTop: 8 }}>
                <button className="ghost" onClick={doLogin} disabled={busy !== null}>
                  {signedIn ? '重新登录' : '登录 OneDrive'}
                </button>
                {signedIn && <button className="ghost" onClick={doLogout}>退出登录</button>}
                <span className="hint" style={{ marginLeft: 8 }}>{signedIn ? '已登录' : '未登录'}</span>
              </div>
            </>
          ) : (
          <>
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
          </>
          )}
          <div className="field-row2">
            <div className="field">
              <label>{od ? '应用文件夹内路径' : '桶内路径'}</label>
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
            密钥、令牌与口令只存本机,不上传。口令与「{od ? '网盘' : '桶'} + 路径」共同派生密钥 ——
            换{od ? '后端' : '桶'}或改路径后需用同一口令才能解开原有数据。本项目共 {withBytes} 个资源带原文件。
          </div>

          {status && <div className="player-tip" style={{ marginTop: 8 }}>{status}</div>}
          {progress && <div className="hint">{progress}</div>}

          <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={!!cfg.auto}
              disabled={!ready}
              onChange={(e) => patch({ auto: e.target.checked, autoSlotId: e.target.checked ? currentSlotId : '' })}
            />
            <span>
              自动同步:停手 30 秒后自动上传,回到窗口时检查远端。
              <b>只自动上传,不自动替换</b> —— 远端有更新只提示,拉取仍要你点。
              只对开启时的这部作品生效,换作品不会自动覆盖远端。
            </span>
          </label>

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
