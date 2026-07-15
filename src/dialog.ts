import { create } from 'zustand';

export interface DialogOptions {
  /** 弹窗标题(可选) */
  title?: string;
  /** 主提示文案,支持多行(\n) */
  message: string;
  /** prompt 的默认输入值 */
  defaultValue?: string;
  /** prompt 输入框占位符 */
  placeholder?: string;
  /** 确认按钮文案 */
  confirmText?: string;
  /** 取消按钮文案(prompt / confirm 才有取消) */
  cancelText?: string;
  /** 确认按钮是否标红(危险操作) */
  danger?: boolean;
  /** prompt 是否多行编辑(Enter 换行,Ctrl+Enter 提交) */
  multiline?: boolean;
}

interface OpenDialog {
  kind: 'prompt' | 'confirm' | 'alert';
  options: DialogOptions;
  resolve: (value: string | null | boolean) => void;
}

interface DialogState {
  current: OpenDialog | null;
  prompt: (opts: DialogOptions | string) => Promise<string | null>;
  confirm: (opts: DialogOptions | string) => Promise<boolean>;
  alert: (opts: DialogOptions | string) => Promise<void>;
  close: (result: string | null | boolean) => void;
}

function normalize(opts: DialogOptions | string): DialogOptions {
  return typeof opts === 'string' ? { message: opts } : opts;
}

export const useDialog = create<DialogState>((set, get) => ({
  current: null,
  prompt: (opts) =>
    new Promise<string | null>((resolve) => {
      set({ current: { kind: 'prompt', options: normalize(opts), resolve: resolve as unknown as (v: string | null | boolean) => void } });
    }),
  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      set({ current: { kind: 'confirm', options: normalize(opts), resolve: resolve as unknown as (v: string | null | boolean) => void } });
    }),
  alert: (opts) =>
    new Promise<void>((resolve) => {
      set({ current: { kind: 'alert', options: normalize(opts), resolve: resolve as unknown as (v: string | null | boolean) => void } });
    }),
  close: (result) => {
    const { current } = get();
    if (!current) return;
    current.resolve(result);
    set({ current: null });
  },
}));

/** prompt 的快捷封装:返回输入文本,取消返回 null */
export function promptText(opts: DialogOptions | string): Promise<string | null> {
  return useDialog.getState().prompt(opts);
}

/** confirm 的快捷封装:确认返回 true,取消返回 false */
export function confirmDialog(opts: DialogOptions | string): Promise<boolean> {
  return useDialog.getState().confirm(opts);
}

/** alert 的快捷封装:仅展示信息,关闭即 resolve */
export function alertDialog(opts: DialogOptions | string): Promise<void> {
  return useDialog.getState().alert(opts);
}
