import { describe, expect, it } from 'vitest';
import { sampleProject } from '../sample';
import { normalizeProject } from '../util';
import {
  applyProjectImport, buildProjectImportPreview, materialsToText,
  normalizeGenerated, normalizePlan, suggestProjectKind, type SourceMaterial,
} from './projectImport';

const mat = (over: Partial<SourceMaterial>): SourceMaterial => ({
  id: 'm1', name: '材料', kind: 'manuscript', trust: 'normal', text: '', ...over,
});

describe('materialsToText', () => {
  it('带来源标注拼接,超过 20 万字截断', () => {
    const { text, truncated } = materialsToText([
      mat({ name: '第一卷', kind: 'manuscript', trust: 'canon', text: '正文内容' }),
      mat({ id: 'm2', name: '设定集', kind: 'setting', text: '设定内容' }),
    ]);
    expect(text).toContain('材料:第一卷 | 类型:正文 | 可信度:定稿(权威)');
    expect(text).toContain('设定内容');
    expect(truncated).toBe(false);

    const big = materialsToText([mat({ text: 'x'.repeat(250000) })]);
    expect(big.truncated).toBe(true);
    expect(big.text.length).toBeLessThanOrEqual(200000);
  });
});

describe('normalizePlan', () => {
  it('校验卷章结构与实体,pending 保留来源引文', () => {
    const { plan, warnings } = normalizePlan({
      projectName: '未归档报告',
      summary: '概述',
      volumes: [
        { title: '第一卷', chapters: [{ title: '第一章', scenes: ['雨夜', '来客'] }, { title: '' }] },
      ],
      entities: [{ kind: 'character', name: '塞梅尔维斯' }, { kind: '???', name: '血食怪' }, { name: '' }],
      timelineTracks: ['主线'],
      pending: [
        { topic: '主角年龄', options: [{ claim: '27', source: '设定集', evidence: '「二十七岁」' }] },
        { topic: '' },
      ],
    });
    expect(plan.projectName).toBe('未归档报告');
    expect(plan.volumes[0].chapters).toHaveLength(1);
    expect(plan.volumes[0].chapters[0].scenes).toEqual(['雨夜', '来客']);
    expect(plan.entities).toHaveLength(2);
    expect(plan.entities[1].kind).toBe('concept');
    expect(plan.pending).toHaveLength(1);
    expect(plan.pending[0].options[0].evidence).toBe('「二十七岁」');
    expect(warnings).toHaveLength(0);
  });

  it('空计划给出警告', () => {
    const { warnings } = normalizePlan({});
    expect(warnings.some((w) => w.includes('卷章'))).toBe(true);
  });
});

describe('normalizeGenerated + buildProjectImportPreview + apply', () => {
  function fullFixture() {
    const project = sampleProject();
    normalizeProject(project);
    project.timelineTracks = [];
    project.timelineEvents = [];
    project.timelinePoints = [];
    project.maps = [];
    const existing = project.entities[0];

    const { plan } = normalizePlan({
      projectName: '测试书',
      volumes: [{ title: '第一卷', chapters: [{ title: '第一章', scenes: ['雨夜', '来客'] }] }],
      entities: [],
      timelineTracks: ['主线'],
      pending: [{ topic: '计划阶段的分歧', options: [] }],
    });

    const { data, warnings } = normalizeGenerated({
      structure: [{
        title: '第一卷',
        chapters: [{
          title: '第一章',
          scenes: [
            {
              title: '雨夜', pov: '林晚', location: '灯塔', time: '第1日', source: '第一卷正文',
              blocks: [
                { type: 'heading', text: '雨夜' },
                { type: 'action', text: '雨下了一整夜。' },
                { type: 'dialogue', speaker: '林晚', text: '灯还亮着。' },
              ],
            },
            { title: '来客', pov: '', location: '', time: '', source: '', blocks: [{ type: 'action', text: '有人敲门。' }] },
          ],
        }],
      }],
      entities: [
        { kind: 'character', name: '林晚', summary: '守灯人', fields: [{ label: '年龄', value: '34' }], source: '设定集', evidence: '「三十四岁的守灯人」' },
        { kind: 'location', name: '灯塔', summary: '' },
        { kind: 'character', name: existing.name, summary: '不该覆盖', fields: [] },
      ],
      relations: [
        { from: '林晚', to: '灯塔', label: '驻守', bidirectional: false },
        { from: '不存在的人', to: '林晚', label: '未知' },
      ],
      arcs: [
        { entity: '林晚', stages: [{ title: '守望', note: '', scene: '雨夜' }, { title: '动摇', note: '', scene: '来客' }] },
        { entity: '不存在的人', stages: [{ title: 'x', note: '', scene: '' }] },
      ],
      foreshadows: [{ title: '没有灯的船', note: '', plants: ['雨夜'], payoffs: ['来客'] }],
      outline: [{ no: '1', title: '第一章', time: '第1日', main: '灯塔来客' }],
      timelinePoints: ['第1日'],
      timelineEvents: [{ point: '第1日', title: '船靠岸', text: '', entities: ['林晚'] }],
      brainstorm: ['候选:双线叙事'],
      pending: [{ topic: '船的来历', options: [{ claim: '走私船', source: 'AI 咨询', evidence: '' }] }],
    });

    const materials = [mat({ name: '第一卷正文', trust: 'canon', text: '雨下了一整夜……(原文)' })];
    const preview = buildProjectImportPreview(project, plan, data, materials, warnings);
    return { project, plan, data, preview, existing };
  }

  it('生成完整差异:文件夹树 / 场景元数据 / 关系弧线伏笔 / 备份与待定', () => {
    const { preview, existing } = fullFixture();

    expect(preview.counts['卷 / 章(文件夹)'].add).toBe(2);
    expect(preview.counts['场景文档'].add).toBe(2);
    const chFolder = preview.newFolders.find((f) => f.name === '第一章')!;
    expect(chFolder.parentId).toBe(preview.newFolders.find((f) => f.name === '第一卷')!.id);
    const rainDoc = preview.newDocs.find((d) => d.name === '雨夜')!;
    expect(rainDoc.folderId).toBe(chFolder.id);
    expect(rainDoc.status).toBe('outline');
    expect(rainDoc.timeLabel).toBe('第1日');
    const linwan = preview.newEntities.find((e) => e.name === '林晚')!;
    expect(rainDoc.povId).toBe(linwan.id);
    expect(rainDoc.locationId).toBe(preview.newEntities.find((e) => e.name === '灯塔')!.id);
    expect(rainDoc.blocks[2].speakerId).toBe(linwan.id);
    expect(linwan.notes).toContain('来源:设定集');

    // 同名实体只补空白
    expect(preview.newEntities.some((e) => e.name === existing.name)).toBe(false);

    // 关系 / 弧线:不可解析的丢弃并告警
    expect(preview.newRelations).toHaveLength(1);
    expect(preview.newArcs).toHaveLength(2);
    expect(preview.newArcs[0].docId).toBe(rainDoc.id);
    expect(preview.warnings.some((w) => w.includes('不存在的人'))).toBe(true);

    // 伏笔 plants/payoffs 解析到文档
    expect(preview.newForeshadows[0].plants[0].docId).toBe(rainDoc.id);
    expect(preview.newForeshadows[0].payoffs[0].docId).toBe(preview.newDocs.find((d) => d.name === '来客')!.id);

    // 材料原文备份 + 待定卡(计划与生成阶段合并)
    const backup = preview.newCards.find((c) => c.category === '原始材料')!;
    expect(backup.content).toContain('(原文)');
    const pendingCards = preview.newCards.filter((c) => c.category === '待定设定');
    expect(pendingCards.map((c) => c.title)).toEqual(['【待定】船的来历', '【待定】计划阶段的分歧']);
    expect(pendingCards[0].pinned).toBe(true);
    expect(pendingCards[0].content).toContain('走私船');

    // 风暴板与空轨道
    expect(preview.newNotes.some((n) => n.text === '候选:双线叙事')).toBe(true);
    expect(preview.newTrack?.name).toBe('主线');
    expect(preview.newMap?.name).toContain('待补底图');
  });

  it('事务式 apply:全部落库且 normalize 后叙事单元齐全', () => {
    const { project, preview } = fullFixture();
    const before = {
      folders: project.folders.length, docs: project.documents.length,
      entities: project.entities.length, cards: project.researchCards.length,
    };
    applyProjectImport(project, preview);
    expect(project.folders.length).toBe(before.folders + 2);
    expect(project.documents.length).toBe(before.docs + 2);
    expect(project.entities.length).toBe(before.entities + 2);
    expect(project.researchCards.length).toBe(before.cards + 3);
    expect(project.relations!.length).toBeGreaterThan(0);
    expect(project.documentCategories).toContain('AI 初稿');
    expect(project.researchCategories).toContain('待定设定');
    // 不生成游戏机制
    expect(project.variables).toHaveLength(sampleProject().variables.length);

    normalizeProject(project);
    const rain = project.documents.find((d) => d.name === '雨夜')!;
    expect(rain.blocks.every((b) => !!b.unitId)).toBe(true);
    expect(project.arcs!.every((a) => project.entities.some((e) => e.id === a.entityId))).toBe(true);
  });
});

describe('suggestProjectKind', () => {
  it('正文占比高建议长篇,否则默认长篇但说明可改', () => {
    const heavy = suggestProjectKind([mat({ kind: 'manuscript', text: 'x'.repeat(50000) })]);
    expect(heavy.kind).toBe('novel');
    expect(heavy.reason).toContain('正文');
    const light = suggestProjectKind([mat({ kind: 'note', text: '一点笔记' })]);
    expect(light.reason).toContain('短篇集');
  });
});
