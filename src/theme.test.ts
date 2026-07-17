import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPref, loadPref, readableInk, resolveMode, savePref, systemPrefersDark } from './theme';

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

describe('readableInk 按底色亮度反色', () => {
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
