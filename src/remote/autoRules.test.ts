import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { assetSignature, shouldAutoPush } from './autoRules';

const base = {
  auto: true,
  configured: true,
  busy: false,
  paused: false,
  projectUpdatedAt: 2000,
  syncedAt: 1000,
  now: 1_000_000,
  lastPushAt: 0,
  currentSlotId: 'slot-a',
};

describe('自动同步的推送判定', () => {
  it('有新改动且配置齐全时推', () => {
    expect(shouldAutoPush(base)).toBe(true);
  });

  it('开关关、没配好、正在同步、冲突暂停,四种都不推', () => {
    expect(shouldAutoPush({ ...base, auto: false })).toBe(false);
    expect(shouldAutoPush({ ...base, configured: false })).toBe(false);
    expect(shouldAutoPush({ ...base, busy: true })).toBe(false);
    expect(shouldAutoPush({ ...base, paused: true })).toBe(false);
  });

  it('内容没变就不推 —— 否则刚拉下来的会被原样推回去', () => {
    expect(shouldAutoPush({ ...base, projectUpdatedAt: 1000, syncedAt: 1000 })).toBe(false);
    expect(shouldAutoPush({ ...base, projectUpdatedAt: 999, syncedAt: 1000 })).toBe(false);
  });

  it('两次自动推送之间有最小间隔', () => {
    expect(shouldAutoPush({ ...base, lastPushAt: base.now - 30_000 })).toBe(false);
    expect(shouldAutoPush({ ...base, lastPushAt: base.now - 61_000 })).toBe(true);
  });

  it('换了作品不自动推 —— 远端只存一个项目,推上去会盖掉另一本', () => {
    expect(shouldAutoPush({ ...base, boundSlotId: 'slot-a' })).toBe(true);
    expect(shouldAutoPush({ ...base, boundSlotId: 'slot-b' })).toBe(false);
    // 老配置没有绑定槽位时不拦
    expect(shouldAutoPush({ ...base, boundSlotId: undefined })).toBe(true);
  });
});

describe('资源指纹', () => {
  const proj = (hashes: (string | undefined)[]) =>
    ({ assets: hashes.map((h) => ({ hash: h })) } as unknown as Project);

  it('资源集合变了才变,顺序与增删都算', () => {
    expect(assetSignature(proj(['a', 'b']))).toBe(assetSignature(proj(['a', 'b'])));
    expect(assetSignature(proj(['a', 'b']))).not.toBe(assetSignature(proj(['a', 'b', 'c'])));
    expect(assetSignature(proj(['a', 'b']))).not.toBe(assetSignature(proj(['b', 'a'])));
  });

  it('没有哈希的老资源不会让指纹每次都变', () => {
    expect(assetSignature(proj([undefined, 'a']))).toBe(assetSignature(proj([undefined, 'a'])));
  });
});
