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

export type EntityFieldType = 'text' | 'entity' | 'entities';

export interface EntityField {
  id: ID;
  label: string;
  /**
   * text 类型:自由文本;
   * entity 类型:value 是单个实体 id;
   * entities 类型:value 是逗号分隔的实体 id 列表
   */
  value: string;
  type?: EntityFieldType;
  /** 可选限定被选实体的类型(如"角色""阵营") */
  filterKind?: EntityKind;
}

/** 模板字段:决定新建实体时预填的字段结构 + 约束 */
export interface EntityTemplateField {
  label: string;
  type?: EntityFieldType;
  filterKind?: EntityKind;
  /** 枚举约束:字段值必须从这些值里选 */
  enumValues?: string[];
  /** 必填:实例上不能为空 */
  required?: boolean;
  /** 只读:实例上不可编辑(由模板锁定) */
  readonly?: boolean;
}
/** 兼容旧版:字符串等价于 { label, type: 'text' } */
export type EntityTemplateSpec = string | EntityTemplateField;

export interface Entity {
  id: ID;
  /** 所属实体文件夹 id;空 = 未分组 */
  folderId?: ID;
  /** Navigator 树内手动排序序号;空 = 按默认(创建时间)排序 */
  order?: number;
  kind: EntityKind;
  name: string;
  color: string;
  emoji: string;
  /** 头像图片 dataURL(128px);文件夹模式下存为 assets/entity-{id}.png */
  avatar?: string;
  summary: string;
  fields: EntityField[];
  notes: string;
  /** 技术名:项目内唯一的稳定标识符,用于脚本寻址与导出,如 semelvie */
  technicalName?: string;
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
  /** 技术名:用于 seen("xxx") / unseen("xxx") 在脚本中引用本节点 */
  technicalName?: string;
  /** 模板驱动的自定义字段(与实体同构,便于跨对象复用) */
  fields?: EntityField[];
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
  /** 兜底分支:当其他出边都不满足时才走这条;有其他可用候选时被遮蔽 */
  fallback?: boolean;
}

export interface Flow {
  id: ID;
  name: string;
  /** 技术名:项目内唯一,用于跳转与导出,如 act1_rain */
  technicalName?: string;
  /** 所属文件夹 id(null / undefined = 未分组);Navigator 树用 */
  folderId?: ID;
  /** Navigator 树内手动排序序号;空 = 按默认排序 */
  order?: number;
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

/* ---------- 地图 ---------- */

/** 归一化坐标 [0,1]:x = 相对底图左上角的水平比例,y = 垂直比例 */
export interface MapMarker {
  id: ID;
  x: number;
  y: number;
  label: string;
  entityId?: ID;
  color?: string;
  /** 出现的起始时间点(为空 = 始终存在);来自 timelinePoints */
  fromPointId?: ID;
  /** 消失的时间点(在此点之后不显示;为空 = 永远存在) */
  toPointId?: ID;
}

/** 多边形区域(常用于阵营领地) */
export interface MapRegion {
  id: ID;
  /** 顶点数组,归一化坐标 */
  points: { x: number; y: number }[];
  label: string;
  entityId?: ID;
  color?: string;
  fromPointId?: ID;
  toPointId?: ID;
}

export interface MapDoc {
  id: ID;
  name: string;
  /** 底图:dataURL(网页版内嵌)或 asset:map-{id}.png(桌面文件夹模式) */
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  markers: MapMarker[];
  regions: MapRegion[];
}

/* ---------- 资料卡片 ---------- */

export interface ResearchCard {
  id: ID;
  /** 所属资料文件夹 id;空 = 未分组 */
  folderId?: ID;
  /** Navigator 树内手动排序序号;空 = 按默认(置顶 + 创建时间)排序 */
  order?: number;
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

/* ---------- 资源库 ---------- */

export type AssetKind = 'image' | 'audio' | 'video' | 'file';

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  image: '图片',
  audio: '音频',
  video: '视频',
  file: '文件',
};

export const ASSET_KIND_ICON: Record<AssetKind, 'image' | 'music' | 'film' | 'archive'> = {
  image: 'image',
  audio: 'music',
  video: 'film',
  file: 'archive',
};

export interface Asset {
  id: ID;
  /** 所属资源文件夹 id;空 = 未分组 */
  folderId?: ID;
  /** Navigator 树内手动排序序号;空 = 按默认(创建时间倒序)排序 */
  order?: number;
  name: string;
  kind: AssetKind;
  mime: string;
  /** 预览 dataURL:图片为 256px JPEG,音频/视频/文件留空。
   *  网页模式唯一可用形态;文件夹模式加载时从 assets/ 读入后也填入 */
  thumbnail?: string;
  /** 文件夹模式下 assets/ 内的文件名(如 asset-abc.png);网页模式为空——数据完全内嵌 */
  fileRef?: string;
  /** 原始字节数,用于配额提示 */
  size: number;
  tags: string[];
  source: string;
  notes: string;
  /** 技术名:项目内唯一,用于脚本与导出,如 portrait_semelvie */
  technicalName?: string;
  createdAt: number;
}

/* ---------- 文档视图 ---------- */
/**
 * 文档块类型。剧本块(前 6 项)在「转为流程」时映射为对应节点;
 * 写作块(subheading / list / quote)只用于长篇写作组织,转流程时跳过。
 */
export type DocBlockType =
  | 'heading'      // 场景标题 → fragment
  | 'subheading'   // 子标题(不进入流程,写作层级组织)
  | 'action'       // 动作/旁白 → dialogue(无说话人)
  | 'dialogue'     // 对白 → dialogue(带说话人)
  | 'quote'        // 引用块(不进入流程)
  | 'list'         // 列表块(有序/无序,不进入流程)
  | 'choice'       // 选项点 → hub + 多个带 label 的出边
  | 'condition'    // 条件分支 → condition 节点
  | 'instruction'  // 指令 → instruction 节点
  | 'note';        // 注释 → 不进入流程

export const DOC_BLOCK_LABEL: Record<DocBlockType, string> = {
  heading: '场景',
  subheading: '子标题',
  action: '动作',
  dialogue: '对白',
  quote: '引用',
  list: '列表',
  choice: '选项',
  condition: '条件',
  instruction: '指令',
  note: '注释',
};

/** 不进入流程的写作组织块(排除在 documentToFlow 之外) */
export const DOC_WRITING_TYPES: ReadonlySet<DocBlockType> = new Set(['subheading', 'quote', 'list', 'note']);

export interface DocChoice {
  id: ID;
  label: string;
}

export interface DocBlock {
  id: ID;
  type: DocBlockType;
  /** 对白:说话人(实体 id) */
  speakerId?: ID;
  text: string;
  /** 仅 choice:选项列表 */
  choices?: DocChoice[];
  /** 仅 list:每项一行的文本(有序 / 无序由 ordered 决定) */
  items?: string[];
  /** 仅 list:true = 有序(1. 2. 3.),false / 缺省 = 无序(-) */
  ordered?: boolean;
  /** 仅 subheading:标题层级,2 = ##,3 = ###;缺省视为 3 */
  level?: 2 | 3;
  /** 仅 condition:表达式 */
  condition?: string;
  /** 仅 instruction:指令 */
  instruction?: string;
}

export interface Document {
  id: ID;
  /** 所属文档文件夹 id;空 = 未分组 */
  folderId?: ID;
  /** Navigator 树内手动排序序号;空 = 按默认(更新时间倒序)排序 */
  order?: number;
  name: string;
  /** 技术名:项目内唯一,用于导出,如 act1_draft */
  technicalName?: string;
  category: string;
  blocks: DocBlock[];
  notes: string;
  createdAt: number;
  updatedAt: number;
}

/* ---------- 文件夹(Navigator 树) ---------- */

export type FolderModule = 'flow' | 'entity' | 'asset' | 'document' | 'research';

export interface Folder {
  id: ID;
  name: string;
  /** 该文件夹归属的模块(文件夹按模块隔离) */
  module: FolderModule;
  /** 父文件夹 id;null / undefined = 顶层 */
  parentId?: ID | null;
  /** 同级排序序号;空 = 按默认(插入顺序)排序 */
  order?: number;
}

/* ---------- 配色表 ---------- */

/** 项目内可复用的配色表。default 内置一份灰阶,其余由用户创建 / 导入 zimg Palette JSON */
export interface ColorPalette {
  id: ID;
  name: string;
  /** HEX 字符串数组,如 ["#1b1b19", "#c9a86b", ...] */
  colors: string[];
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
  maps: MapDoc[];
  researchCards: ResearchCard[];
  researchCategories: string[];
  variables: Variable[];
  /** 实体字段模板:按类型预设字段名(字符串等价于文本类型),新建实体时自动填入 */
  entityTemplates?: Partial<Record<EntityKind, EntityTemplateSpec[]>>;
  /** 资源库 */
  assets: Asset[];
  /** 文档视图 */
  documents: Document[];
  documentCategories: string[];
  /** 通用附件映射:对象 id(实体/卡片/流程节点/大纲行/文档块...) → asset id 列表 */
  attachments?: Record<ID, ID[]>;
  /** 文件夹(Navigator 树);按 module 隔离,各模块 side-list 可树化 */
  folders: Folder[];
  /** 流程节点模板:按节点类型预设字段 + 约束 */
  nodeTemplates?: Partial<Record<FlowNodeType, EntityTemplateSpec[]>>;
  /** 项目内自定义配色表(可从 zimg Color Palette 的 JSON 导入) */
  palettes?: ColorPalette[];
  /** 当前激活的配色表 id(空 = 使用默认灰阶 PALETTE) */
  activePaletteId?: ID;
  updatedAt: number;
}

/** 内置默认灰阶(始终存在,不可删) */
export const PALETTE = [
  '#1b1b19', '#3a3936', '#565550', '#72716b',
  '#8e8d86', '#aaa9a1', '#c6c5bd', '#e0dfd8',
];
