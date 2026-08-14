/**
 * R5-B 主题偏好(本机界面设置)。
 * - 三态:light / dark / system(跟随系统)
 * - 首次使用默认 system;不写入 Project、不参与云协作同步
 * - 应用方式:根元素 <html> 上打 data-theme(系统模式解算成实际值)
 * - Tauri 桌面窗口背景同步主题,避免启动白闪
 */

export type ThemePref = 'light' | 'dark' | 'system';
export type ThemeMode = 'light' | 'dark';

const STORE_KEY = 'theloom-theme-v1';

export function loadPref(): ThemePref {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch { /* 忽略 */ }
  return 'system';
}

export function savePref(pref: ThemePref) {
  try { localStorage.setItem(STORE_KEY, pref); } catch { /* 忽略 */ }
}

/** 系统偏好当前是不是深色 */
export function systemPrefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch { return false; }
}

/** 把 pref 解算成实际主题模式 */
export function resolveMode(pref: ThemePref): ThemeMode {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

/**
 * 应用主题到 <html> 根元素。
 * - light / dark:锁定,忽略系统
 * - system:清除 data-theme,让 @media (prefers-color-scheme: dark) 兜底
 * 返回当前生效的模式。
 */
export function applyPref(pref: ThemePref): ThemeMode {
  const root = document.documentElement;
  if (pref === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', pref);
  }
  const mode = resolveMode(pref);
  root.setAttribute('data-theme-mode', mode);
  // 更新浏览器/桌面壳的原生 UI 颜色,避免地址栏 / 标题栏与页面撞色
  const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  const color = mode === 'dark' ? '#1b1b19' : '#eceae6';
  if (meta) meta.content = color;
  syncDesktopTheme(pref);
  try { window.dispatchEvent(new CustomEvent('theloom-theme')); } catch { /* 忽略 */ }
  return mode;
}

/** Tauri 桌面窗口标题栏跟随主题;网页环境无操作 */
function syncDesktopTheme(pref: ThemePref) {
  if (!('__TAURI_INTERNALS__' in window)) return;
  import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(pref === 'system' ? null : pref))
    .catch(() => { /* 旧桌面壳不支持时静默 */ });
}

/** 当前生效模式(读根元素,供 useSyncExternalStore 做快照) */
export function getThemeMode(): ThemeMode {
  return document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light';
}

/** 订阅主题模式变化(applyPref 触发;React Flow colorMode 等消费) */
export function subscribeThemeMode(cb: () => void): () => void {
  window.addEventListener('theloom-theme', cb);
  return () => window.removeEventListener('theloom-theme', cb);
}

/** 渲染层反色用的两个墨色:深墨与浅墨 */
export const INK_DARK = '#1b1b19';
export const INK_LIGHT = '#f5f4ef';

/** sRGB 相对亮度(WCAG 口径,必须做 gamma 展开,不能直接线性加权) */
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** #rgb / #rrggbb → [r,g,b];非法返回 null */
function parseHex(bg: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * 按内容底色选可读文字色(渲染层反色,不改写内容颜色本身)。
 * 非法 / 非 hex 输入返回 undefined(继承默认)。
 *
 * **深浅两种墨色都算一遍对比度取高者**,而不是用亮度阈值二分 ——
 * 阈值法在中灰附近会选错方向:`#8e8d86` 亮度 140.7(旧阈值 145 判为「深底」)
 * 于是配浅字,实测对比度仅 3.02;配深字本可达 5.25。
 */
export function readableInk(bg?: string): string | undefined {
  if (!bg) return undefined;
  const rgb = parseHex(bg);
  if (!rgb) return undefined;
  const lum = relativeLuminance(rgb[0], rgb[1], rgb[2]);
  const darkRgb = parseHex(INK_DARK)!;
  const lightRgb = parseHex(INK_LIGHT)!;
  const onDark = contrastRatio(lum, relativeLuminance(darkRgb[0], darkRgb[1], darkRgb[2]));
  const onLight = contrastRatio(lum, relativeLuminance(lightRgb[0], lightRgb[1], lightRgb[2]));
  return onDark >= onLight ? INK_DARK : INK_LIGHT;
}

/** 底色与选中墨色的实际对比度,供测试与体检使用 */
export function inkContrast(bg: string): number | null {
  const rgb = parseHex(bg);
  const ink = readableInk(bg);
  if (!rgb || !ink) return null;
  const inkRgb = parseHex(ink)!;
  return contrastRatio(
    relativeLuminance(rgb[0], rgb[1], rgb[2]),
    relativeLuminance(inkRgb[0], inkRgb[1], inkRgb[2]),
  );
}

/**
 * 启动时初始化:恢复保存的偏好、应用到 DOM,并在 pref='system' 时
 * 监听系统主题变化,自动重新应用。
 */
export function initTheme(): { pref: ThemePref; mode: ThemeMode; unsubscribe: () => void } {
  const pref = loadPref();
  const mode = applyPref(pref);
  let unsubscribe = () => { /* noop */ };
  try {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      // 只有当用户仍在跟随系统时才响应
      if (loadPref() === 'system') applyPref('system');
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      unsubscribe = () => mq.removeEventListener('change', onChange);
    } else if (typeof (mq as MediaQueryList & { addListener?: (fn: () => void) => void }).addListener === 'function') {
      (mq as MediaQueryList & { addListener: (fn: () => void) => void }).addListener(onChange);
    }
  } catch { /* 忽略 */ }
  return { pref, mode, unsubscribe };
}

export const THEME_PREF_LABEL: Record<ThemePref, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};
