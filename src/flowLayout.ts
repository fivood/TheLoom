/**
 * R19-5 画布排版的纯几何。
 *
 * 抽出来是因为对齐 / 分布本身与 React Flow 无关,纯输入输出,
 * 放在组件里既没法单测,也让 Canvas 更臃肿。
 */

export type AlignHow = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';

/** 排版只关心位置与尺寸;尺寸缺失(节点尚未测量)按 0 处理 */
export interface LayoutBox {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

/**
 * 对齐:返回需要改动的节点新位置(id → position)。
 * 少于 2 个节点时不动 —— 单个节点没有「对齐」可言。
 *
 * 居中对齐用的是选区整体包围盒的中心,不是各节点中心的平均值 ——
 * 后者会被密集的一侧拽偏。
 */
export function alignNodes(boxes: LayoutBox[], how: AlignHow): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (boxes.length < 2) return out;
  const w = (b: LayoutBox) => b.width ?? 0;
  const h = (b: LayoutBox) => b.height ?? 0;
  const minL = Math.min(...boxes.map((b) => b.position.x));
  const maxR = Math.max(...boxes.map((b) => b.position.x + w(b)));
  const minT = Math.min(...boxes.map((b) => b.position.y));
  const maxB = Math.max(...boxes.map((b) => b.position.y + h(b)));
  const cx = (minL + maxR) / 2;
  const cy = (minT + maxB) / 2;

  for (const b of boxes) {
    const p = { x: b.position.x, y: b.position.y };
    switch (how) {
      case 'left': p.x = minL; break;
      case 'right': p.x = maxR - w(b); break;
      case 'centerX': p.x = cx - w(b) / 2; break;
      case 'top': p.y = minT; break;
      case 'bottom': p.y = maxB - h(b); break;
      case 'centerY': p.y = cy - h(b) / 2; break;
    }
    out.set(b.id, p);
  }
  return out;
}

/**
 * 等距分布:首尾保持不动,中间按等间距重排。
 * 少于 3 个节点时不动 —— 两个节点之间无所谓「等距」。
 */
export function distributeNodes(boxes: LayoutBox[], axis: 'x' | 'y'): Map<string, number> {
  const out = new Map<string, number>();
  if (boxes.length < 3) return out;
  const sorted = [...boxes].sort((a, b) => a.position[axis] - b.position[axis]);
  const first = sorted[0].position[axis];
  const last = sorted[sorted.length - 1].position[axis];
  const step = (last - first) / (sorted.length - 1);
  sorted.forEach((b, i) => out.set(b.id, first + step * i));
  return out;
}
