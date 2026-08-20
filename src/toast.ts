import { useSyncExternalStore } from 'react';
import { uid } from './util';

/**
 * 轻量 toast:非阻断反馈。成功类操作(导入 / 导出 / 清理)用 toast 告知,
 * 不再打断流程;带 onAction 的 toast 停留更久,给「撤销」留出反应时间。
 */

export interface ToastItem {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: string): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, opts?: { actionLabel?: string; onAction?: () => void }): void {
  const t: ToastItem = { id: uid(), message, actionLabel: opts?.actionLabel, onAction: opts?.onAction };
  items = [...items.slice(-4), t];
  emit();
  setTimeout(() => dismissToast(t.id), opts?.onAction ? 6500 : 3500);
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => items,
  );
}
