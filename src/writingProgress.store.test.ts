import { afterAll, describe, expect, it, vi } from 'vitest';
import { sampleProject } from './sample';
import { writingDateKey } from './writingProgress';

function stubLocalStorage() {
  const memory = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, String(value)); },
    removeItem: (key: string) => { memory.delete(key); },
    clear: () => { memory.clear(); },
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() { return memory.size; },
  });
}

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
  vi.unstubAllGlobals();
});

describe('writingProgress store', () => {
  it('正文新增随提交记录，撤销移除记录，重做不会重复累计', async () => {
    stubLocalStorage();
    vi.resetModules();
    const { useLoom } = await import('./store');
    const project = sampleProject();
    project.writingProgress = undefined;
    const document = project.documents[0];
    const block = document.blocks.find((item) =>
      ['paragraph', 'action', 'dialogue', 'quote', 'list'].includes(item.type)) ?? document.blocks[0];
    block.type = 'paragraph';
    useLoom.getState().replaceProject(project);

    useLoom.getState().updateDocument(document.id, (current) => {
      const currentBlock = current.blocks.find((item) => item.id === block.id)!;
      currentBlock.text += '新增四字';
    });
    const recorded = useLoom.getState().project.writingProgress?.daily
      ?.find((stat) => stat.date === writingDateKey());
    expect(recorded?.cjk).toBe(4);
    expect(recorded?.bodyCjk).toBe(4);

    useLoom.getState().undo();
    expect(useLoom.getState().project.writingProgress).toBeUndefined();

    useLoom.getState().redo();
    const restored = useLoom.getState().project.writingProgress?.daily
      ?.find((stat) => stat.date === writingDateKey());
    expect(restored?.cjk).toBe(4);
    expect(restored?.bodyCjk).toBe(4);
  });
});
