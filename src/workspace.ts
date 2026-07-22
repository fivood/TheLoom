import type { WorkspacePreset } from './types';

export type WorkspaceTab = 'flow' | 'entities' | 'assets' | 'documents' | 'brainstorm' | 'outline' | 'timeline' | 'map' | 'research' | 'variables' | 'planning';

export const WORKSPACE_PRESET_LABEL: Record<WorkspacePreset, string> = {
  novel: '小说',
  interactive: '互动叙事',
  universal: '通用',
};

export const WORKSPACE_PRESET_HINT: Record<WorkspacePreset, string> = {
  novel: '优先显示正文、人物、规划、资料和大纲',
  interactive: '优先显示流程、剧本、实体、变量和资源',
  universal: '显示全部模块，保持完整导航',
};

export const WORKSPACE_PRIMARY_TABS: Record<WorkspacePreset, WorkspaceTab[]> = {
  novel: ['documents', 'entities', 'planning', 'research', 'outline'],
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
    if (tab === 'entities') return '人物';
  }
  if (preset === 'interactive' && tab === 'documents') return '剧本';
  return UNIVERSAL_LABELS[tab];
}

export function workspacePrimaryTabs(preset: WorkspacePreset): Set<WorkspaceTab> {
  return new Set(WORKSPACE_PRIMARY_TABS[preset]);
}
