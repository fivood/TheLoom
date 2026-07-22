import { describe, it, expect } from 'vitest';
import { makeZip, readZip, readEntryText } from './zip';
import { writeXlsx, readXlsx, columnName } from './xlsx';
import { paragraphsToFdx, parseFdx, documentToParagraphs, paragraphsToBlocks, previewFdxImport } from './fdx';
import { projectToXlsx, previewProjectXlsx } from './projectXlsx';
import type { Document, Entity, Project } from '../types';

/** 一个最小 Project(补齐必填字段) */
function makeProject(overrides: Partial<Project> = {}): Project {
  const base: Project = {
    version: 1, name: '测试项目',
    flows: [], entities: [], brainstormNotes: [], brainstormEdges: [],
    outlineColumns: [], outlineRows: [],
    timelineTracks: [], timelinePoints: [], timelineEvents: [],
    maps: [], researchCards: [], researchCategories: [],
    variables: [], assets: [], documents: [], documentCategories: [],
    attachments: {}, folders: [], nodeTemplates: {}, palettes: [],
    updatedAt: 0,
  };
  return { ...base, ...overrides };
}

describe('zip 读写往返', () => {
  it('多文件往返(UTF-8 名称 + 二进制)', async () => {
    const bin = new Uint8Array([0, 1, 2, 3, 255, 254]);
    const blob = await makeZip([
      { name: 'hello.txt', content: 'Hello, 世界!' },
      { name: '文件夹/嵌套.txt', content: '中文内容多次重复'.repeat(50) },
      { name: 'raw.bin', content: bin },
    ]);
    const entries = await readZip(new Uint8Array(await blob.arrayBuffer()));
    expect(entries.length).toBe(3);
    const m = new Map(entries.map((e) => [e.name, e]));
    expect(readEntryText(m.get('hello.txt')!)).toBe('Hello, 世界!');
    expect(readEntryText(m.get('文件夹/嵌套.txt')!)).toBe('中文内容多次重复'.repeat(50));
    expect(Array.from(m.get('raw.bin')!.content)).toEqual(Array.from(bin));
  });
});

describe('xlsx 列名映射', () => {
  it('columnName 覆盖 A / Z / AA / ZZ', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(51)).toBe('AZ');
    expect(columnName(52)).toBe('BA');
    expect(columnName(701)).toBe('ZZ');
  });
});

describe('xlsx 单 sheet 往返', () => {
  it('文本 / 数字 / 布尔混合', async () => {
    const blob = await writeXlsx([{
      name: '基础表',
      rows: [
        ['ID', '名称', '年龄', '在编'],
        ['e1', '塞梅尔维斯', 128, true],
        ['e2', '瓦伦缇娜', 1200, false],
      ],
    }]);
    const parsed = await readXlsx(new Uint8Array(await blob.arrayBuffer()));
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe('基础表');
    expect(parsed[0].rows[0]).toEqual(['ID', '名称', '年龄', '在编']);
    expect(parsed[0].rows[1]).toEqual(['e1', '塞梅尔维斯', '128', 'true']);
    expect(parsed[0].rows[2]).toEqual(['e2', '瓦伦缇娜', '1200', 'false']);
  });

  it('特殊字符与空单元格保留列位', async () => {
    const blob = await writeXlsx([{
      name: '特殊',
      rows: [
        ['a', 'b', 'c'],
        ['<xml> & "quote"', '', "'apo"],
      ],
    }]);
    const parsed = await readXlsx(new Uint8Array(await blob.arrayBuffer()));
    expect(parsed[0].rows[1]).toEqual(['<xml> & "quote"', '', "'apo"]);
  });
});

describe('项目 xlsx 往返', () => {
  it('实体 / 变量 / 时间线 / 大纲导出并回读稳定', async () => {
    const trackId = 't1', pointId = 'p1', semId = 'ent-sem';
    const project = makeProject({
      entities: [
        { id: semId, kind: 'character', name: '塞梅尔维斯', color: '#111', emoji: '', summary: '调查员',
          fields: [{ id: 'f1', label: '欲望', value: '安静', type: undefined }],
          notes: '', technicalName: 'semelvie', createdAt: 1 },
      ],
      variables: [
        { id: 'v1', name: 'has_address', type: 'boolean', value: 'false', description: '是否知道地址' },
        { id: 'v2', name: 'focus', type: 'number', value: '3', description: '感知' },
      ],
      timelineTracks: [{ id: trackId, name: '明线', color: '#111' }],
      timelinePoints: [{ id: pointId, label: '16:09' }],
      timelineEvents: [{ id: 'te1', trackId, pointId, title: '第一条短信', text: '', entityIds: [semId] }],
      outlineColumns: [{ id: 'oc1', title: '感情线', color: '#565550' }],
      outlineRows: [{ id: 'or1', no: '1', time: '雨夜', title: '开场', main: '塞收到短信', cells: { oc1: '瓦已经被困' } }],
    });

    const blob = await projectToXlsx(project);
    const empty = makeProject();
    const preview = await previewProjectXlsx(new Uint8Array(await blob.arrayBuffer()), empty);

    expect(preview.errors).toEqual([]);
    expect(preview.next.entities.length).toBe(1);
    expect(preview.next.entities[0].id).toBe(semId);
    expect(preview.next.entities[0].name).toBe('塞梅尔维斯');
    expect(preview.next.entities[0].technicalName).toBe('semelvie');
    expect(preview.next.entities[0].fields.length).toBe(1);
    expect(preview.next.entities[0].fields[0].label).toBe('欲望');
    expect(preview.next.variables.length).toBe(2);
    expect(preview.next.variables.find((v) => v.name === 'focus')?.type).toBe('number');
    expect(preview.next.timelineTracks.length).toBe(1);
    expect(preview.next.timelinePoints.length).toBe(1);
    expect(preview.next.timelineEvents.length).toBe(1);
    expect(preview.next.timelineEvents[0].entityIds).toEqual([semId]);
    expect(preview.next.outlineColumns.length).toBe(1);
    expect(preview.next.outlineRows.length).toBe(1);
    expect(preview.next.outlineRows[0].cells.oc1).toBe('瓦已经被困');
  });

  it('第二次导入相同 xlsx 不产生新对象(按 ID 更新)', async () => {
    const trackId = 't1', pointId = 'p1', semId = 'ent-sem';
    const project = makeProject({
      entities: [{ id: semId, kind: 'character', name: '塞梅尔维斯', color: '#111', emoji: '', summary: '', fields: [], notes: '', createdAt: 1 }],
      variables: [{ id: 'v1', name: 'x', type: 'boolean', value: 'false', description: '' }],
      timelineTracks: [{ id: trackId, name: '明线', color: '#111' }],
      timelinePoints: [{ id: pointId, label: '傍晚' }],
      folders: [
        { id: 'volume', name: '第一卷', module: 'document', documentRole: 'volume' },
        { id: 'chapter', name: '第一章', module: 'document', parentId: 'volume', documentRole: 'chapter' },
      ],
      documents: [{ id: 'doc-1', name: '开场', folderId: 'chapter', category: '正文', blocks: [], notes: '', createdAt: 1, updatedAt: 1 }],
      outlineRows: [{ id: 'row-1', no: '1', time: '', title: '开场', main: '', cells: {}, chapterFolderId: 'chapter' }],
      timelineEvents: [{ id: 'te1', trackId, pointId, title: '事件', text: '', entityIds: [], documentIds: ['doc-1'] }],
    });
    const blob = await projectToXlsx(project);
    const preview = await previewProjectXlsx(new Uint8Array(await blob.arrayBuffer()), project);
    expect(preview.next.entities.length).toBe(project.entities.length);
    expect(preview.next.variables.length).toBe(project.variables.length);
    expect(preview.next.timelineEvents.length).toBe(project.timelineEvents.length);
    expect(preview.next.timelineEvents[0].documentIds).toEqual(['doc-1']);
    expect(preview.next.outlineRows[0].chapterFolderId).toBe('chapter');
    expect(preview.counts.entities.add).toBe(0);
    expect(preview.counts.variables.add).toBe(0);
    expect(preview.counts.timelineEvents.add).toBe(0);
  });
});

describe('Final Draft fdx 往返', () => {
  it('段落 → fdx → 段落', () => {
    const paragraphs = [
      { type: 'Scene Heading' as const, text: 'INT. 遮阳篷 · 16:09' },
      { type: 'Action' as const, text: '塞梅尔维斯掏出德制直板手机。' },
      { type: 'Character' as const, text: '瓦伦缇娜' },
      { type: 'Parenthetical' as const, text: '(慢条斯理)' },
      { type: 'Dialogue' as const, text: '我需要你的帮助,亲爱的。' },
    ];
    const xml = paragraphsToFdx(paragraphs, '雨夜寻人');
    const parsed = parseFdx(xml);
    expect(parsed.length).toBe(5);
    expect(parsed[0]).toEqual({ type: 'Scene Heading', text: 'INT. 遮阳篷 · 16:09' });
    expect(parsed[2]).toEqual({ type: 'Character', text: '瓦伦缇娜' });
    expect(parsed[3].text).toBe('(慢条斯理)');
    expect(parsed[4].text).toBe('我需要你的帮助,亲爱的。');
  });

  it('文档 → 段落 → 文档块(角色名匹配到实体 id)', () => {
    const semId = 'ent-sem';
    const valId = 'ent-val';
    const entities: Entity[] = [
      { id: semId, kind: 'character', name: '塞梅尔维斯', color: '#111', emoji: '', summary: '', fields: [], notes: '', createdAt: 1 },
      { id: valId, kind: 'character', name: '瓦伦缇娜', color: '#222', emoji: '', summary: '', fields: [], notes: '', createdAt: 2 },
    ];
    const doc: Document = {
      id: 'd1', name: '第一幕', category: '剧本草稿', notes: '',
      createdAt: 1, updatedAt: 2,
      blocks: [
        { id: 'b1', type: 'heading', text: '雨夜' },
        { id: 'b2', type: 'action', text: '雨打在遮阳篷上。' },
        { id: 'b3', type: 'dialogue', text: '……?', speakerId: semId },
        { id: 'b4', type: 'dialogue', text: '亲爱的,你还在吗?', speakerId: valId },
      ],
    };
    const paragraphs = documentToParagraphs(doc, entities);
    // 至少一段 Scene Heading + 两段 Character/Dialogue 组合
    expect(paragraphs.some((p) => p.type === 'Scene Heading' && p.text === '雨夜')).toBe(true);
    const nameMap = new Map(entities.map((e) => [e.name, e.id]));
    const blocks = paragraphsToBlocks(paragraphs, nameMap);
    const dialog = blocks.filter((b) => b.type === 'dialogue');
    expect(dialog.length).toBe(2);
    expect(dialog[0].speakerId).toBe(semId);
    expect(dialog[1].speakerId).toBe(valId);
    expect(dialog[0].text).toBe('……?');
  });

  it('导入预检:统计未识别的说话人', () => {
    const project = makeProject({
      entities: [
        { id: 'ent-sem', kind: 'character', name: '塞梅尔维斯', color: '#111', emoji: '', summary: '', fields: [], notes: '', createdAt: 1 },
      ],
    });
    const xml = paragraphsToFdx([
      { type: 'Scene Heading', text: '场景 A' },
      { type: 'Character', text: '塞梅尔维斯' },
      { type: 'Dialogue', text: '进来。' },
      { type: 'Character', text: '陌生人' },
      { type: 'Dialogue', text: '你好。' },
    ]);
    const preview = previewFdxImport(xml, project);
    expect(preview.paragraphCount).toBe(5);
    expect(preview.sceneCount).toBe(1);
    expect(preview.dialogueCount).toBe(2);
    expect(preview.unknownSpeakers).toEqual(['陌生人']);
  });
});
