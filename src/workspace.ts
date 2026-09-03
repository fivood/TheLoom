import type { DocBlockType, WorkspacePreset } from './types';
import { DOC_BLOCK_LABEL } from './types';
import type { WritingStage } from './stage';

export type WorkspaceTab = 'flow' | 'entities' | 'assets' | 'documents' | 'brainstorm' | 'outline' | 'timeline' | 'map' | 'research' | 'variables' | 'planning';

export const WORKSPACE_PRESET_LABEL: Record<WorkspacePreset, string> = {
  novel: '小说',
  screenplay: '剧本',
  codex: '设定集',
  nonfiction: '纪实',
  trpg: 'TRPG 模组',
  interactive: '互动叙事',
  universal: '通用',
};

export const WORKSPACE_PRESET_HINT: Record<WorkspacePreset, string> = {
  novel: '从风暴起步,首层为风暴、正文、大纲、设定集、规划、资料',
  screenplay: '影视 / 舞台剧:剧本、场次表、人物、规划,导出 Final Draft',
  codex: '整部作品就是设定集时选它;写小说 / 剧本时只是要查设定,用顶栏的「设」阶段即可',
  nonfiction: '纪实与非虚构:资料来源、大纲、正文、时间线',
  trpg: '跑团模组:遭遇流程、NPC 与道具、地图、检定变量',
  interactive: '优先显示流程、剧本、实体、变量和资源',
  universal: '显示全部模块，保持完整导航',
};

export const WORKSPACE_PRIMARY_TABS: Record<WorkspacePreset, WorkspaceTab[]> = {
  // 风暴排在首位:从 0 开篇常是「先撒便签 → 挑几张变成场景 / 大纲行」,
  // 起点模块却要点开「更多」才找得到,等于把第一步藏起来
  novel: ['brainstorm', 'documents', 'outline', 'entities', 'planning', 'research'],
  screenplay: ['documents', 'outline', 'entities', 'planning', 'research', 'brainstorm'],
  codex: ['entities', 'map', 'timeline', 'planning', 'research', 'documents'],
  nonfiction: ['research', 'outline', 'documents', 'timeline', 'entities', 'brainstorm'],
  trpg: ['flow', 'entities', 'map', 'variables', 'documents', 'assets'],
  interactive: ['flow', 'documents', 'entities', 'variables', 'assets'],
  universal: ['flow', 'documents', 'entities', 'assets', 'research', 'planning', 'outline', 'timeline', 'map', 'brainstorm', 'variables'],
};

/**
 * 预设特征。prose = 正文为主的工作流:收起块结构按钮、隐藏游戏块类型、提供写 / 改 / 理阶段;
 * game = 需要流程与变量的工作流。universal 两者皆非,保持完整界面。
 */
export const PRESET_TRAITS: Record<WorkspacePreset, { prose: boolean; game: boolean }> = {
  novel: { prose: true, game: false },
  screenplay: { prose: true, game: false },
  codex: { prose: true, game: false },
  nonfiction: { prose: true, game: false },
  trpg: { prose: false, game: true },
  interactive: { prose: false, game: true },
  universal: { prose: false, game: false },
};

export function isProsePreset(preset: WorkspacePreset): boolean {
  return PRESET_TRAITS[preset].prose;
}

/** 打开项目时落在哪个模块(与首层顺序无关:小说首层是风暴,但落点应是正文) */
export function presetHomeTab(preset: WorkspacePreset): WorkspaceTab {
  if (PRESET_TRAITS[preset].game) return 'flow';
  if (preset === 'codex') return 'entities';
  if (preset === 'nonfiction') return 'research';
  return 'documents';
}

/** 块名按预设改写:剧本里 heading 是「场景标题」而非小说的「场景锚点」 */
const PRESET_BLOCK_LABEL: Partial<Record<WorkspacePreset, Partial<Record<DocBlockType, string>>>> = {
  screenplay: { heading: '场景标题' },
  trpg: { heading: '场景标题' },
};

export function docBlockLabel(preset: WorkspacePreset, type: DocBlockType): string {
  return PRESET_BLOCK_LABEL[preset]?.[type] ?? DOC_BLOCK_LABEL[type];
}

const UNIVERSAL_LABELS: Record<WorkspaceTab, string> = {
  flow: '流程',
  documents: '文档',
  entities: '实体',
  assets: '资源',
  research: '资料',
  planning: '规划',
  outline: '大纲',
  timeline: '时间线',
  map: '地图',
  brainstorm: '风暴',
  variables: '变量',
};

export function workspaceTabLabel(preset: WorkspacePreset, tab: WorkspaceTab): string {
  if (tab === 'entities' && preset !== 'universal') return preset === 'trpg' ? 'NPC 与道具' : '设定集';
  if (tab === 'documents') {
    if (preset === 'interactive' || preset === 'screenplay' || preset === 'trpg') return '剧本';
    if (preset === 'novel' || preset === 'codex' || preset === 'nonfiction') return '正文';
  }
  if (tab === 'outline' && preset === 'screenplay') return '场次表';
  if (tab === 'research' && preset === 'nonfiction') return '资料来源';
  return UNIVERSAL_LABELS[tab];
}

/** 阶段各自要提到最前的模块;其余保持预设自身顺序,只重排不删 */
const STAGE_FIRST: Partial<Record<WritingStage, WorkspaceTab[]>> = {
  plan: ['outline', 'timeline', 'planning'],
  // 设定不是某一种题材专属的:小说要翻人物关系,剧本要查地点,跑团更是。
  // 所以它是阶段而不是预设,任何作品都能切进来。
  codex: ['entities', 'map', 'timeline', 'planning', 'research'],
};

/** 切到某个阶段时应该落在哪个模块:写 / 改回正文(游戏型是流程),理 / 设去该阶段的头一个模块 */
export function stageHomeTab(preset: WorkspacePreset, stage: WritingStage): WorkspaceTab {
  if (stage === 'write' || stage === 'revise') return presetHomeTab(preset);
  return primaryTabsFor(preset, stage)[0];
}

/** 阶段开关对谁可见:通用预设本来就是完整导航,不需要再分阶段 */
export function hasStages(preset: WorkspacePreset): boolean {
  return preset !== 'universal';
}

export function primaryTabsFor(preset: WorkspacePreset, stage: WritingStage): WorkspaceTab[] {
  const base = WORKSPACE_PRIMARY_TABS[preset];
  const first = STAGE_FIRST[stage];
  if (!first || !hasStages(preset)) return base;
  return [...first, ...base.filter((tab) => !first.includes(tab))];
}

export function workspacePrimaryTabs(preset: WorkspacePreset, stage: WritingStage = 'write'): Set<WorkspaceTab> {
  return new Set(primaryTabsFor(preset, stage));
}
