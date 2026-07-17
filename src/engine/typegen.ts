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

/** 全局变量表(初始值见包内 variables) */
export interface EngineVariables {
${varLines.join('\n')}
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
}

export interface EngineSub { nodes: EngineNode[]; edges: EngineEdge[] }

export interface EngineFlow extends EngineSub {
  id: string;
  name: string;
  technicalName?: FlowTechnicalName;
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
