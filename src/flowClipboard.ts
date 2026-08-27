import type { FlowNodeData } from './types';

/**
 * 粘贴时的身份重铸。
 *
 * 复制粘贴是「造一份新的」,不是「让两处指向同一份」,所以复制出来的节点必须换掉
 * 全部身份标识,而且要一路换到子流程深处 —— `walkFlowNodes` 会递归进 `data.sub`,
 * 体检的重复技术名检查、`seen()` 的技术名→id 映射、叙事单元同步、断点、
 * 路径遍历的节点表全都把嵌套节点当一等公民。只换最外层等于没换。
 *
 * 两样必须清掉:
 * - `technicalName`:项目内唯一,复制过来必然重复
 * - `unitId`:R1 的叙事单元是**共享内容**,留着的话改副本会同时改原件
 */

interface ClipNode {
  id: string;
  position: { x: number; y: number };
  data: FlowNodeData;
}

interface ClipEdge {
  id: string;
  source: string;
  target: string;
}

function recastSub(data: FlowNodeData, newId: () => string): void {
  delete data.technicalName;
  delete data.unitId;
  const sub = data.sub;
  if (!sub) return;
  const idMap = new Map<string, string>();
  for (const n of sub.nodes) idMap.set(n.id, newId());
  for (const n of sub.nodes) {
    n.id = idMap.get(n.id)!;
    recastSub(n.data, newId);
  }
  for (const e of sub.edges) {
    e.id = newId();
    e.source = idMap.get(e.source) ?? e.source;
    e.target = idMap.get(e.target) ?? e.target;
  }
}

/**
 * @param offset 整体偏移量,让粘贴出来的一簇不完全盖住原件
 * @returns 全新 id 的节点与内部连线;入参不被修改
 */
export function recastPasted<N extends ClipNode, E extends ClipEdge>(
  nodes: N[], edges: E[], offset: number, newId: () => string,
): { nodes: N[]; edges: E[] } {
  const idMap = new Map<string, string>();
  for (const n of nodes) idMap.set(n.id, newId());
  const outNodes = nodes.map((n) => {
    const copy = structuredClone(n);
    copy.id = idMap.get(n.id)!;
    copy.position = { x: n.position.x + offset, y: n.position.y + offset };
    recastSub(copy.data, newId);
    return copy;
  });
  const outEdges = edges.map((e) => {
    const copy = structuredClone(e);
    copy.id = newId();
    copy.source = idMap.get(e.source) ?? e.source;
    copy.target = idMap.get(e.target) ?? e.target;
    return copy;
  });
  return { nodes: outNodes, edges: outEdges };
}
