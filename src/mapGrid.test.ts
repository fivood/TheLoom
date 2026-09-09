import { describe, expect, it } from 'vitest';
import { gridCell, gridFromDrag, snapToGrid } from './mapGrid';

const ASPECT = 16 / 9;

describe('网格几何', () => {
  it('纵向格距乘宽高比 —— 拉伸坐标系下这样格子在屏幕上才是方的', () => {
    const cell = gridCell({ size: 0.05 }, ASPECT);
    expect(cell.x).toBeCloseTo(0.05, 10);
    expect(cell.y).toBeCloseTo(0.05 * ASPECT, 10);
    // 屏幕上的边长:容器宽 W、高 W/aspect
    const W = 1600;
    expect(cell.x * W).toBeCloseTo(cell.y * (W / ASPECT), 6);
  });

  it('偏移按各自格距取模,负数也归到 [0, 格距)', () => {
    const cell = gridCell({ size: 0.05, offsetX: 0.13, offsetY: -0.01 }, ASPECT);
    expect(cell.ox).toBeCloseTo(0.03, 10);
    expect(cell.oy).toBeGreaterThanOrEqual(0);
    expect(cell.oy).toBeLessThan(cell.y);
  });

  it('吸附落在带偏移的格点上,而不是回到 0 起算的格点', () => {
    const cell = gridCell({ size: 0.05, offsetX: 0.02 }, ASPECT);
    const p = snapToGrid({ x: 0.213, y: 0.5 }, cell);
    // 格点是 0.02 + n×0.05
    expect(((p.x - 0.02) / 0.05) % 1).toBeCloseTo(0, 8);
    expect(p.x).toBeCloseTo(0.22, 8);
  });

  it('没有偏移时吸附退化为整数倍格距', () => {
    const cell = gridCell({ size: 0.05 }, ASPECT);
    expect(snapToGrid({ x: 0.213, y: 0.187 }, cell).x).toBeCloseTo(0.2, 8);
  });
});

describe('拖一格对齐底图', () => {
  it('拖多格时按格数均分,误差被摊薄', () => {
    // 沿底图格线从 0.037 拖到 0.537,共 10 格
    const g = gridFromDrag({ x: 0.037, y: 0.1 }, { x: 0.537, y: 0.1 }, 10, ASPECT)!;
    expect(g.size).toBeCloseTo(0.05, 10);
    expect(g.offsetX).toBeCloseTo(0.037, 10);
  });

  it('反向拖拽结果相同 —— 取的是两点的最小值与跨度', () => {
    const a = gridFromDrag({ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }, 4, ASPECT)!;
    const b = gridFromDrag({ x: 0.3, y: 0.4 }, { x: 0.1, y: 0.2 }, 4, ASPECT)!;
    expect(a).toEqual(b);
  });

  it('偏移落在 [0, 格距) 内', () => {
    const g = gridFromDrag({ x: 0.337, y: 0.44 }, { x: 0.387, y: 0.49 }, 1, ASPECT)!;
    expect(g.offsetX).toBeGreaterThanOrEqual(0);
    expect(g.offsetX!).toBeLessThan(g.size);
    expect(g.offsetY!).toBeLessThan(g.size * ASPECT);
  });

  it('跨度太小或格数离谱时返回 null,忽略这次拖拽', () => {
    expect(gridFromDrag({ x: 0.1, y: 0.1 }, { x: 0.102, y: 0.2 }, 1, ASPECT)).toBeNull();
    expect(gridFromDrag({ x: 0, y: 0 }, { x: 0.9, y: 0.5 }, 1, ASPECT)).toBeNull();
  });

  it('对齐后的网格用它自己的吸附,格点与底图格线重合', () => {
    const g = gridFromDrag({ x: 0.037, y: 0.1 }, { x: 0.537, y: 0.1 }, 10, ASPECT)!;
    const cell = gridCell(g, ASPECT);
    // 底图的第 3 条格线在 0.037 + 3×0.05 = 0.187;手抖点到 0.190 也该吸回去
    expect(snapToGrid({ x: 0.19, y: 0.5 }, cell).x).toBeCloseTo(0.187, 8);
  });
});
