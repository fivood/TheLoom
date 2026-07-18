import { describe, expect, it, vi } from 'vitest';

function stubLocalStorage() {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  });
  return mem;
}

describe('unbindFolder(文件夹模式解绑)', () => {
  it('解绑后 folder 清空、项目写回当前槽位、绑定记录移除', async () => {
    const mem = stubLocalStorage();
    vi.resetModules();
    const { useLoom } = await import('./store');

    useLoom.getState().setFolder('C:/some/project-dir');
    expect(useLoom.getState().folder).toBe('C:/some/project-dir');
    expect(JSON.parse(mem.get('theloom-slots-v1')!)[0].folder).toBe('C:/some/project-dir');

    useLoom.getState().unbindFolder();

    const after = useLoom.getState();
    expect(after.folder).toBeNull();
    expect(after.saveStatus).toBe('saved');
    expect(after.saveError).toBeNull();
    expect(mem.has('theloom-folder')).toBe(false);
    expect(JSON.parse(mem.get('theloom-slots-v1')!)[0].folder).toBeUndefined();

    const slotKey = [...mem.keys()].find((k) => k.includes(after.currentSlotId) && mem.get(k)!.includes('"flows"'));
    expect(slotKey).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it('未绑定时是无操作', async () => {
    stubLocalStorage();
    vi.resetModules();
    const { useLoom } = await import('./store');

    const before = useLoom.getState().savedAt;
    expect(useLoom.getState().unbindFolder()).toBe(true);
    expect(useLoom.getState().folder).toBeNull();
    expect(useLoom.getState().savedAt).toBe(before);

    vi.unstubAllGlobals();
  });

  it('本地写入失败时保留文件夹绑定', async () => {
    const mem = stubLocalStorage();
    vi.resetModules();
    const { useLoom } = await import('./store');

    useLoom.getState().setFolder('C:/safe/project-dir');
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = (key: string, value: string) => {
      if (key.includes(useLoom.getState().currentSlotId)) throw new Error('QuotaExceededError');
      originalSetItem(key, value);
    };

    expect(useLoom.getState().unbindFolder()).toBe(false);
    const after = useLoom.getState();
    expect(after.folder).toBe('C:/safe/project-dir');
    expect(JSON.parse(mem.get('theloom-slots-v1')!)[0].folder).toBe('C:/safe/project-dir');
    expect(after.saveStatus).toBe('error');
    expect(after.saveError).toContain('仍绑定在原文件夹');

    vi.unstubAllGlobals();
  });
});
