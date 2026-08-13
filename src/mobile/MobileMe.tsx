import { useLoom } from '../store';
import { documentWordCount } from '../util';
import { useMobilePref } from './useIsMobile';

/** 移动端「我的」:字数 / 场景 / 设定统计、保存状态、切回完整版 */
export default function MobileMe() {
  const project = useLoom((s) => s.project);
  const folder = useLoom((s) => s.folder);
  const saveStatus = useLoom((s) => s.saveStatus);
  const totalWords = project.documents.reduce((s, d) => s + documentWordCount(d), 0);

  return (
    <div className="m-me">
      <div className="m-me-card">
        <div className="m-me-name">{project.name || '未命名项目'}</div>
        <div className="m-me-stats">
          <div><strong>{totalWords}</strong><span>总字数</span></div>
          <div><strong>{project.documents.length}</strong><span>场景</span></div>
          <div><strong>{project.entities.length}</strong><span>设定</span></div>
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
      <button className="m-me-full" onClick={() => useMobilePref.getState().toggle()}>
        切换到完整版(桌面布局)
      </button>
      <div className="hint" style={{ textAlign: 'center' }}>
        碎片写作 · 成稿与完整功能请在桌面端继续
      </div>
    </div>
  );
}
