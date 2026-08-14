import { useSyncExternalStore } from 'react';

/**
 * 走手机壳还是桌面布局,按**设备短边**判定,而不是当前视口宽度。
 *
 * 取短边的原因:手机横过来时视口宽度能到 850+,按宽度判定就会掉进桌面三栏布局,
 * 而那个布局在手机上根本没法用(侧栏 + 正文 + 属性栏挤在 393px 高度里)。
 * 短边与朝向无关,横竖屏结论一致。
 *
 * 阈值 820:11 寸 iPad 短边 834(iPad Pro / Air 11),刚好在线上;
 * iPad mini(744)、各代 iPhone 一律走手机壳。
 */
const TABLET_MIN_EDGE = 820;

function shorterEdge(): number {
  const s = window.screen;
  const fromScreen = s && Number.isFinite(s.width) && Number.isFinite(s.height)
    ? Math.min(s.width, s.height)
    : 0;
  // screen 不可用(极少数环境)时退回视口短边
  if (fromScreen > 0) return fromScreen;
  return Math.min(window.innerWidth, window.innerHeight);
}

/** 桌面浏览器缩窄窗口不应变成手机壳 —— 屏幕本身够大就是桌面 */
function computeIsMobile(): boolean {
  return shorterEdge() < TABLET_MIN_EDGE;
}

function subscribe(cb: () => void): () => void {
  // 旋转与窗口尺寸变化都可能改变 screen 的读数(部分浏览器会交换宽高)
  window.addEventListener('resize', cb);
  window.addEventListener('orientationchange', cb);
  return () => {
    window.removeEventListener('resize', cb);
    window.removeEventListener('orientationchange', cb);
  };
}

/*
 * 不缓存:返回的是布尔基元,useSyncExternalStore 按值比较,不存在
 * 「返回新引用导致无限重渲染」的问题。缓存反而会在没有 resize 事件时
 * 把过时的判定一直锁住。
 */
function getSnapshot(): boolean {
  return computeIsMobile();
}

/** 是否使用移动端专用壳(按设备短边判定,与朝向无关) */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export { TABLET_MIN_EDGE, computeIsMobile };
