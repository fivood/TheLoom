/**
 * 写作阶段(本机界面设置,与题材预设正交)。
 * - 写:只留正文,按钮全收(v0.60.0)
 * - 改:修订工具(查找替换 / 快照 / 差异 / 批注)提到一线
 * - 理:导航换成大纲 / 时间线 / 规划优先,正文进结构视图
 * 不写入 Project、不参与同步:同一部作品在不同设备可以处在不同阶段。
 */
import { create } from 'zustand';

export type WritingStage = 'write' | 'revise' | 'plan';

export const STAGE_LABEL: Record<WritingStage, string> = {
  write: '写',
  revise: '改',
  plan: '理',
};

export const STAGE_HINT: Record<WritingStage, string> = {
  write: '初稿:只留正文,工具按需展开',
  revise: '修订:查找替换、快照、版本差异与批注在手边',
  plan: '构思:大纲、时间线与规划优先,正文按块整理',
};

const STORE_KEY = 'theloom-stage-v1';

export function loadStage(): WritingStage {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw === 'write' || raw === 'revise' || raw === 'plan') return raw;
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
