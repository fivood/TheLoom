import Icon from './Icon';

/**
 * 首启新手引导:三选一入口(继续 / 载入示例 / AI 生成完整项目)+ 跳过。
 * 触发条件在 App 里:localStorage 无 `theloom-onboarded-v1` + 当前项目为空。
 * 关闭后一律写入 localStorage,不再打扰。
 */
interface Props {
  onContinueBlank: () => void;
  onLoadSample: () => void;
  onAiImport: () => void;
  onClose: () => void;
}

export const ONBOARDING_KEY = 'theloom-onboarded-v1';

export function markOnboarded() {
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch { /* 忽略 */ }
}

export default function Onboarding({ onContinueBlank, onLoadSample, onAiImport, onClose }: Props) {
  const pick = (fn: () => void) => { markOnboarded(); fn(); onClose(); };
  return (
    <div className="palette-backdrop" onClick={() => { markOnboarded(); onClose(); }}>
      <div className="palette onboarding" onClick={(e) => e.stopPropagation()}>
        <div className="onboarding-head">
          <h2>欢迎来到叙事织机</h2>
          <p>本地优先的创作工具:小说、剧本、互动叙事都行。选一个起点开始:</p>
        </div>
        <div className="onboarding-cards">
          <button className="onboarding-card" onClick={() => pick(onContinueBlank)}>
            <Icon name="doc" size={22} />
            <div className="onboarding-card-title">从空白开始写</div>
            <div className="onboarding-card-desc">直接进入文档模块,写场景 / 章节;需要哪个模块就打开哪个。</div>
          </button>
          <button className="onboarding-card" onClick={() => pick(onLoadSample)}>
            <Icon name="book" size={22} />
            <div className="onboarding-card-title">载入示例项目</div>
            <div className="onboarding-card-desc">一个已填好的短篇互动剧本,含流程 / 实体 / 大纲 / 时间线;10 秒看懂各模块。</div>
          </button>
          <button className="onboarding-card" onClick={() => pick(onAiImport)}>
            <Icon name="bulb" size={22} />
            <div className="onboarding-card-title">从材料生成项目</div>
            <div className="onboarding-card-desc">粘正文 + 设定笔记,AI 分析后一次生成卷章 / 实体 / 关系(需先在「AI 设置」配 Key)。</div>
          </button>
        </div>
        <div className="onboarding-foot">
          <button className="ghost" onClick={() => { markOnboarded(); onClose(); }}>跳过引导</button>
          <span className="hint">下次不再显示 · 随时可从「工具 → 载入示例 / 完整项目导入」再来</span>
        </div>
      </div>
    </div>
  );
}
