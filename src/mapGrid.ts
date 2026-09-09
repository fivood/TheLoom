import type { MapGrid } from './types';

/**
 * 地图方格网格的几何计算。
 *
 * 抽成纯函数是因为这里全是容易悄悄算错、错了又不报错的东西:
 * 纵向格距要乘宽高比(画布是拉伸坐标系,不乘的话格子是长方形、量距离全错)、
 * 偏移要按格距取模且要能处理负数、校准要从一次拖拽反推三个自由度。
 * 留在组件里就只能靠肉眼看图对不对。
 */

/** 网格的实际格距与原点偏移(都是归一化坐标) */
export interface GridCell {
  x: number;
  y: number;
  ox: number;
  oy: number;
}

/** 正模:JS 的 % 对负数返回负值,而偏移必须落在 [0, m) 里 */
const mod = (v: number, m: number): number => ((v % m) + m) % m;

export function gridCell(grid: MapGrid, aspect: number): GridCell {
  const x = grid.size;
  // 纵向格距 = 边长 × 宽高比。画布是 preserveAspectRatio="none" 的拉伸坐标系,
  // 归一化里边长相等的格子在屏幕上不是正方形
  const y = grid.size * aspect;
  return { x, y, ox: mod(grid.offsetX ?? 0, x), oy: mod(grid.offsetY ?? 0, y) };
}

/** 吸附到最近的格点 */
export function snapToGrid(pt: { x: number; y: number }, cell: GridCell): { x: number; y: number } {
  return {
    x: Math.round((pt.x - cell.ox) / cell.x) * cell.x + cell.ox,
    y: Math.round((pt.y - cell.oy) / cell.y) * cell.y + cell.oy,
  };
}

/**
 * 从一次拖拽反推网格:用户沿着底图自带的格线拖过 `cells` 格。
 *
 * 只用横向跨度定边长 —— 纵向格距由宽高比推出来,再量一遍纵向只会因为手抖
 * 引入两个不一致的值。拖得越多格,除法把手抖误差摊得越薄。
 * 跨度太小或算出的边长离谱时返回 null,由调用方忽略这次拖拽。
 */
export function gridFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
  cells: number,
  aspect: number,
): MapGrid | null {
  const n = Math.max(1, Math.round(cells));
  const size = Math.abs(end.x - start.x) / n;
  if (!Number.isFinite(size) || size < 0.005 || size > 0.5) return null;
  const x0 = Math.min(start.x, end.x);
  const y0 = Math.min(start.y, end.y);
  return {
    size,
    offsetX: mod(x0, size),
    offsetY: mod(y0, size * aspect),
  };
}
