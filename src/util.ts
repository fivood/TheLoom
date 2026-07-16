import type {
  DocBlock, DocChoice, FlowEdge, FlowNode, NarrativeUnit, NarrativeUnitKind, Project, SubFlow,
} from './types';
import type { AssetKind } from './types';
import { PALETTE } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** 兼容旧版本数据:补齐后加字段 */
export function normalizeProject(p: Project): Project {
  p.flows ??= [];
  p.entities ??= [];
  p.brainstormNotes ??= [];
  p.brainstormEdges ??= [];
  p.outlineColumns ??= [];
  p.outlineRows ??= [];
  p.timelineTracks ??= [];
  p.timelinePoints ??= [];
  p.timelineEvents ??= [];
  p.maps ??= [];
  p.researchCards ??= [];
  p.researchCategories ??= [];
  p.variables ??= [];
  p.entityTemplates ??= {};
  p.assets ??= [];
  p.documents ??= [];
  p.documentCategories ??= [];
  p.attachments ??= {};
  p.folders ??= [];
  p.nodeTemplates ??= {};
  p.palettes ??= [];
  const folderById = new Map(p.folders.map((folder) => [folder.id, folder]));
  for (const folder of p.folders) {
    const parent = folder.parentId ? folderById.get(folder.parentId) : null;
    if (folder.parentId === folder.id || (folder.parentId && (!parent || parent.module !== folder.module))) {
      folder.parentId = null;
    }
  }
  for (const folder of p.folders) {
    const seen = new Set<string>([folder.id]);
    let current = folder;
    while (current.parentId) {
      if (seen.has(current.parentId)) {
        folder.parentId = null;
        break;
      }
      seen.add(current.parentId);
      const parent = folderById.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
  }
  const cleanAssignments = (items: { folderId?: string }[], module: import('./types').FolderModule) => {
    for (const item of items) {
      if (item.folderId && folderById.get(item.folderId)?.module !== module) item.folderId = undefined;
    }
  };
  cleanAssignments(p.flows, 'flow');
  cleanAssignments(p.entities, 'entity');
  cleanAssignments(p.assets, 'asset');
  cleanAssignments(p.documents, 'document');
  cleanAssignments(p.researchCards, 'research');
  // 规范化 order:非有限数字直接剔除,让旧项目保持默认排序
  const cleanOrder = (items: { order?: unknown }[]) => {
    for (const item of items) {
      if (item.order !== undefined && (typeof item.order !== 'number' || !Number.isFinite(item.order))) {
        delete item.order;
      }
    }
  };
  cleanOrder(p.folders);
  cleanOrder(p.flows);
  cleanOrder(p.entities);
  cleanOrder(p.assets);
  cleanOrder(p.documents);
  cleanOrder(p.researchCards);
  syncNarrativeUnits(p);
  return p;
}

/* ---------- 叙事单元同步(R1) ---------- */

/**
 * 单元视角下的内容投影。undefined 字段表示该引用者不管理这块内容
 * (例如文档场景块只管理 title,不动 text)。
 */
interface UnitContent {
  kind: NarrativeUnitKind;
  title?: string;
  text?: string;
  manageSpeaker?: boolean;
  speakerId?: string;
  choices?: DocChoice[];
}

function contentOfBlock(b: DocBlock): UnitContent | null {
  switch (b.type) {
    case 'heading': return { kind: 'scene', title: b.text };
    case 'action': return { kind: 'line', text: b.text };
    case 'dialogue': return { kind: 'line', text: b.text, manageSpeaker: true, speakerId: b.speakerId };
    case 'choice': return { kind: 'choice', text: b.text, choices: b.choices ?? [] };
    case 'condition': return { kind: 'condition', text: b.condition ?? '' };
    case 'instruction': return { kind: 'instruction', text: b.instruction ?? '' };
    default: return null;
  }
}

function contentOfNode(n: FlowNode): UnitContent | null {
  switch (n.type) {
    case 'fragment': return { kind: 'scene', title: n.data.title, text: n.data.text };
    case 'dialogue': return { kind: 'line', title: n.data.title, text: n.data.text, manageSpeaker: true, speakerId: n.data.speakerId };
    case 'condition': return { kind: 'condition', text: n.data.text };
    case 'instruction': return { kind: 'instruction', text: n.data.text };
    // 汇聚点本身没有内容,只有由文档「选项」块转换而来的才共享单元
    case 'hub': return n.data.unitId ? { kind: 'choice', text: n.data.title } : null;
    default: return null;
  }
}

function unitDiffers(u: NarrativeUnit, c: UnitContent): boolean {
  if (u.kind !== c.kind) return true;
  if (c.title !== undefined && u.title !== c.title) return true;
  if (c.text !== undefined && u.text !== c.text) return true;
  if (c.manageSpeaker && (u.speakerId ?? undefined) !== (c.speakerId ?? undefined)) return true;
  if (c.choices !== undefined && JSON.stringify(u.choices ?? []) !== JSON.stringify(c.choices)) return true;
  return false;
}

function applyContent(u: NarrativeUnit, c: UnitContent) {
  u.kind = c.kind;
  if (c.title !== undefined) u.title = c.title;
  if (c.text !== undefined) u.text = c.text;
  if (c.manageSpeaker) u.speakerId = c.speakerId ?? undefined;
  if (c.choices !== undefined) u.choices = structuredClone(c.choices);
  u.updatedAt = Date.now();
}

function createUnit(id: string, c: UnitContent): NarrativeUnit {
  const now = Date.now();
  return {
    id,
    kind: c.kind,
    title: c.title ?? '',
    text: c.text ?? '',
    speakerId: c.manageSpeaker ? c.speakerId ?? undefined : undefined,
    choices: c.choices !== undefined ? structuredClone(c.choices) : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

function writeBlockFromUnit(b: DocBlock, u: NarrativeUnit) {
  switch (b.type) {
    case 'heading': b.text = u.title; break;
    case 'action': b.text = u.text; break;
    case 'dialogue': b.text = u.text; b.speakerId = u.speakerId; break;
    case 'choice': b.text = u.text; b.choices = structuredClone(u.choices ?? []); break;
    case 'condition': b.condition = u.text; break;
    case 'instruction': b.instruction = u.text; break;
  }
}

function writeNodeFromUnit(n: FlowNode, u: NarrativeUnit) {
  switch (n.type) {
    case 'fragment': n.data.title = u.title; n.data.text = u.text; break;
    case 'dialogue': n.data.title = u.title; n.data.text = u.text; n.data.speakerId = u.speakerId; break;
    case 'condition':
    case 'instruction': n.data.text = u.text; break;
    case 'hub': n.data.title = u.text; break;
  }
}

/** 遍历流程节点(含所有层级的子流程) */
export function walkFlowNodes(nodes: FlowNode[], fn: (n: FlowNode) => void) {
  for (const n of nodes) {
    fn(n);
    if (n.data.sub) walkFlowNodes(n.data.sub.nodes, fn);
  }
}

interface UnitRef {
  key: string;
  unitId: string | undefined;
  content: UnitContent;
  attach: (unitId: string) => void;
  write: (u: NarrativeUnit) => void;
}

/**
 * 叙事单元同步器:迁移 + 变更传播 + 镜像刷新 + 回收。
 *
 * - 无 unitId 的剧本块 / 叙事节点自动建单元(旧项目迁移与新建对象共用此路径)
 * - unitId 指向的单元丢失时按当前内容原 id 重建,旧引用不断裂
 * - 传入 prev(上一次 commit 前的项目)时按前后差异判定哪一侧发生编辑,
 *   把编辑写入单元;不传 prev(加载 / 导入)时以与单元不一致的内容为准,
 *   文档块后应用,即文档优先(覆盖外部 Obsidian 编辑的场景)
 * - 最后所有引用者的镜像字段统一从单元刷新,并回收无人引用的单元
 */
export function syncNarrativeUnits(p: Project, prev?: Project): void {
  p.units ??= [];
  const unitById = new Map(p.units.map((u) => [u.id, u]));

  const docRefs: UnitRef[] = [];
  const nodeRefs: UnitRef[] = [];
  for (const d of p.documents ?? []) {
    for (const b of d.blocks) {
      const content = contentOfBlock(b);
      if (!content) continue;
      docRefs.push({
        key: `b:${b.id}`,
        unitId: b.unitId,
        content,
        attach: (id) => { b.unitId = id; },
        write: (u) => writeBlockFromUnit(b, u),
      });
    }
  }
  for (const f of p.flows ?? []) {
    walkFlowNodes(f.nodes, (n) => {
      const content = contentOfNode(n);
      if (!content) return;
      nodeRefs.push({
        key: `n:${n.id}`,
        unitId: typeof n.data.unitId === 'string' ? n.data.unitId : undefined,
        content,
        attach: (id) => { n.data.unitId = id; },
        write: (u) => writeNodeFromUnit(n, u),
      });
    });
  }

  // 建单元 / 修复断裂引用:文档块先行,共享单元以文档内容为种子
  for (const r of [...docRefs, ...nodeRefs]) {
    let u = r.unitId ? unitById.get(r.unitId) : undefined;
    if (!u) {
      u = createUnit(r.unitId ?? uid(), r.content);
      p.units.push(u);
      unitById.set(u.id, u);
      r.attach(u.id);
      r.unitId = u.id;
    }
  }

  // 上一状态的内容投影,用于判定本次 commit 改动了哪一侧
  const prevContents = new Map<string, string>();
  if (prev) {
    for (const d of prev.documents ?? []) {
      for (const b of d.blocks) {
        const c = contentOfBlock(b);
        if (c) prevContents.set(`b:${b.id}`, JSON.stringify(c));
      }
    }
    for (const f of prev.flows ?? []) {
      walkFlowNodes(f.nodes, (n) => {
        const c = contentOfNode(n);
        if (c) prevContents.set(`n:${n.id}`, JSON.stringify(c));
      });
    }
  }

  // 变更传播:节点先应用、文档块后应用 → 同一 commit 双侧冲突时文档胜
  for (const r of [...nodeRefs, ...docRefs]) {
    const u = unitById.get(r.unitId!)!;
    if (!unitDiffers(u, r.content)) continue;
    if (prev) {
      const before = prevContents.get(r.key);
      // 新引用者(如刚由转换生成)以单元为准;内容未变的引用者不回写
      if (before === undefined || before === JSON.stringify(r.content)) continue;
    }
    applyContent(u, r.content);
  }

  // 镜像刷新 + 回收无人引用的单元
  const referenced = new Set<string>();
  for (const r of [...docRefs, ...nodeRefs]) {
    const u = unitById.get(r.unitId!)!;
    r.write(u);
    referenced.add(u.id);
  }
  if (p.units.length !== referenced.size) {
    p.units = p.units.filter((u) => referenced.has(u.id));
  }
}

/* ---------- 配色表 ---------- */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** 校验并规范化 hex(补 #、扩展 3 位为 6 位、小写);无效返回 null */
export function normalizeHex(raw: string): string | null {
  const s = raw.trim();
  const withHash = s.startsWith('#') ? s : `#${s}`;
  if (!HEX_RE.test(withHash)) return null;
  if (withHash.length === 4) {
    const [, r, g, b] = withHash;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return withHash.toLowerCase();
}

/** 项目当前生效的配色表颜色数组:激活的自定义 > 默认灰阶 */
export function activePaletteColors(p: Project): string[] {
  const list = p.palettes ?? [];
  const active = p.activePaletteId ? list.find((x) => x.id === p.activePaletteId) : null;
  if (active && active.colors.length > 0) return active.colors;
  return PALETTE;
}

/**
 * 解析 zimg Color Palette 导出的 JSON:
 *   [{ name: "封面图.jpg", colors: ["#hex", ...] }, ...]
 * 也接受单个对象或纯 hex 数组作为宽容格式,失败返回空数组
 */
export function parsePaletteJson(text: string): { name: string; colors: string[] }[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const out: { name: string; colors: string[] }[] = [];
  const pushItem = (name: string, colorsRaw: unknown) => {
    if (!Array.isArray(colorsRaw)) return;
    const colors = colorsRaw
      .map((c) => (typeof c === 'string' ? normalizeHex(c) : null))
      .filter((c): c is string => !!c);
    if (colors.length > 0) out.push({ name: name || '未命名配色', colors });
  };
  if (Array.isArray(raw)) {
    // 纯 hex 数组
    if (raw.every((x) => typeof x === 'string')) {
      pushItem('导入配色', raw);
    } else {
      for (const item of raw) {
        const o = item as Record<string, unknown>;
        pushItem(typeof o.name === 'string' ? o.name : '', o.colors);
      }
    }
  } else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    pushItem(typeof o.name === 'string' ? o.name : '', o.colors);
  }
  return out;
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
