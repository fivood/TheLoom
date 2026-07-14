export type ID = string;

/* ---------- 实体库(角色 / 地点 / 物品 / 阵营 / 设定) ---------- */

export type EntityKind = 'character' | 'location' | 'item' | 'faction' | 'concept';

export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  character: '角色',
  location: '地点',
  item: '物品',
  faction: '阵营',
  concept: '设定',
};

export interface EntityField {
  id: ID;
  label: string;
  value: string;
}

export interface Entity {
  id: ID;
  kind: EntityKind;
  name: string;
  color: string;
  emoji: string;
  /** 头像图片 dataURL(128px);文件夹模式下存为 assets/entity-{id}.png */
  avatar?: string;
  summary: string;
  fields: EntityField[];
  notes: string;
  createdAt: number;
}

/* ---------- 流程编辑器(articy 式节点流) ---------- */

export type FlowNodeType =
  | 'dialogue'    // 对白
  | 'fragment'    // 剧情片段
  | 'hub'         // 汇聚点
  | 'condition'   // 条件分支
  | 'instruction' // 指令(设置变量等)
  | 'jump'        // 跳转
  | 'exit'        // 出口(子流程 → 父层的命名引脚)
  | 'check'       // 检定(2d6 + 技能 vs 难度;白可重试,红仅一次)
  | 'note'        // 画布注释(不参与演出与导出)
  | 'zone';       // 分区框(可缩放背景区块)

export const FLOW_NODE_LABEL: Record<FlowNodeType, string> = {
  dialogue: '对白',
  fragment: '剧情片段',
  hub: '汇聚点',
  condition: '条件分支',
  instruction: '指令',
  jump: '跳转',
  exit: '出口',
  check: '检定',
  note: '注释',
  zone: '分区',
};

/** 不参与叙事(演出、导出、起点判定)的画布组织类节点 */
export const ANNOTATION_TYPES: ReadonlySet<FlowNodeType> = new Set(['note', 'zone']);

/** 子流程:剧情片段节点内部的画布,可无限嵌套 */
export interface SubFlow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowNodeData {
  title: string;
  text: string;
  speakerId?: ID;
  color?: string;
  /** 仅剧情片段节点:内部子流程 */
  sub?: SubFlow;
  /** 仅分区节点:框体尺寸 */
  w?: number;
  h?: number;
  /** 仅检定节点:技能表达式(可引用变量)、难度、红色检定(仅一次机会) */
  checkExpr?: string;
  checkDc?: number;
  checkRed?: boolean;
  [key: string]: unknown;
}

export interface FlowNode {
  id: ID;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: ID;
  source: ID;
  target: ID;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  /** 选项出现条件(变量表达式,空 = 始终出现) */
  condition?: string;
  /** 选中该选项时执行的指令 */
  effect?: string;
  /** 一次性选项:演出中选过即隐藏 */
  once?: boolean;
}

export interface Flow {
  id: ID;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/* ---------- 头脑风暴 ---------- */

export interface BrainNote {
  id: ID;
  text: string;
  color: string;
  position: { x: number; y: number };
}

export interface BrainEdge {
  id: ID;
  source: ID;
  target: ID;
  label?: string;
}

/* ---------- 罗琳式表格大纲(行 = 章节,列 = 剧情线) ---------- */

export interface OutlineColumn {
  id: ID;
  title: string;
  color: string;
}

export interface OutlineRow {
  id: ID;
  no: string;    // 章节号
  time: string;  // 故事时间
  title: string; // 章节标题
  main: string;  // 主线剧情
  cells: Record<ID, string>; // 各剧情线单元格
}

/* ---------- 时间线(轨道 × 时间点) ---------- */

export interface TimelineTrack {
  id: ID;
  name: string;
  color: string;
}

export interface TimelinePoint {
  id: ID;
  label: string; // 故事时间:可以是"雨夜""三年前""第7日"等任意写法
}

export interface TimelineEvent {
  id: ID;
  trackId: ID;
  pointId: ID;
  title: string;
  text: string;
  color?: string;
  entityIds: ID[]; // 关联的实体
}

/* ---------- 资料卡片 ---------- */

export interface ResearchCard {
  id: ID;
  title: string;
  content: string;
  category: string;
  tags: string[];
  color: string;
  source: string;
  pinned: boolean;
  createdAt: number;
}

/* ---------- 全局变量 ---------- */

export type VariableType = 'boolean' | 'number' | 'string';

export interface Variable {
  id: ID;
  name: string;
  type: VariableType;
  value: string;
  description: string;
}

/* ---------- 项目 ---------- */

export interface Project {
  version: 1;
  name: string;
  flows: Flow[];
  entities: Entity[];
  brainstormNotes: BrainNote[];
  brainstormEdges: BrainEdge[];
  outlineColumns: OutlineColumn[];
  outlineRows: OutlineRow[];
  timelineTracks: TimelineTrack[];
  timelinePoints: TimelinePoint[];
  timelineEvents: TimelineEvent[];
  researchCards: ResearchCard[];
  researchCategories: string[];
  variables: Variable[];
  /** 实体字段模板:按类型预设字段名,新建实体时自动填入 */
  entityTemplates?: Partial<Record<EntityKind, string[]>>;
  updatedAt: number;
}

export const PALETTE = [
  '#1b1b19', '#3a3936', '#565550', '#72716b',
  '#8e8d86', '#aaa9a1', '#c6c5bd', '#e0dfd8',
];
