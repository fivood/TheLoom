import { describe, expect, it } from 'vitest';
import { sampleProject } from '../sample';
import { normalizeProject } from '../util';
import { parseModelJson } from './llm';
import {
  applyAiImportPreview, buildAiImportPreview, normalizeExtracted, normalizeFieldFill, pushAiLog,
} from './extract';

describe('parseModelJson', () => {
  it('剥离围栏与前后噪声', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('好的,结果如下:\n{"a":1}\n以上。')).toEqual({ a: 1 });
    expect(parseModelJson('{"a":{"b":2}}')).toEqual({ a: { b: 2 } });
  });
  it('无效 JSON 抛出带片段的错误', () => {
    expect(() => parseModelJson('抱歉,我无法处理')).toThrow(/不是有效 JSON/);
  });
});

describe('normalizeExtracted', () => {
  it('校验类型、丢弃非法条目并给出警告', () => {
    const { data, warnings } = normalizeExtracted({
      entities: [
        { kind: 'character', name: '阿珂', summary: '主角' },
        { kind: '外星飞船', name: '曙光号' },
        { name: '' },
        { kind: 'character', name: '阿珂', summary: '重复' },
      ],
      scenes: [
        { title: '桥上', blocks: [{ type: 'action', text: '风很大。' }, { type: '???', text: '降级为动作' }, { type: 'dialogue', text: '' }] },
        { title: '空场景', blocks: [] },
      ],
      timelinePoints: ['第1日', '第1日', ''],
      timelineEvents: [
        { point: '第2日', title: '相遇', entities: ['阿珂'] },
        { point: '', title: '无效' },
      ],
    });
    expect(data.entities.map((e) => e.name)).toEqual(['阿珂', '曙光号']);
    expect(data.entities[1].kind).toBe('concept');
    expect(data.scenes).toHaveLength(1);
    expect(data.scenes[0].blocks).toHaveLength(2);
    expect(data.timelinePoints).toEqual(['第1日', '第2日']);
    expect(data.timelineEvents).toHaveLength(1);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});

describe('buildAiImportPreview + apply', () => {
  it('同名实体只补空白;新实体、场景、时间线走新增;说话人映射', () => {
    const project = sampleProject();
    normalizeProject(project);
    const existing = project.entities[0];
    existing.summary = '已有简介,不该被覆盖';

    const { data } = normalizeExtracted({
      entities: [
        { kind: 'character', name: existing.name, summary: '新简介', fields: [{ label: 'AI新字段', value: '值' }] },
        { kind: 'location', name: '风车镇', summary: '边境小镇' },
      ],
      scenes: [
        {
          title: '第一场',
          blocks: [
            { type: 'heading', text: '第一场' },
            { type: 'dialogue', speaker: existing.name, text: '你来了。' },
            { type: 'dialogue', speaker: '神秘人', text: '……' },
          ],
        },
      ],
      timelinePoints: [project.timelinePoints[0]?.label ?? '第1日', '全新时间点'],
      timelineEvents: [{ point: '全新时间点', title: '抵达', entities: ['风车镇'] }],
    });

    const preview = buildAiImportPreview(project, data);
    expect(preview.counts.entities.add).toBe(1);
    expect(preview.counts.entities.update).toBe(1);
    expect(preview.entityUpdates[0].setSummary).toBeUndefined();
    expect(preview.entityUpdates[0].addFields.map((f) => f.label)).toEqual(['AI新字段']);
    expect(preview.counts.scenes.add).toBe(1);
    expect(preview.unknownSpeakers).toEqual(['神秘人']);
    expect(preview.newDocs[0].blocks[1].speakerId).toBe(existing.id);
    expect(preview.counts.timelinePoints.add).toBe(1);
    expect(preview.newEvents).toHaveLength(1);

    const before = {
      entities: project.entities.length,
      docs: project.documents.length,
      points: project.timelinePoints.length,
      events: project.timelineEvents.length,
    };
    applyAiImportPreview(project, preview);
    expect(project.entities.length).toBe(before.entities + 1);
    expect(project.documents.length).toBe(before.docs + 1);
    expect(project.timelinePoints.length).toBe(before.points + 1);
    expect(project.timelineEvents.length).toBe(before.events + 1);
    expect(project.documentCategories).toContain('AI 初稿');
    const updated = project.entities.find((e) => e.id === existing.id)!;
    expect(updated.summary).toBe('已有简介,不该被覆盖');
    expect(updated.fields.some((f) => f.label === 'AI新字段')).toBe(true);
    // 新对象走稳定 uid,normalize 后单元同步不报错
    normalizeProject(project);
    expect(project.documents.every((d) => d.blocks.every((b) => b.type !== 'dialogue' && b.type !== 'action' && b.type !== 'heading' ? true : !!b.unitId))).toBe(true);
  });

  it('没有时间线轨道时自动建「AI 导入」轨道', () => {
    const project = sampleProject();
    normalizeProject(project);
    project.timelineTracks = [];
    project.timelineEvents = [];
    const { data } = normalizeExtracted({
      entities: [], scenes: [],
      timelinePoints: [], timelineEvents: [{ point: '某日', title: '事件' }],
    });
    const preview = buildAiImportPreview(project, data);
    expect(preview.newTrack?.name).toBe('AI 导入');
    applyAiImportPreview(project, preview);
    expect(project.timelineTracks).toHaveLength(1);
    expect(project.timelineEvents[0].trackId).toBe(project.timelineTracks[0].id);
  });
});

describe('normalizeFieldFill', () => {
  it('只保留请求过的字段,大小写宽容', () => {
    expect(normalizeFieldFill({ 年龄: '27', Age: 'x', 无关: 'y', 职业: '' }, ['年龄', '职业'])).toEqual({ 年龄: '27' });
  });
});

describe('pushAiLog', () => {
  it('记录入队并封顶 50 条', () => {
    const project = sampleProject();
    normalizeProject(project);
    for (let i = 0; i < 55; i++) {
      pushAiLog(project, { provider: 'openai', model: 'm', purpose: 'extract', inChars: i, outChars: 0, ok: true });
    }
    expect(project.aiLog).toHaveLength(50);
    expect(project.aiLog![0].inChars).toBe(54);
  });
});
