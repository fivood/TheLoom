/**
 * 写作阶段(本机界面设置,与题材预设正交)。
 * - 写:只留正文,按钮全收(v0.60.0)
 * - 改:修订工具(查找替换 / 快照 / 差异 / 批注)提到一线
 * - 理:导航换成大纲 / 时间线 / 规划优先,正文进结构视图
 * 不写入 Project、不参与同步:同一部作品在不同设备可以处在不同阶段。
 */
import { create } from 'zustand';

export type WritingStage = 'write' | 'revise' | 'plan' | 'codex';

export const STAGE_LABEL: Record<WritingStage, string> = {
  write: '写',
  revise: '改',
  plan: '理',
  codex: '设',
};

/**
 * 阶段图标。改、理、设沿用各自主模块的图标(版本对比 / 大纲 / 设定集),
 * **写单独用铅笔而不是文档图标** —— 文档、大纲、设定集三个图标都是「矩形加内部线条」,
 * 15px 并排时分不出来;铅笔是斜向笔杆,轮廓和另外三个都不同,一眼能认出来。
 * 而且这四个格子表达的是「我现在在干什么」,写的动作本来就该是笔而不是一页纸。
 */
export const STAGE_ICON: Record<WritingStage, 'pencil' | 'compare' | 'grid' | 'cards'> = {
  write: 'pencil',
  revise: 'compare',
  plan: 'grid',
  codex: 'cards',
};

export const STAGE_HINT: Record<WritingStage, string> = {
  write: '初稿:只留正文,工具按需展开',
  revise: '修订:查找替换、快照、版本差异与批注在手边',
  plan: '构思:大纲、时间线与规划优先,正文按块整理',
  codex: '设定:设定集、地图、关系图与资料优先,查设定不必离开当前作品',
};

const STORE_KEY = 'theloom-stage-v1';

export function loadStage(): WritingStage {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw === 'write' || raw === 'revise' || raw === 'plan' || raw === 'codex') return raw;
  } catch { /* 忽略 */ }
  return 'write';
}

export const useStage = create<{ stage: WritingStage; setStage: (stage: WritingStage) => void }>((set) => ({
  stage: loadStage(),
  setStage: (stage) => {
    try { localStorage.setItem(STORE_KEY, stage); } catch { /* 忽略 */ }
    set({ stage });
  },
}));
