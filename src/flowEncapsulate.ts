import type { FlowEdge, FlowNode, SubFlow } from './types';
import { ANNOTATION_TYPES } from './types';

/**
 * R19-5 从选区封装为剧情片段。
 *
 * 难点全在跨边界的连线上:
 *   - 内部边(两端都在选区)→ 跟着搬进子流程
 *   - 入边(外 → 内)→ 改接到新的片段节点
 *   - 出边(内 → 外)→ 片段需要一个出口(exit)承接,父层用命名引脚接出去
 *   - 外部边(两端都在外)→ 原样不动
 *
 * 出口按「内部源节点」分组:同一个内部节点连出去的多条边共用一个出口,
 * 这样父层引脚数等于真实的出口语义数,而不是边数。
 */

export interface EncapsulateInput {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** 要封装的节点 id */
  selectedIds: string[];
  /** 生成新 id;调用方传入以便测试确定性 */
  newId: () => string;
  /** 片段节点标题 */
  title?: string;
}

export interface EncapsulateResult {
  ok: boolean;
  /** ok=false 时说明原因 */
  reason?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** 新建的片段节点 id */
  fragmentId?: string;
  /** 生成的出口个数 */
  exitCount?: number;
}

/** 选区的包围盒中心,用来放置片段节点 */
function centerOf(nodes: FlowNode[]): { x: number; y: number } {
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

export function encapsulateSelection(input: EncapsulateInput): EncapsulateResult {
  const { nodes, edges, newId } = input;
  const selected = new Set(input.selectedIds);
  const inner = nodes.filter((n) => selected.has(n.id));
  const outer = nodes.filter((n) => !selected.has(n.id));

  if (inner.length === 0) {
    return { ok: false, reason: '没有选中任何节点', nodes, edges };
  }
  if (inner.every((n) => ANNOTATION_TYPES.has(n.type))) {
    return { ok: false, reason: '选区里只有注释 / 分区,没有可封装的叙事节点', nodes, edges };
  }
  if (inner.length === nodes.length) {
    return { ok: false, reason: '不能把整个流程封装进它自己的片段', nodes, edges };
  }

  const innerEdges: FlowEdge[] = [];
  const incoming: FlowEdge[] = [];
  const outgoing: FlowEdge[] = [];
  const untouched: FlowEdge[] = [];
  for (const e of edges) {
    const si = selected.has(e.source);
    const ti = selected.has(e.target);
    if (si && ti) innerEdges.push(e);
    else if (!si && ti) incoming.push(e);
    else if (si && !ti) outgoing.push(e);
    else untouched.push(e);
  }

  const fragmentId = newId();
  const sub: SubFlow = {
    // 位置相对化:以选区左上角为原点,子流程里布局才不会挤在角落或飞出视野
    nodes: inner.map((n) => ({ ...structuredClone(n), position: { ...n.position } })),
    edges: innerEdges.map((e) => structuredClone(e)),
  };
  const minX = Math.min(...inner.map((n) => n.position.x));
  const minY = Math.min(...inner.map((n) => n.position.y));
  for (const n of sub.nodes) {
    n.position = { x: n.position.x - minX + 60, y: n.position.y - minY + 60 };
  }

  // 出边按内部源节点分组 → 每组一个出口
  const bySource = new Map<string, FlowEdge[]>();
  for (const e of outgoing) {
    const list = bySource.get(e.source) ?? [];
    list.push(e);
    bySource.set(e.source, list);
  }

  const newOuterEdges: FlowEdge[] = [...untouched];
  let exitIndex = 0;
  for (const [sourceId, group] of bySource) {
    const exitId = newId();
    exitIndex += 1;
    const sourceNode = inner.find((n) => n.id === sourceId);
    const exitTitle = sourceNode?.data.title?.trim() || `出口 ${exitIndex}`;
    const srcInSub = sub.nodes.find((n) => n.id === sourceId)!;
    sub.nodes.push({
      id: exitId,
      type: 'exit',
      position: { x: srcInSub.position.x + 220, y: srcInSub.position.y },
      data: { title: exitTitle, text: '' },
    });
    // 内部源 → 出口
    sub.edges.push({ id: newId(), source: sourceId, target: exitId });
    // 父层:片段的命名引脚 → 原来的外部目标(保留标签与逻辑字段)
    for (const e of group) {
      newOuterEdges.push({
        ...structuredClone(e),
        id: newId(),
        source: fragmentId,
        sourceHandle: `exit:${exitId}`,
      });
    }
  }

  // 入边改接到片段节点(去掉 sourceHandle 之外的目标侧引脚)
  for (const e of incoming) {
    newOuterEdges.push({ ...structuredClone(e), id: newId(), target: fragmentId, targetHandle: undefined });
  }

  const center = centerOf(inner);
  const fragment: FlowNode = {
    id: fragmentId,
    type: 'fragment',
    position: { x: center.x, y: center.y },
    data: { title: input.title?.trim() || '新剧情片段', text: '', sub },
  };

  return {
    ok: true,
    nodes: [...outer, fragment],
    edges: newOuterEdges,
    fragmentId,
    exitCount: bySource.size,
  };
}
