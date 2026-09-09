import { useRef } from 'react';
import {
  BaseEdge, EdgeLabelRenderer, useInternalNode, useReactFlow,
  type EdgeProps, type InternalNode,
} from '@xyflow/react';
import {
  curveControl, curvedPath, dragCurve, isCurved, sanitizeCurve,
  type EdgeCurve, type Point,
} from '../edgeCurve';

/** 节点中心 */
export function centerOf(node: InternalNode): Point {
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? 96) / 2,
    y: node.internals.positionAbsolute.y + (node.measured.height ?? 100) / 2,
  };
}

/** 从节点中心朝 toward 方向与节点矩形边框的交点 */
export function borderPoint(node: InternalNode, toward: Point): Point {
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
 *
 * `data.bendable` 为真时,选中一条边会在中段出现一个手柄,拖它把线弯开绕过挡路的卡片
 * (同 PPT 的连接符调整点),双击手柄恢复直线。弯度存在 `data.curve` 里,由调用方负责持久化。
 * 不开 bendable 时行为与不支持弯度时**逐字节一致**,关系图不接也不受影响。
 */
export function FloatingEdge({ id, source, target, markerEnd, style, label, selected, data }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const { updateEdgeData, getZoom } = useReactFlow();
  // 拖拽起点与起始弯度:用 ref 存,避免每次 pointermove 都重建监听
  const dragRef = useRef<{ x: number; y: number; curve?: EdgeCurve } | null>(null);
  if (!sourceNode || !targetNode) return null;

  const curve = sanitizeCurve((data as { curve?: unknown } | undefined)?.curve);
  const cs = centerOf(sourceNode);
  const ct = centerOf(targetNode);
  const centerMid = { x: (cs.x + ct.x) / 2, y: (cs.y + ct.y) / 2 };

  const siblingIndex = (data as { siblingIndex?: number } | undefined)?.siblingIndex ?? 0;
  const siblingCount = (data as { siblingCount?: number } | undefined)?.siblingCount ?? 1;
  const spacing = 22;
  const sibling = (siblingIndex - (siblingCount - 1) / 2) * spacing;

  /*
   * 边框交点要朝**控制点**求,不是朝对方中心 —— 弯得厉害时朝中心求会让线从
   * 卡片的错误一侧钻出去,看着像穿模。
   */
  const ctrlRaw = curveControl(centerMid, curve);
  const p1raw = borderPoint(sourceNode, ctrlRaw);
  const p2raw = borderPoint(targetNode, ctrlRaw);

  // 同对节点的多条边:整体沿垂直方向错开
  const dx = p2raw.x - p1raw.x;
  const dy = p2raw.y - p1raw.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * sibling;
  const ny = (dx / len) * sibling;
  const p1 = { x: p1raw.x + nx, y: p1raw.y + ny };
  const p2 = { x: p2raw.x + nx, y: p2raw.y + ny };
  const ctrl = { x: ctrlRaw.x + nx, y: ctrlRaw.y + ny };

  const { path, handle } = curvedPath(p1, p2, ctrl, curve);
  /*
   * 手柄要调用方显式开关 —— 关系图的 edges 是 useMemo 派生的,没有 onEdgesChange,
   * updateEdgeData 写进去的弯度下次重算就没了。给个永远拖不住的手柄比没有更糟。
   */
  const canBend = (data as { bendable?: boolean } | undefined)?.bendable === true;

  const onHandleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY, curve };
    const zoom = getZoom() || 1;
    const onMove = (ev: PointerEvent) => {
      const start = dragRef.current;
      if (!start) return;
      // 屏幕位移换算回画布坐标 —— 缩放下不除的话手柄会跑在光标前面
      const delta = { x: (ev.clientX - start.x) / zoom, y: (ev.clientY - start.y) / zoom };
      updateEdgeData(id, { curve: dragCurve(start.curve, delta) });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      /*
       * 松手后浏览器还会补发一个 click,它冒泡到 React Flow 的 pane 上 ——
       * pane 的 onClick 无条件调 resetSelectedElements(),这条边当场取消选中、
       * 手柄跟着消失,想再调一下得重新点中连线。捕获阶段吃掉这一个 click。
       * timeout 0 在同一批输入事件派发完之后才跑,所以没有 click 时也不会留下监听。
       */
      const eatClick = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener('click', eatClick, true);
      setTimeout(() => window.removeEventListener('click', eatClick, true), 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd as string | undefined} style={style} />
      <EdgeLabelRenderer>
        {label != null && label !== '' && (
          <div
            className={`rel-edge-label ${selected ? 'selected' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${handle.x}px, ${handle.y}px)`,
              // 有手柄时标签让开一点,免得叠在一起点不中
              marginTop: selected && canBend ? -16 : 0,
            }}
          >{label}</div>
        )}
        {selected && canBend && (
          <div
            className={`edge-curve-handle nodrag nopan ${isCurved(curve) ? 'on' : ''}`}
            title="拖动绕开挡路的卡片;双击恢复直线"
            style={{ transform: `translate(-50%, -50%) translate(${handle.x}px, ${handle.y}px) rotate(45deg)` }}
            onPointerDown={onHandleDown}
            onDoubleClick={(e) => { e.stopPropagation(); updateEdgeData(id, { curve: undefined }); }}
          />
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const floatingEdgeTypes = { floating: FloatingEdge };
