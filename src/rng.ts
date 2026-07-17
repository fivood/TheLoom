/**
 * R7 种子化随机数:mulberry32,同一种子的掷骰序列完全可复现。
 * 演出与路径测试共用;种子随演出存档保存。
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 随机生成一个人类可读的种子(1000-999999) */
export function randomSeed(): number {
  return 1000 + Math.floor(Math.random() * 999000);
}

/** 掷一枚 d6 */
export function rollD6(rng: () => number): number {
  return 1 + Math.floor(rng() * 6);
}

/** 从种子快进 n 次消耗,返回续用的 RNG(读档恢复用) */
export function resumeRng(seed: number, consumed: number): () => number {
  const rng = mulberry32(seed);
  for (let i = 0; i < consumed; i++) rng();
  return rng;
}
