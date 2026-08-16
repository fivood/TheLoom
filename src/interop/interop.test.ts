import { describe, it, expect } from 'vitest';
import { makeZip, readZip, readEntryText } from './zip';
import { paragraphsToFdx, parseFdx, documentToParagraphs, paragraphsToBlocks, previewFdxImport } from './fdx';
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
