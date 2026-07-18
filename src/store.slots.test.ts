import { afterEach, describe, expect, it, vi } from 'vitest';

function stubLocalStorage() {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => { mem.set(key, String(value)); },
    removeItem: (key: string) => { mem.delete(key); },
    clear: () => { mem.clear(); },
    key: (index: number) => [...mem.keys()][index] ?? null,
    get length() { return mem.size; },
  });
  return mem;
}

afterEach(() => {
  vi.doUnmock('./storage');
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('多项目文件夹绑定', () => {
  it('每个项目记住自己的文件夹并可直接切换', async () => {
    stubLocalStorage();
    vi.resetModules();
    const saveToFolder = vi.fn(async () => undefined);
    const loadFromFolder = vi.fn();
    vi.doMock('./storage', async () => ({
      ...(await vi.importActual<typeof import('./storage')>('./storage')),
      isTauri: true,
      getSavedFolder: () => null,
      setSavedFolder: vi.fn(),
      saveToFolder,
      loadFromFolder,
    }));
    const { useLoom } = await import('./store');

    const firstId = useLoom.getState().currentSlotId;
    const firstProject = structuredClone(useLoom.getState().project);
    firstProject.name = '短篇 A';
    useLoom.getState().replaceProject(firstProject);
    useLoom.getState().setFolder('C:/stories/a');

    expect(await useLoom.getState().newSlot('blank')).toBe(true);
    const secondId = useLoom.getState().currentSlotId;
    useLoom.getState().setFolder('C:/stories/b');
    expect(saveToFolder).toHaveBeenCalledWith('C:/stories/a', expect.objectContaining({ name: '短篇 A' }));

    const folderProject = structuredClone(firstProject);
    folderProject.name = '短篇 A（文件夹）';
    loadFromFolder.mockResolvedValueOnce({ project: folderProject, recoveredFromBackup: false });

    expect(await useLoom.getState().switchSlot(firstId)).toBe(true);
    expect(loadFromFolder).toHaveBeenCalledWith('C:/stories/a');
    expect(useLoom.getState().folder).toBe('C:/stories/a');
    expect(useLoom.getState().project.name).toBe('短篇 A（文件夹）');
    expect(useLoom.getState().slots.find((slot) => slot.id === secondId)?.folder).toBe('C:/stories/b');
  });

  it('目标文件夹读取失败时留在当前项目', async () => {
    stubLocalStorage();
    vi.resetModules();
    const loadFromFolder = vi.fn();
    vi.doMock('./storage', async () => ({
      ...(await vi.importActual<typeof import('./storage')>('./storage')),
      isTauri: true,
      getSavedFolder: () => null,
      setSavedFolder: vi.fn(),
      saveToFolder: vi.fn(async () => undefined),
      loadFromFolder,
    }));
    const { useLoom } = await import('./store');

    useLoom.getState().setFolder('C:/stories/a');
    expect(await useLoom.getState().newSlot('blank')).toBe(true);
    const currentId = useLoom.getState().currentSlotId;
    const targetId = useLoom.getState().slots.find((slot) => slot.id !== currentId)!.id;
    loadFromFolder.mockRejectedValueOnce(new Error('folder unavailable'));

    expect(await useLoom.getState().switchSlot(targetId)).toBe(false);
    expect(useLoom.getState().currentSlotId).toBe(currentId);
    expect(useLoom.getState().syncError).toContain('folder unavailable');
  });

  it('清理浏览器镜像后后续编辑只写文件夹，解绑时恢复本地镜像', async () => {
    const mem = stubLocalStorage();
    vi.useFakeTimers();
    vi.resetModules();
    const saveToFolder = vi.fn(async () => undefined);
    vi.doMock('./storage', async () => ({
      ...(await vi.importActual<typeof import('./storage')>('./storage')),
      isTauri: true,
      getSavedFolder: () => null,
      setSavedFolder: vi.fn(),
      saveToFolder,
      loadFromFolder: vi.fn(),
    }));
    const { useLoom } = await import('./store');

    const slotId = useLoom.getState().currentSlotId;
    const projectStorageKey = `theloom-project-${slotId}`;
    useLoom.getState().setFolder('C:/stories/folder-only');
    expect(mem.has(projectStorageKey)).toBe(true);

    const cleared = await useLoom.getState().clearCurrentBrowserCache();
    expect(cleared).toEqual({ cleared: true, removedAssets: 0 });
    expect(mem.has(projectStorageKey)).toBe(false);
    expect(useLoom.getState().slots[0].folderOnly).toBe(true);

    useLoom.getState().update((project) => { project.name = '只写文件夹'; });
    await vi.advanceTimersByTimeAsync(500);
    expect(mem.has(projectStorageKey)).toBe(false);
    expect(saveToFolder).toHaveBeenLastCalledWith(
      'C:/stories/folder-only',
      expect.objectContaining({ name: '只写文件夹' }),
    );

    expect(useLoom.getState().unbindFolder()).toBe(true);
    expect(mem.has(projectStorageKey)).toBe(true);
    expect(useLoom.getState().slots[0].folderOnly).toBeUndefined();
  });
});
