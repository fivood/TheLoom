import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Flow, FlowNode, Project } from './types';

/**
 * R19-5 安全重命名。
 *
 * R6 定下的原则:改技术名不该留下悬空引用。R19-2 的 jump / call 目标与
 * R19-3 的 event 事件名是后加的引用类型,这里守住它们也跟着改。
 */

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
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

const node = (id: string, type: FlowNode['type'], data: Partial<FlowNode['data']> = {}): FlowNode => ({
  id, type, position: { x: 0, y: 0 }, data: { title: id, text: '', ...data },
});

/** 主线里有 jump / call / event 三种引用,外加一层子流程里的 call */
function fixture(): Flow[] {
  return [
    {
      id: 'main', name: '主线', technicalName: 'main',
      nodes: [
        node('j', 'jump', { targetFlow: 'side' }),
        node('c', 'call', { targetFlow: 'side', targetEntry: 'front' }),
        node('ev', 'event', { eventName: 'play_anim' }),
        node('other', 'call', { targetFlow: '别的流程' }),
        node('frag', 'fragment', {
          sub: {
            nodes: [node('deep', 'call', { targetFlow: 'side' }), node('deepev', 'event', { eventName: 'play_anim' })],
            edges: [],
          },
        }),
      ],
      edges: [],
    },
    { id: 'side', name: '支线', technicalName: 'side', nodes: [node('s', 'dialogue')], edges: [] },
  ];
}

async function freshStore() {
  stubLocalStorage();
  vi.resetModules();
  const { useLoom } = await import('./store');
  return useLoom;
}

function collectRefs(p: Project) {
  const flowRefs: string[] = [];
  const eventRefs: string[] = [];
  const walk = (nodes: FlowNode[]) => {
    for (const n of nodes) {
      if (typeof n.data.targetFlow === 'string') flowRefs.push(n.data.targetFlow);
      if (typeof n.data.eventName === 'string') eventRefs.push(n.data.eventName);
      if (n.data.sub) walk(n.data.sub.nodes);
    }
  };
  for (const f of p.flows) walk(f.nodes);
  return { flowRefs, eventRefs };
}

describe('R19-5 安全重命名', () => {
  it('改流程技术名时,jump / call 的 targetFlow 跟着改(含子流程内),别的目标不动', async () => {
    const useLoom = await freshStore();
    useLoom.getState().update((p) => { p.flows = fixture(); });

    useLoom.getState().renameFlowRefs('side', 'side_v2');

    const { flowRefs } = collectRefs(useLoom.getState().project);
    expect(flowRefs.filter((r) => r === 'side_v2')).toHaveLength(3);   // j / c / 子流程里的 deep
    expect(flowRefs).toContain('别的流程');                             // 无关目标保持原样
    expect(flowRefs).not.toContain('side');
  });

  it('改外部事件名时,event 节点的 eventName 跟着改(含子流程内)', async () => {
    const useLoom = await freshStore();
    useLoom.getState().update((p) => { p.flows = fixture(); });

    useLoom.getState().renameExternalEventRefs('play_anim', 'play_cutscene');

    const { eventRefs } = collectRefs(useLoom.getState().project);
    expect(eventRefs).toEqual(['play_cutscene', 'play_cutscene']);
  });

  it('空名或同名时不动,避免误伤', async () => {
    const useLoom = await freshStore();
    useLoom.getState().update((p) => { p.flows = fixture(); });
    const before = JSON.stringify(collectRefs(useLoom.getState().project));

    useLoom.getState().renameFlowRefs('', 'x');
    useLoom.getState().renameFlowRefs('side', 'side');
    useLoom.getState().renameExternalEventRefs('play_anim', '');

    expect(JSON.stringify(collectRefs(useLoom.getState().project))).toBe(before);
  });

  it('重命名走 commit,可以一步撤销', async () => {
    const useLoom = await freshStore();
    useLoom.getState().update((p) => { p.flows = fixture(); });
    useLoom.getState().renameFlowRefs('side', 'side_v2');
    expect(collectRefs(useLoom.getState().project).flowRefs).toContain('side_v2');

    useLoom.getState().undo();
    expect(collectRefs(useLoom.getState().project).flowRefs).toContain('side');
    expect(collectRefs(useLoom.getState().project).flowRefs).not.toContain('side_v2');
  });
});
