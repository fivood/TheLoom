import type { FlowEdge, FlowNode, Project, SubFlow } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** 兼容旧版本数据:补齐后加字段 */
export function normalizeProject(p: Project): Project {
  p.timelineTracks ??= [];
  p.timelinePoints ??= [];
  p.timelineEvents ??= [];
  return p;
}

/** 图片文件 → 128px 方形头像 dataURL(居中裁剪) */
export function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 128;
      const s = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    img.src = url;
  });
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
