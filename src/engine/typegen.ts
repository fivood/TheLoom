/**
 * 类型生成(R9):从引擎包产出自包含的 TypeScript 声明文件。
 * 变量名 / 技术名生成字面量联合类型,游戏代码拿到强类型访问。
 */
import type { EnginePackage } from './package';

function literalUnion(values: string[]): string {
  if (values.length === 0) return 'never';
  return values.map((v) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(' | ');
}

function varTsType(type: string): string {
  return type === 'boolean' ? 'boolean' : type === 'number' ? 'number' : 'string';
}

export function generateTypes(pkg: EnginePackage): string {
  const flowTechs = pkg.flows.map((f) => f.technicalName).filter((x): x is string => !!x);
  const entityTechs = pkg.entities.map((e) => e.technicalName).filter((x): x is string => !!x);
  const assetTechs = pkg.assets.map((a) => a.technicalName).filter((x): x is string => !!x);
  const nodeTechs = Object.entries(pkg.index.technicalNames)
    .filter(([, v]) => v.kind === 'node')
    .map(([k]) => k);
  // R19-2:入口 key 在流程间可以重名,去重后再生成字面量联合
  const entryKeys = [...new Set(pkg.flows.flatMap((f) => (f.entries ?? []).map((e) => e.key)))];
  // R19-3:事件名 + 每个事件的载荷类型,让宿主的事件处理拿到编译期检查
  const events = pkg.externalEvents ?? [];

  const ident = (name: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name}'`);
  const eventPayloadLines = events.length === 0
    ? '  // 项目未声明任何外部事件'
    : events.map((e) => {
      const doc = e.description ? `  /** ${e.description.replace(/\*\//g, '* /')} */\n` : '';
      const body = (e.params ?? []).length === 0
        ? 'Record<string, never>'
        : `{ ${(e.params ?? []).map((prm) => `${ident(prm.name)}: ${varTsType(prm.type)}`).join('; ')} }`;
      return `${doc}  ${ident(e.name)}: ${body};`;
    }).join('\n');

  const varLines = pkg.variables.map((v) => {
    const doc = v.description ? `  /** ${v.description.replace(/\*\//g, '* /')} */\n` : '';
    const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name) ? v.name : `'${v.name}'`;
    return `${doc}  ${key}: ${varTsType(v.type)};`;
  });

  return `/**
 * TheLoom 引擎包类型定义(自动生成,勿手改)
 * 项目:${pkg.meta.projectName}
 * 导出时间:${new Date(pkg.meta.exportedAt).toISOString()}
 * schemaVersion:${pkg.schemaVersion}
 * runtimeProtocolVersion:${pkg.runtimeProtocolVersion}
 */

/** 流程技术名 */
export type FlowTechnicalName = ${literalUnion(flowTechs)};
/** 实体技术名(脚本 实体.字段 寻址) */
export type EntityTechnicalName = ${literalUnion(entityTechs)};
/** 资源技术名 */
export type AssetTechnicalName = ${literalUnion(assetTechs)};
/** 节点技术名(seen()/unseen() 目标) */
export type NodeTechnicalName = ${literalUnion(nodeTechs)};
/** 变量名 */
export type VariableName = ${literalUnion(pkg.variables.map((v) => v.name))};
/** R19-2 流程入口 key(jump / call 与宿主引擎的稳定寻址目标) */
export type FlowEntryKey = ${literalUnion(entryKeys)};
/** R19-3 外部事件名(宿主按它分发) */
export type ExternalEventName = ${literalUnion(events.map((e) => e.name))};

/** 全局变量表(初始值见包内 variables) */
export interface EngineVariables {
${varLines.join('\n')}
}

export type RuntimeValue = boolean | number | string;

export interface RuntimeChanges {
  variables: { name: string; before: RuntimeValue | null; after: RuntimeValue | null }[];
  entities: {
    entityTechnicalName: string;
    field: string;
    before: RuntimeValue | null;
    after: RuntimeValue | null;
  }[];
}

export interface RuntimeEventV2 {
  protocolVersion: 2;
  sourceProtocolVersion: number;
  event: 'enter' | 'display' | 'leave';
  flowId: string;
  flowTechnicalName?: FlowTechnicalName;
  nodeId: string;
  nodeTechnicalName?: NodeTechnicalName;
  path: string[];
  nodeType: EngineNode['type'];
  kind: string;
  title: string;
  text: string;
  speakerId?: string;
  speakerName?: string;
  note?: string;
  fields: { label: string; value: string; type?: string }[];
  assetIds: string[];
  edgeId?: string;
  choiceKey?: string;
  changes: RuntimeChanges;
}

/* ---------- 包结构 ---------- */

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
  type: 'dialogue' | 'fragment' | 'hub' | 'condition' | 'instruction' | 'jump' | 'exit' | 'check' | 'note' | 'zone';
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
  choiceId?: string;
}

export interface EngineSub { nodes: EngineNode[]; edges: EngineEdge[] }

/** R19-3 每个外部事件的实参载荷(由声明的参数生成) */
export interface ExternalEventPayloads {
${eventPayloadLines}
}

/** R19-3 交给宿主的外部事件调用 */
export interface ExternalEventCall<K extends ExternalEventName = ExternalEventName> {
  name: K;
  args: K extends keyof ExternalEventPayloads ? ExternalEventPayloads[K] : Record<string, RuntimeValue>;
  wait: 'continue' | 'ack' | 'value';
  flowId: string;
  nodeId: string;
  path: string[];
  nodeTechnicalName?: NodeTechnicalName;
}

export interface EngineParam {
  name: VariableName | string;
  type: 'boolean' | 'number' | 'string';
  default?: string;
}

export interface EngineEntry {
  key: FlowEntryKey;
  nodeId: string;
  label?: string;
  params?: EngineParam[];
}

export interface EngineFlow extends EngineSub {
  id: string;
  name: string;
  technicalName?: FlowTechnicalName;
  /** R19-2 命名入口 */
  entries?: EngineEntry[];
}

export interface EngineEntity {
  id: string;
  name: string;
  kind: string;
  technicalName?: EntityTechnicalName;
  color?: string;
  emoji?: string;
  summary?: string;
  fields: { label: string; value: string; type?: string; filterKind?: string }[];
}

export interface EngineAsset {
  id: string;
  name: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  mime: string;
  size: number;
  technicalName?: AssetTechnicalName;
  hash?: string;
  ext?: string;
  license?: string;
  source?: string;
  /** 项目文件夹 assets/ 内的原文件名 */
  fileName?: string;
}

export interface EngineVariable {
  name: VariableName;
  type: 'boolean' | 'number' | 'string';
  value: string;
  description?: string;
}

export interface EngineIndex {
  technicalNames: Record<string, { kind: 'flow' | 'entity' | 'asset' | 'node'; id: string; flowId?: string }>;
  nodes: Record<string, { flowId: string; path: string[]; type: string }>;
  speakers: Record<string, string[]>;
  assetOwners: Record<string, string[]>;
}

export interface EnginePackage {
  schema: 'theloom-package';
  schemaVersion: string;
  runtimeProtocolVersion: 2;
  meta: { projectName: string; exportedAt: number; generator: string };
  rules: { includeLayout: boolean; includeAnnotations: boolean; entities: 'all' | 'referenced'; assets: 'all' | 'referenced' };
  variables: EngineVariable[];
  entities: EngineEntity[];
  flows: EngineFlow[];
  assets: EngineAsset[];
  attachments: Record<string, string[]>;
  index: EngineIndex;
  manifest: Record<string, string>;
}
`;
}
