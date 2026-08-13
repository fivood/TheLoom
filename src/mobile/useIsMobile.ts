import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

const QUERY = '(max-width: 768px)';

let mql: MediaQueryList | null = null;
function getMql(): MediaQueryList {
  if (!mql) mql = window.matchMedia(QUERY);
  return mql;
}

function subscribe(cb: () => void): () => void {
  const q = getMql();
  q.addEventListener('change', cb);
  return () => q.removeEventListener('change', cb);
}

function getSnapshot(): boolean {
  return getMql().matches;
}

/** 移动端(≤768px 视口)判定;用于切换「碎片时间写作」专用壳 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

interface MobilePref {
  forceDesktop: boolean;
  toggle: () => void;
}

/** 移动端「切换到完整版」开关:显式请求桌面布局,持久化到 localStorage */
export const useMobilePref = create<MobilePref>((set) => ({
  forceDesktop: (() => {
    try { return localStorage.getItem('theloom-force-desktop') === '1'; } catch { return false; }
  })(),
  toggle: () => set((s) => {
    const next = !s.forceDesktop;
    try { localStorage.setItem('theloom-force-desktop', next ? '1' : '0'); } catch { /* 忽略 */ }
    return { forceDesktop: next };
  }),
}));
