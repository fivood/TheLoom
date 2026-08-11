/**
 * PWA 运行时(P1):
 *   - 仅网页模式注册 Service Worker(桌面 Tauri 版跳过)
 *   - 管理「可安装」「有新版本」「可离线」三个状态,供顶部横幅消费
 *   - 协作房间请求由 SW 配置为 NetworkOnly,SW 不缓存房间密文
 */
import { useSyncExternalStore } from 'react';
import { isTauri } from './storage';

export interface PwaStatus {
  /** 浏览器已触发 beforeinstallprompt,可在页面内引导安装 */
  canInstall: boolean;
  /** 新版本 SW 已就绪,等待用户确认刷新 */
  needRefresh: boolean;
  /** 首次安装成功,已可离线使用(用于一次性提示) */
  offlineReady: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let status: PwaStatus = { canInstall: false, needRefresh: false, offlineReady: false };
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let deferredPrompt: { prompt: () => Promise<void> } | null = null;

function emit() {
  for (const listener of listeners) listener();
}
function patch(partial: Partial<PwaStatus>) {
  status = { ...status, ...partial };
  emit();
}

export function setupPwa(): void {
  if (isTauri || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as unknown as { prompt: () => Promise<void> };
    patch({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    patch({ canInstall: false });
  });

  // 开发模式不注入 SW;仅生产构建注册
  if (!import.meta.env.PROD) return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => patch({ needRefresh: true }),
      onOfflineReady: () => patch({ offlineReady: true }),
    });
  });
}

export function installPwa(): void {
  if (!deferredPrompt) return;
  void deferredPrompt
    .prompt()
    .then(() => {
      deferredPrompt = null;
      patch({ canInstall: false });
    })
    .catch(() => { /* 用户取消安装,忽略 */ });
}

export function refreshForUpdate(): void {
  void updateSW?.(true);
}

export function usePwaStatus(): PwaStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}
