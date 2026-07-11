import type { FlowEdge, FlowNode, Project, SubFlow } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** 兼容旧版本数据:补齐后加字段 */
export function normalizeProject(p: Project): Project {
  p.timelineTracks ??= [];
  p.timelinePoints ??= [];
  p.timelineEvents ??= [];
  return p;
}

/** 递归统计子流程内的节点总数(含所有层级) */
export function countSubNodes(sub?: SubFlow): number {
  if (!sub) return 0;
  let n = sub.nodes.length;
  for (const node of sub.nodes) n += countSubNodes(node.data.sub);
  return n;
}

interface FlowLike {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * 按节点 id 路径深入子流程。
 * ensure = true 时为途经节点补建空子流程(用于写入);
 * 路径断裂(节点已被删除)返回 null。
 */
export function resolveSub(root: FlowLike, path: string[], ensure = false): FlowLike | null {
  let cur: FlowLike = root;
  for (const id of path) {
    const n = cur.nodes.find((x) => x.id === id);
    if (!n) return null;
    if (!n.data.sub) {
      if (!ensure) return { nodes: [], edges: [] };
      n.data.sub = { nodes: [], edges: [] };
    }
    cur = n.data.sub;
  }
  return cur;
}
