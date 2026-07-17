import { create } from 'zustand';

export type AiPanelTask = 'ask' | 'query' | 'fix';

export interface AiPanelRequest {
  seq: number;
  task: AiPanelTask;
  issueId?: string;
}

interface AiPanelBus {
  request: AiPanelRequest | null;
  open: (task: AiPanelTask, issueId?: string) => void;
  consume: () => void;
}

/** 其他面板(如体检)向 AI 助手发起任务的轻量通道;App 监听 request 自动打开助手 */
export const useAiPanelBus = create<AiPanelBus>((set, get) => ({
  request: null,
  open: (task, issueId) => set({ request: { seq: (get().request?.seq ?? 0) + 1, task, issueId } }),
  consume: () => set({ request: null }),
}));
