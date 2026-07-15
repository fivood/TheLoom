import { describe, expect, it } from 'vitest';
import { sampleProject } from './sample';
import type { Project } from './types';
import {
  addAttachment, detachAssetEverywhere, normalizeHex, normalizeProject,
  parsePaletteJson, removeAttachment,
} from './util';

describe('normalizeProject', () => {
  it('补齐旧项目缺失的模块字段', () => {
    const legacy = sampleProject() as unknown as Record<string, unknown>;
    const keys = [
      'flows', 'entities', 'brainstormNotes', 'brainstormEdges', 'outlineColumns', 'outlineRows',
      'timelineTracks', 'timelinePoints', 'timelineEvents', 'maps', 'researchCards',
      'researchCategories', 'variables', 'entityTemplates', 'assets', 'documents',
      'documentCategories', 'attachments', 'folders', 'nodeTemplates', 'palettes',
    ];
    for (const key of keys) delete legacy[key];

    const project = normalizeProject(legacy as unknown as Project) as unknown as Record<string, unknown>;

    for (const key of keys) expect(project[key]).toBeDefined();
    expect(project.timelineTracks).toEqual([]);
    expect(project.attachments).toEqual({});
    expect(project.nodeTemplates).toEqual({});
  });
});

describe('配色导入', () => {
  it('规范化颜色并忽略无效值', () => {
    expect(normalizeHex('ABC')).toBe('#aabbcc');
    expect(normalizeHex('#12ef90')).toBe('#12ef90');
    expect(normalizeHex('not-a-color')).toBeNull();
    expect(parsePaletteJson(JSON.stringify([
      { name: '夜景', colors: ['#123', '445566', 'oops'] },
    ]))).toEqual([{ name: '夜景', colors: ['#112233', '#445566'] }]);
  });
});

describe('附件级联', () => {
  it('避免重复附件并在移除最后一项时清理映射', () => {
    const project = sampleProject();
    project.attachments = {};

    expect(addAttachment(project, 'owner', 'asset-a')).toEqual(['asset-a']);
    expect(addAttachment(project, 'owner', 'asset-a')).toEqual(['asset-a']);
    expect(removeAttachment(project, 'owner', 'asset-a')).toEqual([]);
    expect(project.attachments).toEqual({});
  });

  it('从所有对象引用中级联移除已删除资源', () => {
    const project = sampleProject();
    project.attachments = {
      first: ['asset-a', 'asset-b', 'asset-a'],
      second: ['asset-a'],
      third: ['asset-b'],
    };

    detachAssetEverywhere(project, 'asset-a');

    expect(project.attachments).toEqual({ first: ['asset-b'], third: ['asset-b'] });
  });
});
