/**
 * 通用游戏引擎导出(R9)—— 把项目打成带版本的引擎包 JSON。
 *
 * - 引擎包与独立运行库(src/runtime)的输入类型兼容:引擎读 JSON 即可演出
 * - 导出规则:选流程 / 剥画布注释 / 剥布局 / 实体与资源可只导被引用的
 * - 引用索引:技术名表、节点定位表、说话人反查、资源挂接反查
 * - 内容哈希清单:FNV-1a 64 位,支持与上次导出对比、产出增量包
 */
import type { Entity, FlowEdge, FlowNode, Project, SubFlow } from '../types';
import { ANNOTATION_TYPES } from '../types';
import { assetFileName } from '../assetFiles';

export const ENGINE_SCHEMA_VERSION = '1.0.0';

/* ---------- 包类型 ---------- */

export interface EngineExportRules {
  /** 要导出的流程 id;缺省 / 空数组 = 全部 */
  flowIds?: string[];
  /** 保留画布布局(position / 尺寸 / 颜色);默认剥除 */
  includeLayout?: boolean;
  /** 保留注释 / 分区节点;默认剥除(它们不参与演出) */
  includeAnnotations?: boolean;
  /** 实体范围:全部 / 仅被导出流程引用(说话人 + 引用字段闭包);默认全部 */
  entities?: 'all' | 'referenced';
  /** 资源范围:全部 / 仅被导出对象挂接;默认全部 */
  assets?: 'all' | 'referenced';
}

export interface EngineNodeData {
  title?: string;
  text?: string;
  speakerId?: string;
  technicalName?: string;
  checkExpr?: string;
  checkDc?: number;
  checkRed?: boolean;
  sub?: EngineSub;
  fields?: { label: string; value: string; type?: string }[];
  color?: string;
  w?: number;
  h?: number;
}

export interface EngineNode {
  id: string;
  type: string;
  data: EngineNodeData;
  position?: { x: number; y: number };
}

export interface EngineEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  label?: string;
  condition?: string;
  effect?: string;
  once?: boolean;
  fallback?: boolean;
}

export interface EngineSub { nodes: EngineNode[]; edges: EngineEdge[] }

export interface EngineFlow extends EngineSub {
  id: string;
  name: string;
  technicalName?: string;
}

export interface EngineEntity {
  id: string;
  name: string;
  kind: string;
  technicalName?: string;
  color?: string;
  emoji?: string;
  summary?: string;
  fields: { label: string; value: string; type?: string; filterKind?: string }[];
}

export interface EngineAsset {
  id: string;
  name: string;
  kind: string;
  mime: string;
  size: number;
  technicalName?: string;
  /** 原文件 SHA-256(R8);引擎按 fileName 在项目文件夹 assets/ 找到字节 */
  hash?: string;
  ext?: string;
  license?: string;
  source?: string;
  fileName?: string;
}

export interface EngineVariable {
  name: string;
  type: string;
  value: string;
  description?: string;
}

export interface EngineIndex {
  /** 技术名 → 归属(节点带 flowId) */
  technicalNames: Record<string, { kind: 'flow' | 'entity' | 'asset' | 'node'; id: string; flowId?: string }>;
  /** 节点 id → 定位(flowId + 子流程容器路径 + 类型) */
  nodes: Record<string, { flowId: string; path: string[]; type: string }>;
  /** 实体 id → 作为说话人出现的节点 id 列表 */
  speakers: Record<string, string[]>;
  /** 资源 id → 挂接它的对象 id 列表 */
  assetOwners: Record<string, string[]>;
}

export interface EnginePackage {
  schema: 'theloom-package';
  schemaVersion: string;
  meta: {
    projectName: string;
    exportedAt: number;
    generator: string;
  };
  rules: Required<Pick<EngineExportRules, 'includeLayout' | 'includeAnnotations' | 'entities' | 'assets'>>;
  variables: EngineVariable[];
  entities: EngineEntity[];
  flows: EngineFlow[];
  assets: EngineAsset[];
  /** 对象 id(流程 / 各层节点 / 实体) → 资源 id 列表 */
  attachments: Record<string, string[]>;
  index: EngineIndex;
  /** 增量导出用:对象键(kind:id) → 内容哈希 */
  manifest: Record<string, string>;
}

/** 增量包:相对上一份 manifest 的变化 */
export interface EngineDelta {
  schema: 'theloom-delta';
  schemaVersion: string;
  meta: { projectName: string; exportedAt: number; generator: string };
  changed: {
    variables?: EngineVariable[];
    entities: EngineEntity[];
    flows: EngineFlow[];
    assets: EngineAsset[];
  };
  removed: string[];
}

/* ---------- 内容哈希(FNV-1a 64 位,双 32 位实现) ---------- */

export function contentHash(value: unknown): string {
  const s = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c >> 8) | (c << 3)), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/* ---------- 构建 ---------- */

function cloneNode(n: FlowNode, rules: EngineExportRules): EngineNode {
  const data: EngineNodeData = {};
  if (n.data.title) data.title = n.data.title;
  if (n.data.text) data.text = n.data.text;
  if (n.data.speakerId) data.speakerId = n.data.speakerId;
  if (n.data.technicalName) data.technicalName = n.data.technicalName;
  if (n.data.checkExpr) data.checkExpr = n.data.checkExpr;
  if (typeof n.data.checkDc === 'number') data.checkDc = n.data.checkDc;
  if (n.data.checkRed === true) data.checkRed = true;
  if (Array.isArray(n.data.fields) && n.data.fields.length > 0) {
    data.fields = n.data.fields.map((f) => {
      const out: { label: string; value: string; type?: string } = { label: f.label, value: f.value };
      if (f.type) out.type = f.type;
      return out;
    });
  }
  if (rules.includeLayout) {
    if (typeof n.data.color === 'string') data.color = n.data.color;
    if (typeof n.data.w === 'number') data.w = n.data.w;
    if (typeof n.data.h === 'number') data.h = n.data.h;
  }
  if (n.data.sub) data.sub = cloneSub(n.data.sub, rules);
  const out: EngineNode = { id: n.id, type: n.type, data };
  if (rules.includeLayout) out.position = { x: n.position.x, y: n.position.y };
  return out;
}

function cloneSub(sub: SubFlow, rules: EngineExportRules): EngineSub {
  const keepNodes = sub.nodes.filter((n) => rules.includeAnnotations || !ANNOTATION_TYPES.has(n.type));
  const kept = new Set(keepNodes.map((n) => n.id));
  return {
    nodes: keepNodes.map((n) => cloneNode(n, rules)),
    edges: sub.edges.filter((e) => kept.has(e.source) && kept.has(e.target)).map((e) => cloneEdge(e)),
  };
}

function cloneEdge(e: FlowEdge): EngineEdge {
  const out: EngineEdge = { id: e.id, source: e.source, target: e.target };
  if (e.sourceHandle) out.sourceHandle = e.sourceHandle;
  if (typeof e.label === 'string' && e.label) out.label = e.label;
  if (e.condition) out.condition = e.condition;
  if (e.effect) out.effect = e.effect;
  if (e.once) out.once = true;
  if (e.fallback) out.fallback = true;
  return out;
}

function cloneEntity(e: Entity): EngineEntity {
  const out: EngineEntity = {
    id: e.id, name: e.name, kind: e.kind,
    fields: e.fields.filter((f) => f.label).map((f) => {
      const field: EngineEntity['fields'][number] = { label: f.label, value: f.value };
      if (f.type) field.type = f.type;
      if (f.filterKind) field.filterKind = f.filterKind;
      return field;
    }),
  };
  if (e.technicalName) out.technicalName = e.technicalName;
  if (e.color) out.color = e.color;
  if (e.emoji) out.emoji = e.emoji;
  if (e.summary) out.summary = e.summary;
  return out;
}

function walkEngineNodes(sub: EngineSub, fn: (n: EngineNode, path: string[]) => void, path: string[] = []) {
  for (const n of sub.nodes) {
    fn(n, path);
    if (n.data.sub) walkEngineNodes(n.data.sub, fn, [...path, n.id]);
  }
}

export function buildEnginePackage(project: Project, rules: EngineExportRules = {}): EnginePackage {
  const effective: EnginePackage['rules'] = {
    includeLayout: rules.includeLayout ?? false,
    includeAnnotations: rules.includeAnnotations ?? false,
    entities: rules.entities ?? 'all',
    assets: rules.assets ?? 'all',
  };
  const wanted = rules.flowIds && rules.flowIds.length > 0 ? new Set(rules.flowIds) : null;
  const flows: EngineFlow[] = project.flows
    .filter((f) => !wanted || wanted.has(f.id))
    .map((f) => {
      const sub = cloneSub(f, effective);
      const out: EngineFlow = { id: f.id, name: f.name, nodes: sub.nodes, edges: sub.edges };
      if (f.technicalName) out.technicalName = f.technicalName;
      return out;
    });

  // 导出范围内的全部节点 id(含子流程),供实体 / 资源 / 附件筛选与索引
  const nodeIndex: EngineIndex['nodes'] = {};
  const speakers: EngineIndex['speakers'] = {};
  const speakerIds = new Set<string>();
  for (const f of flows) {
    walkEngineNodes(f, (n, path) => {
      nodeIndex[n.id] = { flowId: f.id, path, type: n.type };
      if (n.data.speakerId) {
        speakerIds.add(n.data.speakerId);
        (speakers[n.data.speakerId] ??= []).push(n.id);
      }
    });
  }

  // 实体:全部,或被引用闭包(说话人 + entity/entities 字段可达)
  let entities: Entity[];
  if (effective.entities === 'referenced') {
    const byId = new Map(project.entities.map((e) => [e.id, e]));
    const included = new Set<string>();
    const queue = [...speakerIds];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (included.has(id) || !byId.has(id)) continue;
      included.add(id);
      for (const f of byId.get(id)!.fields) {
        if (f.type === 'entity' && f.value) queue.push(f.value);
        if (f.type === 'entities') queue.push(...f.value.split(',').map((s) => s.trim()).filter(Boolean));
      }
    }
    entities = project.entities.filter((e) => included.has(e.id));
  } else {
    entities = project.entities;
  }
  const engineEntities = entities.map(cloneEntity);

  // 附件:owner 限定在导出的流程 / 节点 / 实体
  const owners = new Set<string>([
    ...flows.map((f) => f.id),
    ...Object.keys(nodeIndex),
    ...engineEntities.map((e) => e.id),
  ]);
  const attachments: Record<string, string[]> = {};
  const attachedAssetIds = new Set<string>();
  for (const [owner, assetIds] of Object.entries(project.attachments ?? {})) {
    if (!owners.has(owner)) continue;
    const kept = assetIds.filter((id) => project.assets.some((a) => a.id === id));
    if (kept.length === 0) continue;
    attachments[owner] = kept;
    for (const id of kept) attachedAssetIds.add(id);
  }

  const assets: EngineAsset[] = project.assets
    .filter((a) => effective.assets === 'all' || attachedAssetIds.has(a.id))
    .map((a) => {
      const out: EngineAsset = { id: a.id, name: a.name, kind: a.kind, mime: a.mime, size: a.size };
      if (a.technicalName) out.technicalName = a.technicalName;
      if (a.hash) {
        out.hash = a.hash;
        out.fileName = assetFileName(a.hash, a.ext);
      }
      if (a.ext) out.ext = a.ext;
      if (a.license) out.license = a.license;
      if (a.source) out.source = a.source;
      return out;
    });

  const variables: EngineVariable[] = project.variables.map((v) => {
    const out: EngineVariable = { name: v.name, type: v.type, value: v.value };
    if (v.description) out.description = v.description;
    return out;
  });

  // 技术名索引
  const technicalNames: EngineIndex['technicalNames'] = {};
  for (const f of flows) if (f.technicalName) technicalNames[f.technicalName] = { kind: 'flow', id: f.id };
  for (const e of engineEntities) if (e.technicalName) technicalNames[e.technicalName] = { kind: 'entity', id: e.id };
  for (const a of assets) if (a.technicalName) technicalNames[a.technicalName] = { kind: 'asset', id: a.id };
  for (const f of flows) {
    walkEngineNodes(f, (n) => {
      if (n.data.technicalName) technicalNames[n.data.technicalName] = { kind: 'node', id: n.id, flowId: f.id };
    });
  }

  const assetOwners: EngineIndex['assetOwners'] = {};
  for (const [owner, ids] of Object.entries(attachments)) {
    for (const id of ids) (assetOwners[id] ??= []).push(owner);
  }

  // 内容哈希清单(变量整表一个键)
  const manifest: Record<string, string> = {};
  for (const f of flows) manifest[`flow:${f.id}`] = contentHash(f);
  for (const e of engineEntities) manifest[`entity:${e.id}`] = contentHash(e);
  for (const a of assets) manifest[`asset:${a.id}`] = contentHash(a);
  if (variables.length > 0) manifest['variables'] = contentHash(variables);

  return {
    schema: 'theloom-package',
    schemaVersion: ENGINE_SCHEMA_VERSION,
    meta: { projectName: project.name, exportedAt: Date.now(), generator: 'TheLoom' },
    rules: effective,
    variables,
    entities: engineEntities,
    flows,
    assets,
    attachments,
    index: { technicalNames, nodes: nodeIndex, speakers, assetOwners },
    manifest,
  };
}

/* ---------- 增量 ---------- */

export interface ManifestDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

export function diffManifests(prev: Record<string, string>, next: Record<string, string>): ManifestDiff {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [key, hash] of Object.entries(next)) {
    if (!(key in prev)) added.push(key);
    else if (prev[key] !== hash) changed.push(key);
  }
  for (const key of Object.keys(prev)) {
    if (!(key in next)) removed.push(key);
  }
  return { added, changed, removed };
}

/** 由完整包 + 上次 manifest 产出增量包(变更 / 新增对象带全量数据,删除只带键) */
export function buildEngineDelta(pkg: EnginePackage, prevManifest: Record<string, string>): EngineDelta {
  const diff = diffManifests(prevManifest, pkg.manifest);
  const touched = new Set([...diff.added, ...diff.changed]);
  return {
    schema: 'theloom-delta',
    schemaVersion: pkg.schemaVersion,
    meta: { ...pkg.meta, exportedAt: Date.now() },
    changed: {
      variables: touched.has('variables') ? pkg.variables : undefined,
      entities: pkg.entities.filter((e) => touched.has(`entity:${e.id}`)),
      flows: pkg.flows.filter((f) => touched.has(`flow:${f.id}`)),
      assets: pkg.assets.filter((a) => touched.has(`asset:${a.id}`)),
    },
    removed: diff.removed,
  };
}
