import { beforeAll, describe, expect, it, vi } from 'vitest';

// store.ts 顶层会读 localStorage 做 initSlots;测试里先 stub
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  get length() { return store.size; },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
});
vi.stubGlobal('addEventListener', () => {});
vi.stubGlobal('removeEventListener', () => {});

let trimSnapshots: typeof import('./store').trimSnapshots;
type Snapshot = import('./store').Snapshot;
beforeAll(async () => {
  const mod = await import('./store');
  trimSnapshots = mod.trimSnapshots;
});

function mkSnap(i: number, auto = false): Snapshot {
  return {
    id: `s${auto ? 'a' : 'm'}${i}`,
    name: auto ? `自动 ${i}` : `手动 ${i}`,
    createdAt: Date.now() - i * 1000,
    data: '{}',
    auto: auto || undefined,
  };
}

describe('trimSnapshots · 自动 / 手动配额独立', () => {
  it('分别截到配额上限:手动 30 · 自动 20', () => {
    const list: Snapshot[] = [];
    for (let i = 0; i < 40; i++) list.push(mkSnap(i, false));
    for (let i = 0; i < 25; i++) list.push(mkSnap(i, true));
    const trimmed = trimSnapshots(list);
    const manual = trimmed.filter((s) => !s.auto);
    const auto = trimmed.filter((s) => s.auto);
    expect(manual.length).toBe(30);
    expect(auto.length).toBe(20);
    // 各自保留最新的(按 createdAt 倒序)
    expect(manual[0].id).toBe('sm0');
    expect(manual[manual.length - 1].id).toBe('sm29');
    expect(auto[0].id).toBe('sa0');
    expect(auto[auto.length - 1].id).toBe('sa19');
  });

  it('结果整体按 createdAt 倒序,自动手动交错正确', () => {
    const list: Snapshot[] = [];
    for (let i = 0; i < 5; i++) list.push(mkSnap(i * 2, false));      // 时间 0, -2000, -4000...
    for (let i = 0; i < 5; i++) list.push(mkSnap(i * 2 + 1, true));   // 时间 -1000, -3000...
    const trimmed = trimSnapshots(list);
    for (let i = 1; i < trimmed.length; i++) {
      expect(trimmed[i - 1].createdAt).toBeGreaterThanOrEqual(trimmed[i].createdAt);
    }
    expect(trimmed).toHaveLength(10);
  });

  it('总数低于配额时全部保留', () => {
    const list: Snapshot[] = [mkSnap(0, false), mkSnap(1, true)];
    expect(trimSnapshots(list)).toHaveLength(2);
  });
});
