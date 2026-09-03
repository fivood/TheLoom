import { create } from 'zustand';

export type ToolRequest = 'chapterCompile' | 'manuscriptImport' | 'remoteSync' | 'findReplace';

interface ToolBus {
  request: { seq: number; kind: ToolRequest } | null;
  open: (kind: ToolRequest) => void;
  consume: () => void;
}

/** 模块内部(如文档工具栏)向 App 发起的工具请求;App 监听后打开对应对话框或文件选择 */
export const useToolBus = create<ToolBus>((set, get) => ({
  request: null,
  open: (kind) => set({ request: { seq: (get().request?.seq ?? 0) + 1, kind } }),
  consume: () => set({ request: null }),
}));
