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

/** R11 命名模板的适用模块 */
export type TemplateModule = 'entity' | 'node' | 'asset' | 'document' | 'map';

export const TEMPLATE_MODULE_LABEL: Record<TemplateModule, string> = {
  entity: '实体',
  node: '流程节点',
  asset: '资源',
  document: '文档',
  map: '地图',
};

/**
 * R11 命名模板对象:可分配、可继承、编辑后实例安全迁移。
 * entityKind / nodeType 表示它是该类别的默认模板(新建对象自动套用)。
 */
export interface ObjectTemplate {
  id: ID;
  name: string;
  module: TemplateModule;
  entityKind?: EntityKind;
  nodeType?: FlowNodeType;
  /** 父模板:先取父模板字段,再按 label 被本模板覆盖;链上有环时忽略环 */
  parentId?: ID;
  fields: EntityTemplateField[];
  createdAt: number;
  updatedAt: number;
}

export interface Entity {
  id: ID;
  favorite?: boolean;
  /** 所属实体文件夹 id;空 = 未分组 */
  folderId?: ID;
  /** Navigator 树内手动排序序号;空 = 按默认(创建时间)排序 */
  order?: number;
  kind: EntityKind;
  name: string;
  color: string;
  emoji: string;
  /** R11:分配的命名模板 id;空 = 未套用模板 */
  templateId?: ID;
  /** 头像图片 dataURL(128px);文件夹模式下存为 assets/entity-{id}.png */
  avatar?: string;
  summary: string;
  fields: EntityField[];
  notes: string;
  /** 技术名:项目内唯一的稳定标识符,用于脚本寻址与导出,如 semelvie */
  technicalName?: string;
  /** 别名 / 常见简称,用于 AI 抽取时消歧(如「塞」「塞梅」都指向「塞梅尔维斯」) */
  aliases?: string[];
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
  /** 引用的叙事单元 id:与文档块共享同一份内容(对白 / 片段 / 条件 / 指令等) */
  unitId?: ID;
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
  /** 绑定的文档选项 id(R3):hub 出边与文档「选项」块的选项双向映射 */
  choiceId?: ID;
}

export interface Flow {
  id: ID;
  name: string;
  favorite?: boolean;
  /** 关联的场景文档 id;用于文档—流程双视图定位与结构更新 */
  documentId?: ID;
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
  /** R14 归属图层;不设 = 默认图层 */
  layerId?: ID;
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
  /** R14 归属图层;不设 = 默认图层 */
  layerId?: ID;
}

/** R14 图层:每个 marker / region / shape 可归属一层;层可整层显隐 / 锁定 */
export interface MapLayer {
  id: ID;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 从下到上的绘制顺序 */
  order: number;
}

/** R14 矢量形状:polyline(路径 / 河流 / 边界)/ rect / ellipse / text */
export type MapShapeType = 'polyline' | 'rect' | 'ellipse' | 'text';
export interface MapShape {
  id: ID;
  type: MapShapeType;
  /** polyline: 多个点;rect / ellipse:左上 + 右下两点;text:锚点一个 */
  points: { x: number; y: number }[];
  /** text 类型的文字内容;其他类型的可选标签 */
  text?: string;
  color?: string;
  /** 描边粗细(像素,SVG stroke-width) */
  strokeWidth?: number;
  /** rect / ellipse 是否填充 */
  fill?: boolean;
  /** 归属图层;不设 = 默认图层 */
  layerId?: ID;
  fromPointId?: ID;
  toPointId?: ID;
}

export interface MapDoc {
  id: ID;
  name: string;
  /** R11:模板分配与自定义字段 */
  templateId?: ID;
  fields?: EntityField[];
  /** 底图:dataURL(网页版内嵌)或 asset:map-{id}.png(桌面文件夹模式) */
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  markers: MapMarker[];
  regions: MapRegion[];
  /** R14 图层与矢量形状;旧项目为空 = 全部归入自动创建的「默认」图层 */
  layers?: MapLayer[];
  shapes?: MapShape[];
}

/* ---------- 资料卡片 ---------- */

export interface ResearchCard {
  id: ID;
  favorite?: boolean;
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
  favorite?: boolean;
  /** 所属资源文件夹 id;空 = 未分组 */
  folderId?: ID;
  /** Navigator 树内手动排序序号;空 = 按默认(创建时间倒序)排序 */
  order?: number;
  name: string;
  kind: AssetKind;
  /** R11:模板分配与自定义字段 */
  templateId?: ID;
  fields?: EntityField[];
  mime: string;
  /** 预览 dataURL:图片为 256px JPEG,音频/视频/文件留空。
   *  网页模式唯一可用形态;文件夹模式加载时从 assets/ 读入后也填入 */
  thumbnail?: string;
  /** 旧字段(R8 前):文件夹模式下 assets/ 内的文件名;R8 起文件名由 hash + ext 推导,此字段仅兼容保留 */
  fileRef?: string;
  /** 原文件 SHA-256(hex,64 位):原文件存储的键(桌面 assets/ 文件名 / 网页 IndexedDB 键),同内容去重 */
  hash?: string;
  /** 原文件扩展名(小写,不含点),与 hash 一起推导落盘文件名 */
  ext?: string;
  /** 原始字节数,用于配额提示 */
  size: number;
  tags: string[];
  source: string;
  /** 授权 / 许可信息(如 CC-BY 4.0、已购买商用授权、自绘) */
  license?: string;
  notes: string;
  /** 技术名:项目内唯一,用于脚本与导出,如 portrait_semelvie */
  technicalName?: string;
  createdAt: number;
}

/* ---------- 叙事单元(R1:文档块与流程节点共享的同一份内容) ---------- */

export type NarrativeUnitKind = 'scene' | 'line' | 'choice' | 'condition' | 'instruction';

export const NARRATIVE_UNIT_KIND_LABEL: Record<NarrativeUnitKind, string> = {
  scene: '场景',
  line: '台词',
  choice: '选项',
  condition: '条件',
  instruction: '指令',
};

/**
 * 叙事单元:文档块与流程节点通过 unitId 引用的权威内容对象。
 * 同一段对白 / 场景在项目里只有一份数据;各视图上的字段是同步镜像,
 * 由 syncNarrativeUnits 在每次 commit 与项目加载时维护一致。
 */
export interface NarrativeUnit {
  id: ID;
  kind: NarrativeUnitKind;
  /** 标题:scene 的场景名;line 的舞台提示(流程节点标题) */
  title: string;
  /** 正文:对白 / 动作文本;condition / instruction 的表达式;choice 的引导语 */
  text: string;
  /** 仅 line:说话人(实体 id) */
  speakerId?: ID;
  /** 仅 choice:选项列表 */
  choices?: DocChoice[];
  createdAt: number;
  updatedAt: number;
}

/* ---------- 文档视图 ---------- */
/**
 * 文档块类型。剧本块(前 6 项)在「转为流程」时映射为对应节点;
 * 写作块(subheading / list / quote)只用于长篇写作组织,转流程时跳过。
 */
export type DocBlockType =
  | 'paragraph'    // 普通正文(默认不进入流程)
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
  paragraph: '正文',
  heading: '场景锚点',
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
export const DOC_WRITING_TYPES: ReadonlySet<DocBlockType> = new Set(['paragraph', 'subheading', 'quote', 'list', 'note']);

export type DocFlowRole = 'none' | 'beat' | 'node';

export interface DocChoice {
  id: ID;
  label: string;
}

export interface DocBlock {
  id: ID;
  type: DocBlockType;
  /** 引用的叙事单元 id(剧本块专用):与流程节点共享同一份内容 */
  unitId?: ID;
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
  /** 流程映射策略;普通正文缺省为 none,剧本块缺省为 node */
  flowRole?: DocFlowRole;
}

/** 场景写作状态(R2 长篇正文工作台) */
export type DocStatus = 'outline' | 'draft' | 'revising' | 'done';

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  outline: '大纲',
  draft: '草稿',
  revising: '修订中',
  done: '完成',
};

export const DOC_STATUS_ORDER: DocStatus[] = ['outline', 'draft', 'revising', 'done'];

export interface Document {
  id: ID;
  favorite?: boolean;
  /** 所属文档文件夹 id;空 = 未分组 */
  folderId?: ID;
  /** Navigator 树内手动排序序号;空 = 按默认(更新时间倒序)排序 */
  order?: number;
  name: string;
  /** 首次生成流程后记录关联对象,后续打开或显式更新结构 */
  linkedFlowId?: ID;
  /** 技术名:项目内唯一,用于导出,如 act1_draft */
  technicalName?: string;
  /** R11:模板分配与自定义字段 */
  templateId?: ID;
  fields?: EntityField[];
  category: string;
  blocks: DocBlock[];
  notes: string;
  /** 场景元数据(R2):写作状态 */
  status?: DocStatus;
  /** 场景元数据:字数目标 */
  wordTarget?: number;
  /** 场景元数据:POV 角色(实体 id) */
  povId?: ID;
  /** 场景元数据:地点(实体 id) */
  locationId?: ID;
  /** 场景元数据:故事时间(自由文本,如「雨夜」「第7日」) */
  timeLabel?: string;
  /** 场景元数据(R4):情节张力 1-5,节奏图用 */
  tension?: number;
  /** 场景元数据(R5):修订轮次(第几稿,≥1 整数);列表可按轮次筛选 */
  revision?: number;
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

/* ---------- 正文修订(R5) ---------- */

/** 批注:挂在文档上的评论,可精确锚定到某个块;块被删除后退化为整篇批注 */
export interface Annotation {
  id: ID;
  docId: ID;
  blockId?: ID;
  text: string;
  resolved?: boolean;
  createdAt: number;
}

/** 文档快照:单个场景正文的版本存档(区别于整项目 Snapshot),用于版本差异对比与恢复 */
export interface DocSnapshot {
  id: ID;
  docId: ID;
  /** 版本名,如「第一稿」 */
  label: string;
  /** 存档时的修订轮次 */
  revision?: number;
  blocks: DocBlock[];
  createdAt: number;
}

/** 每篇文档最多保留的快照数,超出丢最旧 */
export const DOC_SNAPSHOT_LIMIT = 20;

/* ---------- 小说规划(R4) ---------- */

/** 人物关系:两个实体之间的一条有标签连线,展示在关系图 */
export interface EntityRelation {
  id: ID;
  fromId: ID;
  toId: ID;
  /** 关系名,如「兄妹」「暗恋」「宿敌」 */
  label: string;
  /** 双向关系(两端对等,不画箭头);单向如「暗恋」画 from → to 箭头 */
  bidirectional?: boolean;
  color?: string;
  note?: string;
}

/** 角色弧线阶段:角色发展轨迹上的一个节点,可关联具体场景(文档) */
export interface ArcStage {
  id: ID;
  entityId: ID;
  /** 阶段名,如「拒绝召唤」「跌入谷底」 */
  title: string;
  note: string;
  /** 关联场景(文档 id);登场统计按其所在章节聚合显示 */
  docId?: ID;
  order?: number;
}

/** 伏笔的一处埋设 / 回收位置(指向场景文档) */
export interface ForeshadowRef {
  id: ID;
  docId: ID;
  note?: string;
}

/** 伏笔状态(由埋设 / 回收记录推导,abandoned 为手动标记) */
export type ForeshadowStatus = 'idea' | 'planted' | 'resolved' | 'abandoned';

export const FORESHADOW_STATUS_LABEL: Record<ForeshadowStatus, string> = {
  idea: '未埋设',
  planted: '待回收',
  resolved: '已回收',
  abandoned: '已弃用',
};

/** 伏笔台账条目:追踪一条伏笔从埋设到回收的全程 */
export interface Foreshadow {
  id: ID;
  title: string;
  note: string;
  /** 手动标记弃用(不再打算回收) */
  abandoned?: boolean;
  plants: ForeshadowRef[];
  payoffs: ForeshadowRef[];
  createdAt: number;
}

/* ---------- AI 集成(R3-A) ---------- */

/** AI 调用记录:只记元信息不记正文,随项目保存、可导出;API Key 永不入项目 */
export interface AiLogEntry {
  id: ID;
  at: number;
  provider: string;
  model: string;
  /** 用途:extract = 长文抽取;fields = 按模板补字段;plan / generate = 完整项目导入两阶段 */
  purpose: 'extract' | 'fields' | 'plan' | 'generate';
  inChars: number;
  outChars: number;
  ok: boolean;
  error?: string;
}

/* ---------- 配色表 ---------- */

/** 项目内可复用的配色表。default 内置一份灰阶,其余由用户创建 / 导入 zimg Palette JSON */
export interface ColorPalette {
  id: ID;
  name: string;
  /** HEX 字符串数组,如 ["#1b1b19", "#c9a86b", ...] */
  colors: string[];
}

/* ---------- 保存查询 ---------- */

export type QueryObjectType = 'all' | 'flow' | 'entity' | 'asset' | 'document' | 'research' | 'timeline';
export type QueryReferenceFilter = 'any' | 'referenced' | 'unreferenced';

export interface ProjectQuery {
  objectType: QueryObjectType;
  text: string;
  folderId: 'any' | 'ungrouped' | string;
  attributeName: string;
  attributeValue: string;
  tags: string[];
  status: 'any' | DocStatus;
  references: QueryReferenceFilter;
}

export interface SavedProjectQuery {
  id: ID;
  name: string;
  query: ProjectQuery;
  createdAt: number;
  updatedAt: number;
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
  /** R11 命名模板库(实体 / 流程节点);旧版 entityTemplates / nodeTemplates 加载时自动迁移进来 */
  templates?: ObjectTemplate[];
  /** @deprecated 旧版按实体类型的模板,normalizeProject 迁移到 templates 后清除 */
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
  /** 叙事单元:文档块与流程节点共享内容的权威存储(R1) */
  units?: NarrativeUnit[];
  /** AI 提示词模板(随项目保存、可导出);extract = 长文抽取提示词 */
  aiPrompts?: { extract?: string };
  /** AI 调用记录(仅元信息,上限 50 条) */
  aiLog?: AiLogEntry[];
  /** 批注(R5 正文修订) */
  annotations?: Annotation[];
  /** 文档快照(R5 正文修订) */
  docSnapshots?: DocSnapshot[];
  /** 人物关系(R4 关系图) */
  relations?: EntityRelation[];
  /** 角色弧线阶段(R4) */
  arcs?: ArcStage[];
  /** 伏笔台账(R4) */
  foreshadows?: Foreshadow[];
  /** 关系图上实体节点的手动布局位置 */
  relationLayout?: Record<ID, { x: number; y: number }>;
  /** 项目内自定义配色表(可从 zimg Color Palette 的 JSON 导入) */
  palettes?: ColorPalette[];
  /** 当前激活的配色表 id(空 = 使用默认灰阶 PALETTE) */
  activePaletteId?: ID;
  /** 项目内命名保存的组合查询 */
  savedQueries?: SavedProjectQuery[];
  updatedAt: number;
}

/** 内置默认灰阶(始终存在,不可删) */
export const PALETTE = [
  '#1b1b19', '#3a3936', '#565550', '#72716b',
  '#8e8d86', '#aaa9a1', '#c6c5bd', '#e0dfd8',
];
