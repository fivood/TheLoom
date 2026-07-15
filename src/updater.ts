import type { DownloadEvent } from '@tauri-apps/plugin-updater';
import { isTauri } from './storage';

const DEFER_KEY = 'theloom-update-defer-v1';
const DEFER_MS = 24 * 60 * 60 * 1000;

export interface AvailableUpdate {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall: (onEvent?: (event: DownloadEvent) => void) => Promise<void>;
  close: () => Promise<void>;
}

interface DeferredUpdate {
  version: string;
  until: number;
}

export async function findAvailableUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date,
    body: update.body,
    downloadAndInstall: (onEvent) => update.downloadAndInstall(onEvent),
    close: () => update.close(),
  };
}

export function shouldAutoPromptUpdate(version: string): boolean {
  try {
    const raw = localStorage.getItem(DEFER_KEY);
    if (!raw) return true;
    const deferred = JSON.parse(raw) as DeferredUpdate;
    return deferred.version !== version || deferred.until <= Date.now();
  } catch {
    return true;
  }
}

export function deferUpdate(version: string) {
  const deferred: DeferredUpdate = { version, until: Date.now() + DEFER_MS };
  localStorage.setItem(DEFER_KEY, JSON.stringify(deferred));
}

export function clearUpdateDeferral(version: string) {
  try {
    const raw = localStorage.getItem(DEFER_KEY);
    if (!raw) return;
    const deferred = JSON.parse(raw) as DeferredUpdate;
    if (deferred.version === version) localStorage.removeItem(DEFER_KEY);
  } catch {
    localStorage.removeItem(DEFER_KEY);
  }
}

export async function relaunchApp() {
  if (!isTauri) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
