import { describe, expect, it } from 'vitest';
import type { Project } from './types';
import { normalizeProject } from './util';
import { WORKSPACE_PRIMARY_TABS, workspaceTabLabel } from './workspace';

describe('R17-4 项目工作区预设', () => {
  it('旧项目自动保持通用完整导航', () => {
    const project = normalizeProject({ version: 1, name: '旧项目', flows: [], updatedAt: 1 } as unknown as Project);
    expect(project.workspacePreset).toBe('universal');
    expect(WORKSPACE_PRIMARY_TABS.universal).toHaveLength(11);
  });

  it('小说与互动叙事只改变首层模块和默认术语', () => {
    expect(WORKSPACE_PRIMARY_TABS.novel).toEqual(['documents', 'entities', 'planning', 'research', 'outline']);
    expect(WORKSPACE_PRIMARY_TABS.interactive).toEqual(['flow', 'documents', 'entities', 'variables', 'assets']);
    expect(workspaceTabLabel('novel', 'documents')).toBe('正文');
    expect(workspaceTabLabel('novel', 'entities')).toBe('人物');
    expect(workspaceTabLabel('interactive', 'documents')).toBe('剧本');
    expect(workspaceTabLabel('universal', 'documents')).toBe('文档');
  });

  it('非法预设会安全回退，不修改任何领域数据', () => {
    const project = normalizeProject({
      version: 1,
      name: '测试',
      workspacePreset: 'unknown',
      flows: [{ id: 'flow-1', name: '主线', nodes: [], edges: [] }],
      documents: [{ id: 'doc-1', name: '第一场', category: '', blocks: [], notes: '', createdAt: 1, updatedAt: 1 }],
      updatedAt: 1,
    } as unknown as Project);
    expect(project.workspacePreset).toBe('universal');
    expect(project.flows[0].name).toBe('主线');
    expect(project.documents[0].name).toBe('第一场');
  });
});
