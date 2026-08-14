import { useState } from 'react';
import { useLoom, exportProject } from '../store';
import { documentWordCount } from '../util';
import { dailyStatValue, writingDateKey, writingStreak } from '../writingProgress';
import SyncPanel from '../components/SyncPanel';
import { useMobilePref } from './useIsMobile';

/** 移动端「我的」:字数 / 场景 / 设定统计、保存状态、云同步、切项目、切回完整版 */
export default function MobileMe() {
  const project = useLoom((s) => s.project);
  const folder = useLoom((s) => s.folder);
  const saveStatus = useLoom((s) => s.saveStatus);
  const slots = useLoom((s) => s.slots);
  const currentSlotId = useLoom((s) => s.currentSlotId);
  const switchSlot = useLoom((s) => s.switchSlot);
  const [syncing, setSyncing] = useState(false);
  const totalWords = project.documents.reduce((s, d) => s + documentWordCount(d), 0);
  const mode = project.writingProgress?.countMode ?? 'characters';
  const bodyOnly = project.writingProgress?.bodyOnly ?? false;
  const today = dailyStatValue(
    project.writingProgress?.daily?.find((s) => s.date === writingDateKey()), mode, bodyOnly,
  );
  const streak = writingStreak(project.writingProgress, mode, bodyOnly);

  return (
    <div className="m-me">
      <div className="m-me-card">
        <div className="m-me-name">{project.name || '未命名项目'}</div>
        <div className="m-me-stats">
          <div><strong>{totalWords}</strong><span>总字数</span></div>
          <div><strong>{today}</strong><span>今日新增</span></div>
          <div><strong>{streak}</strong><span>连续天数</span></div>
        </div>
        <div className="m-me-stats" style={{ marginTop: 12 }}>
          <div><strong>{project.documents.length}</strong><span>场景</span></div>
          <div><strong>{project.entities.length}</strong><span>设定</span></div>
          <div><strong>{project.brainstormNotes.length}</strong><span>快记</span></div>
        </div>
      </div>
      <div className="m-me-row">
        <span>保存状态</span>
        <span>
          {folder ? `已同步 · ${folder.split(/[\\/]/).pop()}`
            : saveStatus === 'saving' ? '正在保存…'
              : '已自动保存到本地'}
        </span>
      </div>
      {/* 云房间是手机取稿 / 回传的唯一通道,不能只在桌面布局里才有入口 */}
      <button className="m-me-full" onClick={() => setSyncing(true)}>
        云同步(取稿 / 回传)
      </button>

      {slots.length > 1 && (
        <>
          <div className="m-me-section">切换项目</div>
          <div className="m-me-slots">
            {slots.map((s) => (
              <button
                key={s.id}
                className={`m-me-slot ${s.id === currentSlotId ? 'on' : ''}`}
                onClick={() => { if (s.id !== currentSlotId) void switchSlot(s.id); }}
              >
                <span>{s.name || '未命名项目'}</span>
                <span>{s.id === currentSlotId ? '当前' : new Date(s.updatedAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <button className="m-me-full" onClick={() => exportProject(project)}>
        导出 JSON 备份
      </button>
      <button className="m-me-full" onClick={() => useMobilePref.getState().toggle()}>
        切换到完整版(桌面布局)
      </button>
      <div className="hint" style={{ textAlign: 'center' }}>
        完整版顶栏左上角有「手机版」可以切回来
      </div>
      <div className="hint" style={{ textAlign: 'center' }}>
        碎片写作 · 成稿与完整功能请在桌面端继续
      </div>
      {syncing && <SyncPanel onClose={() => setSyncing(false)} />}
    </div>
  );
}
