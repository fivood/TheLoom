import { describe, expect, it } from 'vitest';
import { mulberry32, randomSeed, resumeRng, rollD6 } from './rng';

describe('mulberry32 种子化随机', () => {
  it('同种子序列完全一致', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('不同种子序列不同', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 5 }, a);
    const seqB = Array.from({ length: 5 }, b);
    expect(seqA).not.toEqual(seqB);
  });

  it('rollD6 范围 1-6 且可复现', () => {
    const rng = mulberry32(7);
    const rolls = Array.from({ length: 100 }, () => rollD6(rng));
    expect(rolls.every((r) => r >= 1 && r <= 6)).toBe(true);
    const rng2 = mulberry32(7);
    const rolls2 = Array.from({ length: 100 }, () => rollD6(rng2));
    expect(rolls).toEqual(rolls2);
  });

  it('resumeRng 快进后与原序列续接一致(读档掷骰不漂移)', () => {
    const full = mulberry32(99);
    const consumed = Array.from({ length: 6 }, full);
    const tail = Array.from({ length: 4 }, full);
    expect(consumed).toHaveLength(6);
    const resumed = resumeRng(99, 6);
    expect(Array.from({ length: 4 }, resumed)).toEqual(tail);
  });

  it('randomSeed 在可读范围内', () => {
    for (let i = 0; i < 20; i++) {
      const s = randomSeed();
      expect(s).toBeGreaterThanOrEqual(1000);
      expect(s).toBeLessThan(1000000);
    }
  });
});
