import { useState } from 'react';
import { useLoom } from '../store';
import Icon from './Icon';

export default function VersionHistory({ onClose }: { onClose: () => void }) {
  const snapshots = useLoom((s) => s.snapshots);
  const { createSnapshot, restoreSnapshot, deleteSnapshot } = useLoom();
  const [name, setName] = useState('');

  const save = () => {
    createSnapshot(name.trim() || `版本 ${new Date().toLocaleString()}`);
    setName('');
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
        <div className="sync-head">
          <span><Icon name="undo" size={14} /> 版本历史</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="field">
            <label>保存当前状态为命名快照</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="版本名(如:第一幕初稿完成)"
                onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                style={{ flex: 1 }}
              />
              <button className="primary" onClick={save}>保存版本</button>
            </div>
            <span className="hint" style={{ fontSize: 11 }}>快照存浏览器 localStorage,最多 30 个;回滚后可用撤销栈短期恢复</span>
          </div>

          {snapshots.length === 0 ? (
            <div className="empty-hint" style={{ padding: 24 }}>
              还没有版本快照。<br />
              想保留某个里程碑(初稿完成、改稿前、试玩定版)时,给它起个名存下来。
            </div>
          ) : (
            <div className="snapshot-list">
              {snapshots.map((s) => (
                <div key={s.id} className="snapshot-item">
                  <div className="snapshot-meta">
                    <div className="snapshot-name">{s.name}</div>
                    <div className="snapshot-time">
                      {new Date(s.createdAt).toLocaleString()} · {(s.data.length / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <div className="snapshot-actions">
                    <button
                      className="ghost"
                      title="回滚到该版本"
                      onClick={() => restoreSnapshot(s.id)}
                    >回滚</button>
                    <button
                      className="ghost icon-btn"
                      title="删除该快照"
                      onClick={() => { if (confirm(`删除快照「${s.name}」?`)) deleteSnapshot(s.id); }}
                    ><Icon name="trash" size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
