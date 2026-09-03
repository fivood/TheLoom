import { useState } from 'react';
import { useLoom } from '../store';
import type { WorkspacePreset } from '../types';
import Icon from './Icon';
import { useEscape } from '../hooks/useEscape';

/**
 * 首启新手引导:先选「写什么」(决定工作台布局),再选起点(空白 / 示例 / AI)。
 * 触发条件在 App 里:localStorage 无 `theloom-onboarded-v1` + 当前项目为空。
 * 关闭后一律写入 localStorage,不再打扰。
 */
interface Props {
  onContinueBlank: () => void;
  onLoadSample: () => void;
  onClose: () => void;
}

export const ONBOARDING_KEY = 'theloom-onboarded-v1';

export function markOnboarded() {
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch { /* 忽略 */ }
}

const MODES: { key: WorkspacePreset; label: string; desc: string }[] = [
  { key: 'novel', label: '小说', desc: '正文为主:正文、设定集、大纲、资料' },
  { key: 'screenplay', label: '剧本', desc: '影视 / 舞台:剧本、场次表、人物,导出 Final Draft' },
  { key: 'codex', label: '设定集', desc: '世界观与百科:设定集、地图、时间线、关系图' },
  { key: 'nonfiction', label: '纪实', desc: '非虚构:资料来源、大纲、正文、时间线' },
  { key: 'trpg', label: 'TRPG 模组', desc: '跑团:遭遇流程、NPC 与道具、地图、检定' },
  { key: 'interactive', label: '互动叙事', desc: '游戏剧本:流程、变量、实体、演出' },
  { key: 'universal', label: '通用', desc: '全模块完整导航,都做' },
];

export default function Onboarding({ onContinueBlank, onLoadSample, onClose }: Props) {
  const [mode, setMode] = useState<WorkspacePreset>('novel');
  // 任何一条退出路径都写入所选布局:选了却因为「跳过」而丢失,是最容易让人以为没设置成功的情况
  const pick = (fn?: () => void) => {
    useLoom.getState().update((p) => { p.workspacePreset = mode; });
    markOnboarded();
    fn?.();
    onClose();
  };
  useEscape(true, () => pick());
  return (
    <div className="palette-backdrop" onClick={() => pick()}>
      <div className="palette onboarding" onClick={(e) => e.stopPropagation()}>
        <div className="onboarding-head">
          <h2>欢迎来到叙事织机</h2>
          <p>本地优先的创作工具。先告诉它你在写什么,它会帮你把工作台摆好:</p>
        </div>
        <div className="onboarding-mode" role="radiogroup" aria-label="创作类型">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`onboarding-mode-btn ${mode === m.key ? 'on' : ''}`}
              role="radio"
              aria-checked={mode === m.key}
              onClick={() => setMode(m.key)}
            >
              <span className="onboarding-mode-label">{m.label}</span>
              <span className="onboarding-mode-desc">{m.desc}</span>
            </button>
          ))}
        </div>
        <div className="onboarding-picked">
          已选「{MODES.find((m) => m.key === mode)!.label}」布局 · 之后可在项目菜单 ▾ 里随时更换
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
        </div>
        <div className="onboarding-foot">
          <button className="primary" onClick={() => pick()}>
            使用「{MODES.find((m) => m.key === mode)!.label}」布局并关闭
          </button>
          <span className="hint">下次不再显示 · 布局随时可从项目菜单 ▾ 更换</span>
        </div>
      </div>
    </div>
  );
}
