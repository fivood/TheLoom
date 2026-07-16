import { describe, expect, it } from 'vitest';
import type { Document, Entity, ResearchCard } from './types';
import {
  cardToMd, documentToMd, entityToMd, mdToCard, mdToDocument, mdToEntity,
  resolveEntityRefs,
} from './storage';

describe('文件夹 Markdown 往返', () => {
  it('保留实体身份、保留字段和实体引用', () => {
    const target: Entity = {
      id: 'entity-target', kind: 'character', name: '瓦伦缇娜', color: '#222222', emoji: '',
      summary: '', fields: [], notes: '', createdAt: 2,
    };
    const source: Entity = {
      id: 'entity-source', folderId: 'folder-entity', kind: 'character', name: '塞梅尔维斯', technicalName: 'semelvie',
      color: '#111111', emoji: 'S', summary: '简介', notes: '备注', createdAt: 1,
      fields: [
        { id: 'field-1', label: '同伴', value: target.id, type: 'entity', filterKind: 'character' },
        { id: 'field-2', label: 'kind', value: '自定义保留字段' },
      ],
    };
    const markdown = entityToMd(source, undefined, new Map([[target.id, target.name]]));
    const restored = mdToEntity(`${source.name}.md`, markdown, 0);
    resolveEntityRefs([restored, target]);

    expect(restored).toMatchObject({
      id: source.id,
      name: source.name,
      kind: source.kind,
      technicalName: source.technicalName,
      folderId: source.folderId,
      summary: source.summary,
      notes: source.notes,
      createdAt: source.createdAt,
    });
    expect(restored.fields.find((field) => field.label === '同伴')).toMatchObject({
      value: target.id, type: 'entity', filterKind: 'character',
    });
    expect(restored.fields.find((field) => field.label === 'kind')?.value).toBe('自定义保留字段');
  });

  it('保留资料卡内容和元数据', () => {
    const card: ResearchCard = {
      id: 'card-1', folderId: 'folder-research', title: '史料', content: '正文', category: '考据', tags: ['伦敦'],
      color: '#333333', source: '档案馆', pinned: true, createdAt: 3,
    };
    const restored = mdToCard(`${card.title}.md`, cardToMd(card), 0);
    expect(restored).toEqual(card);
  });

  it('保留文档块和选项的稳定 ID', () => {
    const document: Document = {
      id: 'doc-1', folderId: 'folder-document', name: '第一幕', technicalName: 'act_one', category: '正文', notes: '草稿',
      createdAt: 4, updatedAt: 5,
      blocks: [
        { id: 'block-heading', type: 'heading', text: '雨夜' },
        {
          id: 'block-choice', type: 'choice', text: '选择',
          choices: [{ id: 'choice-a', label: '追上去' }, { id: 'choice-b', label: '留下' }],
        },
      ],
    };
    const restored = mdToDocument(`${document.name}.md`, documentToMd(document, []), 0);

    expect(restored).toMatchObject({
      id: document.id,
      name: document.name,
      technicalName: document.technicalName,
      folderId: document.folderId,
      category: document.category,
      notes: document.notes,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    });
    expect(restored.blocks).toEqual(document.blocks);
  });

  it('兼容没有块 ID 的旧版文档', () => {
    const markdown = `---
loom: document
id: doc-old
category: 正文
---

\`\`\`yaml loom-blocks
- type: choice
  text: 选择
  choices:
    - label: 继续
\`\`\`
`;
    const restored = mdToDocument('旧文档.md', markdown, 0);

    expect(restored.blocks[0].id).toHaveLength(12);
    expect(restored.blocks[0].choices?.[0].id).toHaveLength(12);
    expect(restored.blocks[0].choices?.[0].label).toBe('继续');
  });

  it('order 字段在实体 / 资料 / 文档间无损往返', () => {
    const entity: Entity = {
      id: 'e-order', folderId: 'f1', order: 3, kind: 'character', name: '有序实体',
      color: '#111', emoji: '', summary: '', fields: [], notes: '', createdAt: 1,
    };
    const restoredE = mdToEntity(`${entity.name}.md`, entityToMd(entity), 0);
    expect(restoredE.order).toBe(3);
    expect(restoredE.folderId).toBe('f1');

    const card: ResearchCard = {
      id: 'c-order', folderId: 'f2', order: 7, title: '有序卡片', content: '', category: '考据', tags: [],
      color: '#333', source: '', pinned: false, createdAt: 2,
    };
    const restoredC = mdToCard(`${card.title}.md`, cardToMd(card), 0);
    expect(restoredC.order).toBe(7);

    const doc: Document = {
      id: 'd-order', folderId: 'f3', order: 12, name: '有序文档', category: '正文', notes: '',
      blocks: [{ id: 'b1', type: 'heading', text: '标题' }], createdAt: 3, updatedAt: 4,
    };
    const restoredD = mdToDocument(`${doc.name}.md`, documentToMd(doc, []), 0);
    expect(restoredD.order).toBe(12);
  });

  it('R1-3 写作块 subheading / quote / list 无损往返', () => {
    const doc: Document = {
      id: 'doc-writing', name: '长篇', category: '正文', notes: '',
      createdAt: 1, updatedAt: 2,
      blocks: [
        { id: 'b-sh2', type: 'subheading', text: '第一章', level: 2 },
        { id: 'b-sh3', type: 'subheading', text: '第一节', level: 3 },
        { id: 'b-quote', type: 'quote', text: '一段引用\n跨两行' },
        { id: 'b-ul', type: 'list', text: '', items: ['苹果', '梨子', '橙子'], ordered: false },
        { id: 'b-ol', type: 'list', text: '', items: ['起', '承', '转', '合'], ordered: true },
      ],
    };
    const restored = mdToDocument(`${doc.name}.md`, documentToMd(doc, []), 0);
    expect(restored.blocks).toEqual(doc.blocks);
  });

  it('order 缺失时往返保持 undefined', () => {
    const entity: Entity = {
      id: 'e-no-order', kind: 'character', name: '无序实体',
      color: '#111', emoji: '', summary: '', fields: [], notes: '', createdAt: 1,
    };
    const restoredE = mdToEntity(`${entity.name}.md`, entityToMd(entity), 0);
    expect(restoredE.order).toBeUndefined();
  });
});
