import { describe, expect, it } from 'vitest';
import type { Project } from './types';
import { normalizeProject } from './util';
import { WORKSPACE_PRESETS } from './types';
import { WORKSPACE_PRIMARY_TABS, presetHomeTab, primaryTabsFor, workspaceTabLabel } from './workspace';

describe('R17-4 项目工作区预设', () => {
  it('旧项目自动保持通用完整导航', () => {
    const project = normalizeProject({ version: 1, name: '旧项目', flows: [], updatedAt: 1 } as unknown as Project);
    expect(project.workspacePreset).toBe('universal');
    expect(WORKSPACE_PRIMARY_TABS.universal).toHaveLength(11);
  });

  it('小说与互动叙事只改变首层模块和默认术语', () => {
    // 风暴在首位:小说从 0 开篇的起点是撒便签,不该藏在「更多」里
    expect(WORKSPACE_PRIMARY_TABS.novel).toEqual(['brainstorm', 'documents', 'outline', 'entities', 'planning', 'research']);
    expect(WORKSPACE_PRIMARY_TABS.interactive).toEqual(['flow', 'documents', 'entities', 'variables', 'assets']);
    expect(workspaceTabLabel('novel', 'documents')).toBe('正文');
    expect(workspaceTabLabel('novel', 'entities')).toBe('设定集');
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

  it('「理」阶段只在小说预设下改变首层导航顺序,且不增删模块', () => {
    const write = primaryTabsFor('novel', 'write');
    const plan = primaryTabsFor('novel', 'plan');
    expect(plan[0]).toBe('outline');
    expect(plan.indexOf('documents')).toBeGreaterThan(plan.indexOf('outline'));
    expect([...plan].sort()).toEqual([...write, 'timeline'].sort());
    expect(primaryTabsFor('universal', 'plan')).toEqual(primaryTabsFor('universal', 'write'));
    expect(primaryTabsFor('novel', 'revise')).toEqual(write);
  });

  it('每个预设的落点模块都在自己的首层导航里,且首层无重复', () => {
    for (const preset of WORKSPACE_PRESETS) {
      const tabs = WORKSPACE_PRIMARY_TABS[preset];
      expect(tabs.length).toBeGreaterThan(0);
      expect(new Set(tabs).size).toBe(tabs.length);
      expect(tabs).toContain(presetHomeTab(preset));
    }
  });

  it('「设」阶段任何题材都能进,把设定集提到最前且不增删模块', () => {
    for (const preset of WORKSPACE_PRESETS) {
      const write = primaryTabsFor(preset, 'write');
      const codex = primaryTabsFor(preset, 'codex');
      expect([...codex].sort()).toEqual([...new Set([...write, 'entities', 'map', 'timeline', 'planning', 'research'])].sort());
      if (preset !== 'universal') expect(codex[0]).toBe('entities');
    }
    expect(primaryTabsFor('universal', 'codex')).toEqual(primaryTabsFor('universal', 'write'));
  });
});
