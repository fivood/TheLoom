import type { WorkspacePreset } from './types';

export type WorkspaceTab = 'flow' | 'entities' | 'assets' | 'documents' | 'brainstorm' | 'outline' | 'timeline' | 'map' | 'research' | 'variables' | 'planning';

export const WORKSPACE_PRESET_LABEL: Record<WorkspacePreset, string> = {
  novel: '小说',
  interactive: '互动叙事',
  universal: '通用',
};

export const WORKSPACE_PRESET_HINT: Record<WorkspacePreset, string> = {
  novel: '从风暴起步,首层为风暴、正文、大纲、设定集、规划、资料',
  interactive: '优先显示流程、剧本、实体、变量和资源',
  universal: '显示全部模块，保持完整导航',
};

export const WORKSPACE_PRIMARY_TABS: Record<WorkspacePreset, WorkspaceTab[]> = {
  // 风暴排在首位:从 0 开篇常是「先撒便签 → 挑几张变成场景 / 大纲行」,
  // 起点模块却要点开「更多」才找得到,等于把第一步藏起来
  novel: ['brainstorm', 'documents', 'outline', 'entities', 'planning', 'research'],
  interactive: ['flow', 'documents', 'entities', 'variables', 'assets'],
  universal: ['flow', 'documents', 'entities', 'assets', 'research', 'planning', 'outline', 'timeline', 'map', 'brainstorm', 'variables'],
};

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
  if (preset === 'novel') {
    if (tab === 'documents') return '正文';
    if (tab === 'entities') return '设定集';
  }
  if (preset === 'interactive' && tab === 'documents') return '剧本';
  return UNIVERSAL_LABELS[tab];
}

export function workspacePrimaryTabs(preset: WorkspacePreset): Set<WorkspaceTab> {
  return new Set(WORKSPACE_PRIMARY_TABS[preset]);
}
