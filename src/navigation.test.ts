import { beforeEach, describe, expect, it } from 'vitest';
import { describeNavTarget, useNav } from './search';
import { longNovelRegressionProject } from './test-fixtures/regressionProjects';

beforeEach(() => {
  useNav.setState({ target: null, seq: 0, current: null, backStack: [], recent: [] });
});

describe('R17-3 跨模块导航历史', () => {
  it('返回上一位置并保留最近访问对象', () => {
    useNav.getState().visit({ tab: 'outline', outlineRowId: 'row-1' }, '大纲 · 第一章');
    useNav.getState().go({ tab: 'documents', docId: 'doc-1' }, '场景 · 雨夜');
    expect(useNav.getState().backStack).toHaveLength(1);
    expect(useNav.getState().recent.map((visit) => visit.label)).toEqual(['场景 · 雨夜', '大纲 · 第一章']);

    useNav.getState().back();
    expect(useNav.getState().target).toEqual({ tab: 'outline', outlineRowId: 'row-1' });
    expect(useNav.getState().current?.label).toBe('大纲 · 第一章');
  });

  it('相同对象重复访问只保留一条，并更新实时标题', () => {
    const target = { tab: 'documents' as const, docId: 'doc-1' };
    useNav.getState().visit(target, '场景 · 旧标题');
    useNav.getState().visit(target, '场景 · 新标题');
    expect(useNav.getState().backStack).toEqual([]);
    expect(useNav.getState().recent).toEqual([{ target, label: '场景 · 新标题' }]);
  });

  it('模块首页进入默认对象时不额外增加一层返回记录', () => {
    useNav.getState().visit({ tab: 'outline' }, '大纲');
    useNav.getState().visit({ tab: 'documents' }, '文档');
    useNav.getState().visit({ tab: 'documents', docId: 'doc-1' }, '场景 · 雨夜');
    expect(useNav.getState().backStack.map((visit) => visit.label)).toEqual(['大纲']);
  });

  it('最近访问标题从权威对象读取，不保存标题副本', () => {
    const project = longNovelRegressionProject();
    const target = { tab: 'documents' as const, docId: 'doc-platform' };
    expect(describeNavTarget(project, target)).toContain(project.documents[0].name);
    project.documents[0].name = '改名后的站台';
    expect(describeNavTarget(project, target)).toBe('场景 · 改名后的站台');
    expect(describeNavTarget(project, { tab: 'planning', planningView: 'arcs', entityId: 'entity-1' })).toBe('规划 · 角色弧线');
  });

  it('导航名称跟随项目工作区术语', () => {
    const project = longNovelRegressionProject();
    project.workspacePreset = 'novel';
    expect(describeNavTarget(project, { tab: 'documents' })).toBe('正文');
    expect(describeNavTarget(project, { tab: 'entities', entityId: project.entities[0].id })).toBe(`人物 · ${project.entities[0].name}`);
    project.workspacePreset = 'interactive';
    expect(describeNavTarget(project, { tab: 'documents' })).toBe('剧本');
  });
});
