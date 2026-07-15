import { useMemo, useState } from 'react';
import type { AvailableUpdate } from '../updater';
import { clearUpdateDeferral, deferUpdate, relaunchApp } from '../updater';
import Icon from './Icon';

export type UpdateDialogState =
  | { kind: 'available'; update: AvailableUpdate }
  | { kind: 'latest' }
  | { kind: 'error'; message: string };

type InstallPhase = 'ready' | 'installing' | 'installed' | 'failed';

export default function UpdateDialog({ state, onClose }: { state: UpdateDialogState; onClose: () => void }) {
  const [phase, setPhase] = useState<InstallPhase>('ready');
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const update = state.kind === 'available' ? state.update : null;

  const releaseDate = useMemo(() => {
    if (!update?.date) return '';
    const date = new Date(update.date);
    return Number.isNaN(date.getTime()) ? update.date : date.toLocaleDateString();
  }, [update?.date]);

  const progress = total && total > 0 ? Math.min(100, Math.round(downloaded / total * 100)) : null;

  const postpone = async () => {
    if (update) {
      deferUpdate(update.version);
      await update.close().catch(() => undefined);
    }
    onClose();
  };

  const install = async () => {
    if (!update) return;
    setPhase('installing');
    setDownloaded(0);
    setTotal(null);
    setError('');
    try {
      let expectedTotal: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          expectedTotal = event.data.contentLength ?? null;
          setTotal(expectedTotal);
        }
        else if (event.event === 'Progress') setDownloaded((value) => value + event.data.chunkLength);
        else if (event.event === 'Finished') setDownloaded((value) => expectedTotal ?? value);
      });
      clearUpdateDeferral(update.version);
      setPhase('installed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    }
  };

  const closeInstalled = async () => {
    await update?.close().catch(() => undefined);
    onClose();
  };

  const restart = async () => {
    try {
      await relaunchApp();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    }
  };

  if (state.kind === 'latest') {
    return (
      <div className="palette-backdrop" onClick={onClose}>
        <div className="palette update-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="sync-head">
            <span><Icon name="check" size={15} /> 已是最新版本</span>
            <span className="spacer" />
            <button className="ghost icon-btn" onClick={onClose}>×</button>
          </div>
          <div className="update-status-message">当前安装的 TheLoom 已经是最新版本。</div>
          <div className="update-actions"><button className="primary" onClick={onClose}>知道了</button></div>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="palette-backdrop" onClick={onClose}>
        <div className="palette update-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="sync-head">
            <span>检查更新失败</span>
            <span className="spacer" />
            <button className="ghost icon-btn" onClick={onClose}>×</button>
          </div>
          <div className="update-error">{state.message}</div>
          <div className="update-actions"><button className="primary" onClick={onClose}>关闭</button></div>
        </div>
      </div>
    );
  }

  if (!update) return null;

  return (
    <div className="palette-backdrop" onClick={() => { if (phase === 'ready' || phase === 'failed') postpone(); }}>
      <div className="palette update-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <span><Icon name="download" size={15} /> {phase === 'installed' ? '更新已安装' : '发现新版本'}</span>
          <span className="spacer" />
          {(phase === 'ready' || phase === 'failed') && <button className="ghost icon-btn" onClick={postpone}>×</button>}
        </div>

        <div className="update-version-row">
          <span className="update-version old">v{update.currentVersion}</span>
          <span className="update-arrow">→</span>
          <span className="update-version new">v{update.version}</span>
          {releaseDate && <span className="update-date">发布于 {releaseDate}</span>}
        </div>

        <div className="field update-notes-field">
          <label>更新内容</label>
          <div className="update-notes">{update.body?.trim() || '本次发布未提供更新说明。'}</div>
        </div>

        {phase === 'installing' && (
          <div className="update-progress">
            <div className="update-progress-label">
              <span>正在下载并安装，请不要关闭应用…</span>
              {progress !== null && <span>{progress}%</span>}
            </div>
            <div className="update-progress-track">
              <div className={`update-progress-bar ${progress === null ? 'indeterminate' : ''}`} style={progress === null ? undefined : { width: `${progress}%` }} />
            </div>
          </div>
        )}

        {phase === 'installed' && (
          <div className="update-success">安装已经完成。可以立即重启，也可以继续工作并在稍后手动重启。</div>
        )}

        {phase === 'failed' && <div className="update-error">更新失败：{error}</div>}

        <div className="update-actions">
          {phase === 'ready' && (
            <>
              <button className="ghost" onClick={postpone}>24 小时后提醒</button>
              <button className="primary" onClick={install}><Icon name="download" size={13} /> 下载并安装</button>
            </>
          )}
          {phase === 'installing' && <button disabled>正在安装…</button>}
          {phase === 'installed' && (
            <>
              <button className="ghost" onClick={closeInstalled}>稍后重启</button>
              <button className="primary" onClick={restart}>立即重启</button>
            </>
          )}
          {phase === 'failed' && (
            <>
              <button className="ghost" onClick={postpone}>暂缓更新</button>
              <button className="primary" onClick={install}>重试</button>
            </>
          )}
        </div>

        {phase === 'ready' && <div className="update-defer-hint">暂缓后 24 小时内不再自动提醒；仍可随时点击顶部版本号手动检查。</div>}
      </div>
    </div>
  );
}
