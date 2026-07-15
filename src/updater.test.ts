import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearUpdateDeferral, deferUpdate, shouldAutoPromptUpdate } from './updater';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('更新暂缓', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('只暂缓指定版本 24 小时', () => {
    expect(shouldAutoPromptUpdate('0.9.0')).toBe(true);
    deferUpdate('0.9.0');
    expect(shouldAutoPromptUpdate('0.9.0')).toBe(false);
    expect(shouldAutoPromptUpdate('0.9.1')).toBe(true);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(shouldAutoPromptUpdate('0.9.0')).toBe(true);
  });

  it('安装后只清除匹配版本的暂缓记录', () => {
    deferUpdate('0.9.0');
    clearUpdateDeferral('0.8.9');
    expect(shouldAutoPromptUpdate('0.9.0')).toBe(false);
    clearUpdateDeferral('0.9.0');
    expect(shouldAutoPromptUpdate('0.9.0')).toBe(true);
  });

  it('损坏的本地记录不会阻止更新提示', () => {
    localStorage.setItem('theloom-update-defer-v1', '{bad json');
    expect(shouldAutoPromptUpdate('0.9.0')).toBe(true);
  });
});
