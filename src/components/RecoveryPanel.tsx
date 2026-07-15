import { exportProject, useLoom } from '../store';
import { parseProjectData } from '../recovery';
import {
  downloadDiagnosticReport, LOCAL_STORAGE_ASSUMED_LIMIT_BYTES, LOCAL_STORAGE_WARNING_BYTES,
} from '../diagnostics';
import { isTauri } from '../storage';
import { confirmDialog } from '../dialog';
import Icon from './Icon';

function downloadRaw(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function RecoveryPanel({ onClose }: { onClose: () => void }) {
  const project = useLoom((state) => state.project);
  const backup = useLoom((state) => state.recoveryBackup);
  const quarantine = useLoom((state) => state.quarantinedProject);
  const notice = useLoom((state) => state.recoveryNotice);
  const storageUsage = useLoom((state) => state.storageUsage);
  const saveStatus = useLoom((state) => state.saveStatus);
  const saveError = useLoom((state) => state.saveError);
  const syncError = useLoom((state) => state.syncError);
  const restore = useLoom((state) => state.restoreRecoveryBackup);
  const dismissNotice = useLoom((state) => state.dismissRecoveryNotice);
  const discardQuarantine = useLoom((state) => state.discardQuarantinedProject);
  const backupProject = backup ? parseProjectData(backup.data) : null;
  const usagePercent = Math.min(100, Math.round(storageUsage.bytes / LOCAL_STORAGE_ASSUMED_LIMIT_BYTES * 100));

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel recovery-panel" onClick={(event) => event.stopPropagation()}>
        <div className="sync-head">
          <span><Icon name="archive" size={14} /> 恢复与备份</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body recovery-body">
          {notice && (
            <div className="recovery-notice">
              <span>{notice}</span>
              <button className="ghost" onClick={dismissNotice}>知道了</button>
            </div>
          )}

          <section className="recovery-card">
            <div>
              <div className="recovery-card-title">当前项目</div>
              <div className="recovery-card-meta">{project.name} · {(JSON.stringify(project).length / 1024).toFixed(1)} KB</div>
            </div>
            <div className="recovery-actions">
              <button className="ghost" onClick={() => downloadDiagnosticReport(project, {
                storage: storageUsage,
                saveStatus,
                saveError,
                syncError,
                recoveryCreatedAt: backup?.createdAt ?? null,
                quarantineCreatedAt: quarantine?.createdAt ?? null,
                isDesktop: isTauri,
              })}>下载诊断信息</button>
              <button className="primary" onClick={() => exportProject(project)}>
                <Icon name="download" size={13} /> 下载完整备份
              </button>
            </div>
          </section>

          <section className={`recovery-card recovery-card-stack ${storageUsage.bytes >= LOCAL_STORAGE_WARNING_BYTES ? 'recovery-storage-warning' : ''}`}>
            <div className="recovery-storage-head">
              <div className="recovery-card-title">浏览器本地空间</div>
              <span>{storageUsage.available ? `${(storageUsage.bytes / 1024 / 1024).toFixed(2)} MB` : '无法读取'}</span>
            </div>
            {storageUsage.available && (
              <>
                <div className="recovery-storage-track"><div style={{ width: `${usagePercent}%` }} /></div>
                <div className="recovery-card-meta">
                  {storageUsage.bytes >= LOCAL_STORAGE_WARNING_BYTES
                    ? '本地数据已超过 4 MB 提醒线。建议下载完整备份，并删除不用的项目快照或大尺寸资源。'
                    : '按常见的 5 MB localStorage 容量估算；不同浏览器的实际上限可能不同。'}
                </div>
              </>
            )}
          </section>

          <section className="recovery-card recovery-card-stack">
            <div className="recovery-card-title">滚动自动恢复点</div>
            {backup && backupProject ? (
              <>
                <div className="recovery-card-meta">
                  {backupProject.name} · {new Date(backup.createdAt).toLocaleString()} · {(backup.data.length / 1024).toFixed(1)} KB
                </div>
                <div className="recovery-actions">
                  <button className="ghost" onClick={() => downloadRaw(`${backupProject.name}-自动恢复点.loom.json`, backup.data)}>下载副本</button>
                  <button className="primary" onClick={restore}>恢复此版本</button>
                </div>
              </>
            ) : (
              <div className="recovery-card-meta">编辑项目后自动建立，最多每 10 分钟更新一次；保存新内容前会保留旧状态。</div>
            )}
          </section>

          {quarantine && (
            <section className="recovery-card recovery-card-stack recovery-corrupt">
              <div className="recovery-card-title">已隔离的损坏存档</div>
              <div className="recovery-card-meta">
                保存于 {new Date(quarantine.createdAt).toLocaleString()}。它不会再覆盖当前项目，可下载留作人工排查。
              </div>
              <div className="recovery-actions">
                <button className="ghost" onClick={() => downloadRaw('theloom-corrupt-project.json', quarantine.data)}>下载原始数据</button>
                <button
                  className="ghost"
                  onClick={async () => {
                    if (await confirmDialog({ message: '清除已隔离的损坏存档?当前可用项目和自动恢复点不会受影响。', danger: true, confirmText: '清除' })) discardQuarantine();
                  }}
                >清除</button>
              </div>
            </section>
          )}

          <div className="recovery-hint">命名里程碑版本仍在“工具 → 版本历史”中管理，最多保留 30 个。</div>
        </div>
      </div>
    </div>
  );
}
