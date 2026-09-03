import type { WorkspacePreset } from './types';
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
  codex: '世界观与百科:设定集、地图、时间线、关系图在前,正文靠后',
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

/** 「理」阶段把这三个整理用的模块提到最前,其余保持预设自身顺序 */
const PLAN_FIRST: WorkspaceTab[] = ['outline', 'timeline', 'planning'];

/** 首层 tab 顺序。阶段只在散文型预设的「理」下改变导航,且只重排、不删模块 */
export function primaryTabsFor(preset: WorkspacePreset, stage: WritingStage): WorkspaceTab[] {
  const base = WORKSPACE_PRIMARY_TABS[preset];
  if (stage !== 'plan' || !PRESET_TRAITS[preset].prose) return base;
  return [...PLAN_FIRST, ...base.filter((tab) => !PLAN_FIRST.includes(tab))];
}

export function workspacePrimaryTabs(preset: WorkspacePreset, stage: WritingStage = 'write'): Set<WorkspaceTab> {
  return new Set(primaryTabsFor(preset, stage));
}
