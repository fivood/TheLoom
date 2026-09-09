/**
 * 连线的手动弯度。
 *
 * 浮动边默认是两个节点边框之间的直线 —— 卡片一多就会从别的卡片身上穿过去。
 * 这里让用户像 PPT 的肘形连接符那样,拖一个手柄把线弯开。
 *
 * 弯度存的是**相对两节点中心连线中点的偏移**,不是绝对坐标 —— 卡片挪走时
 * 弯度要跟着走,存绝对点的话一拖卡片线就散了。
 *
 * 手柄为什么跟手:二次贝塞尔在 t=0.5 处的点是 (p1 + 2·ctrl + p2)/4,
 * 控制点移动 Δ 时该点只移动 Δ/2。所以控制点取「中点 + 2×偏移」,
 * 曲线正好在「中点 + 偏移」处经过 —— 把手柄放在那里,拖动时偏移直接加位移,
 * 手柄就跟着光标走。控制点放在手柄位置的话,线会只走一半,手感很别扭。
 *
 * 端点固定时是精确 1:1(测试守的就是这条)。实际用在 FloatingEdge 上时端点会朝
 * 控制点方向沿卡片边框滑动,手柄因此比光标少走 (端点位移)/2 —— 拖 90px 差十来个像素。
 * 不修:手柄留在线上比精确跟手重要,你是照着看见的线去抓它的。
 */

export interface Point { x: number; y: number }

/** 相对中点的偏移;两个分量都接近 0 视为没弯 */
export interface EdgeCurve { dx: number; dy: number }

export interface CurvedEdge {
  /** SVG path。没弯时是直线段,与不支持弯度时的输出一致 */
  path: string;
  /** 手柄 / 标签位置:线的中段 */
  handle: Point;
}

/** 小于半像素的弯度当没弯 —— 否则一次误触就把直线永久变成贝塞尔 */
const EPS = 0.5;

export function isCurved(curve?: EdgeCurve | null): boolean {
  return !!curve && (Math.abs(curve.dx) > EPS || Math.abs(curve.dy) > EPS);
}

/**
 * 控制点。基准取**两节点中心**的中点而不是边框交点的中点 ——
 * 边框交点要朝控制点方向求,拿它算控制点就成了循环依赖。
 */
export function curveControl(centerMid: Point, curve?: EdgeCurve | null): Point {
  if (!isCurved(curve)) return centerMid;
  return { x: centerMid.x + curve!.dx * 2, y: centerMid.y + curve!.dy * 2 };
}

/** 曲线 t=0.5 处的点 */
const midOfCurve = (p1: Point, ctrl: Point, p2: Point): Point => ({
  x: (p1.x + 2 * ctrl.x + p2.x) / 4,
  y: (p1.y + 2 * ctrl.y + p2.y) / 4,
});

/**
 * 生成路径与手柄位置。
 *
 * @param p1 起点(源节点边框交点)
 * @param p2 终点(目标节点边框交点)
 * @param ctrl 控制点,由 curveControl 算出
 * @param curve 原始偏移,只用来判断有没有弯
 */
export function curvedPath(p1: Point, p2: Point, ctrl: Point, curve?: EdgeCurve | null): CurvedEdge {
  if (!isCurved(curve)) {
    return {
      path: `M ${p1.x},${p1.y}L ${p2.x},${p2.y}`,
      handle: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    };
  }
  return {
    path: `M ${p1.x},${p1.y} Q ${ctrl.x},${ctrl.y} ${p2.x},${p2.y}`,
    handle: midOfCurve(p1, ctrl, p2),
  };
}

/**
 * 拖动手柄:偏移直接加上画布坐标系里的位移。
 *
 * 因为控制点是偏移的两倍,曲线中点的位移正好等于偏移的位移 —— 手柄 1:1 跟手。
 * 拖回原处(位移抵消)时会低于阈值,自动退回直线。
 */
export function dragCurve(curve: EdgeCurve | undefined, delta: Point): EdgeCurve | undefined {
  const next = { dx: (curve?.dx ?? 0) + delta.x, dy: (curve?.dy ?? 0) + delta.y };
  return isCurved(next) ? next : undefined;
}

/** 清洗外部数据:非有限数一律丢弃 */
export function sanitizeCurve(raw: unknown): EdgeCurve | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { dx, dy } = raw as { dx?: unknown; dy?: unknown };
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return undefined;
  const curve = { dx: dx as number, dy: dy as number };
  return isCurved(curve) ? curve : undefined;
}
