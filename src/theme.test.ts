import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPref, inkContrast, loadPref, readableInk, resolveMode, savePref, systemPrefersDark } from './theme';

const STORE_KEY = 'theloom-theme-v1';

function makeFakeRoot() {
  const attrs = new Map<string, string>();
  return {
    setAttribute: (k: string, v: string) => { attrs.set(k, v); },
    getAttribute: (k: string) => (attrs.has(k) ? attrs.get(k)! : null),
    removeAttribute: (k: string) => { attrs.delete(k); },
    hasAttribute: (k: string) => attrs.has(k),
    style: {} as Record<string, string>,
  };
}

let root: ReturnType<typeof makeFakeRoot>;
let meta: { content: string };
let store: Map<string, string>;
let dark = false;

beforeEach(() => {
  root = makeFakeRoot();
  meta = { content: '' };
  store = new Map();
  dark = false;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  });
  vi.stubGlobal('document', {
    documentElement: root,
    querySelector: (sel: string) => (sel.includes('theme-color') ? meta : null),
  });
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: dark,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('window', {
    matchMedia: globalThis.matchMedia,
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme 偏好读写', () => {
  it('未设置时默认跟随系统', () => {
    expect(loadPref()).toBe('system');
  });

  it('非法值被忽略,回退 system', () => {
    store.set(STORE_KEY, 'chartreuse');
    expect(loadPref()).toBe('system');
  });

  it('savePref 持久化并被 loadPref 读回', () => {
    savePref('dark');
    expect(store.get(STORE_KEY)).toBe('dark');
    expect(loadPref()).toBe('dark');
  });
});

describe('readableInk 按对比度反色', () => {
  it('中灰选对比度高的一侧 —— 旧的亮度阈值(145)在这里会选错', () => {
    // #8e8d86 亮度 140.7,阈值法判为「深底」配浅字,实测只有 3.02
    expect(readableInk('#8e8d86')).toBe('#1b1b19');
    expect(inkContrast('#8e8d86')!).toBeGreaterThan(4.5);
  });

  it('示例项目的灰阶色板全部达到 AA(4.5)', () => {
    for (const c of ['#1b1b19', '#565550', '#8e8d86', '#aaa9a1', '#ffffff', '#f2f1ee', '#e6e4df', '#d8d6d0']) {
      expect(inkContrast(c)!, c).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('选中的墨色总是两者中对比度更高的那个', () => {
    // 在测试里独立实现一遍 WCAG 对比度,避免与被测实现同错同对
    const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4);
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    for (const c of ['#000000', '#404040', '#767676', '#808080', '#8e8d86', '#a0a0a0', '#cccccc', '#ffffff']) {
      const picked = readableInk(c)!;
      const rejected = picked === '#1b1b19' ? '#f5f4ef' : '#1b1b19';
      expect(ratio(c, picked), `${c}:选中 ${picked} 应不劣于 ${rejected}`)
        .toBeGreaterThanOrEqual(ratio(c, rejected));
      expect(inkContrast(c)!).toBeCloseTo(ratio(c, picked), 5);
    }
  });

  it('浅底给深字、深底给浅字', () => {
    expect(readableInk('#ffffff')).toBe('#1b1b19');
    expect(readableInk('#f2f1ee')).toBe('#1b1b19');
    expect(readableInk('#1b1b19')).toBe('#f5f4ef');
    expect(readableInk('#565550')).toBe('#f5f4ef');
    expect(readableInk('#fff')).toBe('#1b1b19');
  });

  it('非法输入返回 undefined(继承默认)', () => {
    expect(readableInk(undefined)).toBeUndefined();
    expect(readableInk('')).toBeUndefined();
    expect(readableInk('tomato')).toBeUndefined();
    expect(readableInk('#12345')).toBeUndefined();
  });
});

describe('resolveMode', () => {
  it('light / dark 锁定不受系统影响', () => {
    dark = true;
    expect(resolveMode('light')).toBe('light');
    expect(resolveMode('dark')).toBe('dark');
  });

  it('system 跟随 prefers-color-scheme', () => {
    dark = false;
    expect(resolveMode('system')).toBe('light');
    dark = true;
    expect(resolveMode('system')).toBe('dark');
    expect(systemPrefersDark()).toBe(true);
  });
});

describe('applyPref 打 data-theme', () => {
  it('light:锁定 data-theme=light + mode=light', () => {
    const mode = applyPref('light');
    expect(mode).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.getAttribute('data-theme-mode')).toBe('light');
    expect(meta.content).toBe('#eceae6');
  });

  it('dark:锁定 data-theme=dark + mode=dark', () => {
    const mode = applyPref('dark');
    expect(mode).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-theme-mode')).toBe('dark');
    expect(meta.content).toBe('#1b1b19');
  });

  it('system:清 data-theme,mode 反映实际系统', () => {
    root.setAttribute('data-theme', 'dark');
    dark = true;
    const mode = applyPref('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(mode).toBe('dark');
    expect(root.getAttribute('data-theme-mode')).toBe('dark');

    dark = false;
    const mode2 = applyPref('system');
    expect(mode2).toBe('light');
    expect(root.getAttribute('data-theme-mode')).toBe('light');
  });
});
