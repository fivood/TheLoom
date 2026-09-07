import {
  BaseEdge, EdgeLabelRenderer, getStraightPath, useInternalNode,
  type EdgeProps, type InternalNode,
} from '@xyflow/react';

/** 节点中心 */
export function centerOf(node: InternalNode): { x: number; y: number } {
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? 96) / 2,
    y: node.internals.positionAbsolute.y + (node.measured.height ?? 100) / 2,
  };
}

/** 从节点中心朝 toward 方向与节点矩形边框的交点 */
export function borderPoint(node: InternalNode, toward: { x: number; y: number }): { x: number; y: number } {
  const c = centerOf(node);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = (node.measured.width ?? 96) / 2 + 2;
  const hh = (node.measured.height ?? 100) / 2 + 2;
  const s = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/**
 * 浮动边:忽略固定把手,始终沿两节点边框最短方向连线;同对节点的多条边做垂直位移分开。
 *
 * 关系图与风暴板共用 —— 两处都是「随手连、位置随时拖」的图,固定左右把手会让
 * 反向的连线绕一大圈,也逼着用户按左→右的顺序摆卡片。
 */
export function FloatingEdge({ id, source, target, markerEnd, style, label, selected, data }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const cs = centerOf(sourceNode);
  const ct = centerOf(targetNode);
  const p1 = borderPoint(sourceNode, ct);
  const p2 = borderPoint(targetNode, cs);
  const siblingIndex = (data as { siblingIndex?: number } | undefined)?.siblingIndex ?? 0;
  const siblingCount = (data as { siblingCount?: number } | undefined)?.siblingCount ?? 1;
  const spacing = 22;
  const offset = (siblingIndex - (siblingCount - 1) / 2) * spacing;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  // 垂直单位向量(逆时针 90°)
  const nx = -dy / len;
  const ny = dx / len;
  const sx = p1.x + nx * offset;
  const sy = p1.y + ny * offset;
  const tx = p2.x + nx * offset;
  const ty = p2.y + ny * offset;
  const [path, labelX, labelY] = getStraightPath({
    sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd as string | undefined} style={style} />
      {label != null && label !== '' && (
        <EdgeLabelRenderer>
          <div
            className={`rel-edge-label ${selected ? 'selected' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >{label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const floatingEdgeTypes = { floating: FloatingEdge };
