import type { FlowEdge, FlowNode, Project, SubFlow } from './types';
import type { AssetKind } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** 兼容旧版本数据:补齐后加字段 */
export function normalizeProject(p: Project): Project {
  p.timelineTracks ??= [];
  p.timelinePoints ??= [];
  p.timelineEvents ??= [];
  p.maps ??= [];
  p.entityTemplates ??= {};
  p.assets ??= [];
  p.documents ??= [];
  p.documentCategories ??= [];
  p.attachments ??= {};
  p.folders ??= [];
  p.nodeTemplates ??= {};
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

/* ---------- 通用附件映射 ---------- */

export function getAttachments(p: Project, ownerId: string): string[] {
  return p.attachments?.[ownerId] ?? [];
}

export function setAttachments(p: Project, ownerId: string, ids: string[]) {
  p.attachments ??= {};
  if (ids.length) p.attachments[ownerId] = ids;
  else delete p.attachments[ownerId];
}

/** 从所有 attachments 引用中移除某个 asset id(资源被删除时调用) */
export function detachAssetEverywhere(p: Project, assetId: string) {
  if (!p.attachments) return;
  for (const key of Object.keys(p.attachments)) {
    const arr = p.attachments[key].filter((x) => x !== assetId);
    if (arr.length) p.attachments[key] = arr;
    else delete p.attachments[key];
  }
}

/** 给任意对象追加 / 移除附件,返回新数组(不可变更新便于 React 渲染) */
export function addAttachment(p: Project, ownerId: string, assetId: string): string[] {
  const cur = getAttachments(p, ownerId);
  if (cur.includes(assetId)) return cur;
  const next = [...cur, assetId];
  setAttachments(p, ownerId, next);
  return next;
}

export function removeAttachment(p: Project, ownerId: string, assetId: string): string[] {
  const cur = getAttachments(p, ownerId);
  const next = cur.filter((x) => x !== assetId);
  setAttachments(p, ownerId, next);
  return next;
}

/* ---------- 资源文件处理 ---------- */

/** 文件类型 → 资源类型 */
export function classifyAsset(file: File): AssetKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'file';
}

/** 图片文件 → 压缩缩略图 dataURL(默认 256px JPEG),用于网页模式内嵌与列表预览 */
export function fileToImageThumb(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    img.src = url;
  });
}

/** 字节数 → 人类可读 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ---------- 技术名 ---------- */

const TECH_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 从显示名生成技术名:取字母数字,空格转下划线,小写;纯中文等无字母时返回空串 */
export function sanitizeTechnicalName(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9_\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^[0-9]+/, (m) => `_${m}`);
  return cleaned.slice(0, 40);
}

/** 校验技术名:合法返回 null,否则返回错误信息 */
export function validateTechnicalName(name: string): string | null {
  if (!name) return null;
  if (name.length > 64) return '技术名过长(≤64 字符)';
  if (!TECH_NAME_RE.test(name)) return '只能含字母、数字、下划线,且不能以数字开头';
  return null;
}

export interface TechNameOwner { kind: string; id: string; name: string; ownerId: string }
export interface TechNameDuplicate { name: string; owners: TechNameOwner[] }

/** 收集项目内所有技术名及归属,用于冲突检测 */
export function collectTechnicalNames(p: Project): { name: string; owner: TechNameOwner }[] {
  const out: { name: string; owner: TechNameOwner }[] = [];
  const push = (kind: string, id: string, name: string, tn: string | undefined) => {
    if (tn) out.push({ name: tn, owner: { kind, id, name, ownerId: id } });
  };
  for (const e of p.entities) push('实体', e.id, e.name, e.technicalName);
  for (const f of p.flows) push('流程', f.id, f.name, f.technicalName);
  for (const a of p.assets) push('资源', a.id, a.name, a.technicalName);
  for (const d of p.documents) push('文档', d.id, d.name, d.technicalName);
  return out;
}

/** 找出重复的技术名 */
export function findDuplicateTechnicalNames(p: Project): TechNameDuplicate[] {
  const map = new Map<string, TechNameOwner[]>();
  for (const { name, owner } of collectTechnicalNames(p)) {
    const arr = map.get(name) ?? [];
    arr.push(owner);
    map.set(name, arr);
  }
  return [...map.entries()].filter(([, arr]) => arr.length > 1).map(([name, owners]) => ({ name, owners }));
}
