import { useMemo, useState } from 'react';
import { useLoom, exportProject } from '../store';
import { documentWordCount } from '../util';
import { dailyStatValue, writingDateKey, writingStreak } from '../writingProgress';
import { loadInbox, visibleIdeas } from '../inbox';
import RemotePanel from '../components/RemotePanel';
import ThemeToggle from '../components/ThemeToggle';
import Icon from '../components/Icon';
import { confirmDialog } from '../dialog';

export default function MobileMe() {
  const project = useLoom((s) => s.project);
  const folder = useLoom((s) => s.folder);
  const saveStatus = useLoom((s) => s.saveStatus);
  const slots = useLoom((s) => s.slots);
  const currentSlotId = useLoom((s) => s.currentSlotId);
  const switchSlot = useLoom((s) => s.switchSlot);
  const loadSampleProject = useLoom((s) => s.loadSampleProject);
  const newSlot = useLoom((s) => s.newSlot);
  const [remoteSync, setRemoteSync] = useState(false);
  const ideaCount = useMemo(() => visibleIdeas(loadInbox()).length, []);

  const onLoadSample = async () => {
    const dirty = project.documents.length > 0 || project.entities.length > 0
      || project.outlineRows.length > 0 || project.timelinePoints.length > 0;
    if (!dirty) {
      loadSampleProject();
      return;
    }
    const ok = await confirmDialog({
      title: '在新项目里载入示例?',
      message: '当前项目已有内容,示例会载入到一个新的项目槽位,不会覆盖它。',
    });
    if (!ok) return;
    await newSlot('sample');
  };
  const totalWords = project.documents.reduce((s, d) => s + documentWordCount(d), 0);
  const mode = project.writingProgress?.countMode ?? 'characters';
  const bodyOnly = project.writingProgress?.bodyOnly ?? false;
  const today = dailyStatValue(
    project.writingProgress?.daily?.find((s) => s.date === writingDateKey()), mode, bodyOnly,
  );
  const streak = writingStreak(project.writingProgress, mode, bodyOnly);

  return (
    <div className="m-me">
      {/* 极简顶栏 */}
      <div className="m-clean-topbar">
        <div className="m-top-title-wrap">
          <Icon name="user" size={17} />
          <span className="m-top-title">{project.name || '我的'}</span>
        </div>
        <ThemeToggle />
      </div>

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
          <div><strong>{ideaCount}</strong><span>快记</span></div>
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
      {/* 外链网盘:手机上同样是取稿通道,而且资源原文件也能跟着走 */}
      <button className="m-me-full" onClick={() => setRemoteSync(true)}>
        外链网盘同步(自己的存储)
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

      {/* 手机上原本没有任何载入示例的入口:跳过引导后就再也见不到,
          空项目里「查阅」等页面只剩空状态文案,没法看出长什么样 */}
      <button className="m-me-full" onClick={() => void onLoadSample()}>
        载入示例项目(老伦敦寻人记)
      </button>
      <button className="m-me-full" onClick={() => exportProject(project)}>
        导出 JSON 备份
      </button>
      <div className="hint" style={{ textAlign: 'center' }}>
        碎片写作 · 成稿与完整功能请在桌面端或 11 寸以上平板继续
      </div>
      {remoteSync && <RemotePanel onClose={() => setRemoteSync(false)} />}
    </div>
  );
}
