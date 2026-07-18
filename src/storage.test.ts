import { describe, expect, it } from 'vitest';
import { sampleProject } from './sample';
import type { Document, Entity, ResearchCard } from './types';
import {
  assignDocumentFilenames, cardToMd, documentToMd, entityToMd, mdToCard, mdToDocument, mdToEntity,
  projectToFolderJson, resolveEntityRefs,
} from './storage';

describe('文件夹 Markdown 往返', () => {
  it('保留实体身份、保留字段和实体引用', () => {
    const target: Entity = {
      id: 'entity-target', kind: 'character', name: '瓦伦缇娜', color: '#222222', emoji: '',
      summary: '', fields: [], notes: '', createdAt: 2,
    };
    const source: Entity = {
      id: 'entity-source', favorite: true, folderId: 'folder-entity', kind: 'character', name: '塞梅尔维斯', technicalName: 'semelvie',
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
      favorite: true,
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
      id: 'card-1', favorite: true, folderId: 'folder-research', title: '史料', content: '正文', category: '考据', tags: ['伦敦'],
      color: '#333333', source: '档案馆', pinned: true, createdAt: 3,
    };
    const restored = mdToCard(`${card.title}.md`, cardToMd(card), 0);
    expect(restored).toEqual(card);
  });

  it('保留文档块和选项的稳定 ID', () => {
    const document: Document = {
      id: 'doc-1', favorite: true, folderId: 'folder-document', name: '第一幕', technicalName: 'act_one', category: '正文', notes: '草稿',
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
      favorite: true,
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

  it('正文 Markdown 是权威内容,Obsidian 修改可读正文后保留块身份与流程角色', () => {
    const doc: Document = {
      id: 'doc-authoring',
      name: '雨夜',
      linkedFlowId: 'flow-rain',
      category: '正文',
      notes: '',
      createdAt: 1,
      updatedAt: 2,
      blocks: [
        { id: 'b-paragraph', type: 'paragraph', text: '她推开门。', flowRole: 'none' },
        { id: 'b-beat', type: 'paragraph', text: '灯突然熄灭。', flowRole: 'beat', unitId: 'unit-beat' },
      ],
    };
    const markdown = documentToMd(doc, []);
    expect(markdown).toContain('<!-- loom:block');
    expect(markdown).not.toContain('```yaml loom-blocks');

    const restored = mdToDocument('第一卷/第一章/雨夜.md', markdown.replace('她推开门。', '她悄悄推开门。'), 0);
    expect(restored.name).toBe('雨夜');
    expect(restored.linkedFlowId).toBe('flow-rain');
    expect(restored.blocks[0]).toMatchObject({
      id: 'b-paragraph', type: 'paragraph', text: '她悄悄推开门。', flowRole: 'none',
    });
    expect(restored.blocks[1]).toMatchObject({
      id: 'b-beat', type: 'paragraph', text: '灯突然熄灭。', flowRole: 'beat', unitId: 'unit-beat',
    });
  });

  it('没有织机标记的普通 Markdown 按自然段导入为正文块', () => {
    const restored = mdToDocument('外部场景.md', '# 外部场景\n\n第一段。\n\n第二段。', 0);
    expect(restored.blocks.map((block) => block.type)).toEqual(['paragraph', 'paragraph']);
    expect(restored.blocks.map((block) => block.text)).toEqual(['第一段。', '第二段。']);
    expect(restored.blocks.every((block) => block.flowRole === 'none')).toBe(true);
  });

  it('文档文件路径按卷 / 章 Navigator 映射为真实子目录', () => {
    const project = sampleProject();
    project.folders.push(
      { id: 'volume', module: 'document', name: '第一卷', parentId: null },
      { id: 'chapter', module: 'document', name: '第一章', parentId: 'volume' },
    );
    project.documents = [{
      id: 'scene', folderId: 'chapter', name: '雨夜', category: '正文', notes: '',
      blocks: [{ id: 'p', type: 'paragraph', text: '正文', flowRole: 'none' }],
      createdAt: 1, updatedAt: 2,
    }];

    expect([...assignDocumentFilenames(project.documents, project.folders).keys()])
      .toEqual(['第一卷/第一章/雨夜.md']);
  });

  it('order 缺失时往返保持 undefined', () => {
    const entity: Entity = {
      id: 'e-no-order', kind: 'character', name: '无序实体',
      color: '#111', emoji: '', summary: '', fields: [], notes: '', createdAt: 1,
    };
    const restoredE = mdToEntity(`${entity.name}.md`, entityToMd(entity), 0);
    expect(restoredE.order).toBeUndefined();
  });

  it('文件夹 project.json 保留保存查询,正文对象继续由 Markdown 承载', () => {
    const project = sampleProject();
    project.savedQueries = [{
      id: 'query-1',
      name: '未引用资源',
      query: {
        objectType: 'asset',
        text: '',
        folderId: 'ungrouped',
        attributeName: '',
        attributeValue: '',
        tags: ['概念图'],
        status: 'any',
        references: 'unreferenced',
      },
      createdAt: 1,
      updatedAt: 2,
    }];

    const restored = JSON.parse(projectToFolderJson(project));

    expect(restored.savedQueries).toEqual(project.savedQueries);
    expect(restored.entities).toEqual([]);
    expect(restored.researchCards).toEqual([]);
    expect(restored.documents).toEqual([]);
    expect(restored.flows).toHaveLength(project.flows.length);
  });
});

describe('R2 场景元数据往返', () => {
  it('status / wordTarget / povId / locationId / timeLabel 无损往返', () => {
    const doc: Document = {
      id: 'doc-scene', name: '场景一', category: '正文', notes: '',
      status: 'revising', wordTarget: 3000, povId: 'entity-pov', locationId: 'entity-loc', timeLabel: '雨夜', tension: 4, revision: 2,
      createdAt: 1, updatedAt: 2,
      blocks: [{ id: 'b1', type: 'action', text: '门被推开。' }],
    };
    const restored = mdToDocument(`${doc.name}.md`, documentToMd(doc, []), 0);
    expect(restored.status).toBe('revising');
    expect(restored.wordTarget).toBe(3000);
    expect(restored.povId).toBe('entity-pov');
    expect(restored.locationId).toBe('entity-loc');
    expect(restored.timeLabel).toBe('雨夜');
    expect(restored.tension).toBe(4);
    expect(restored.revision).toBe(2);
  });

  it('元数据缺失时往返保持 undefined,非法 status 被丢弃', () => {
    const doc: Document = {
      id: 'doc-plain', name: '普通文档', category: '正文', notes: '',
      createdAt: 1, updatedAt: 2,
      blocks: [{ id: 'b1', type: 'action', text: 'x' }],
    };
    const restored = mdToDocument(`${doc.name}.md`, documentToMd(doc, []), 0);
    expect(restored.status).toBeUndefined();
    expect(restored.wordTarget).toBeUndefined();
    const bad = documentToMd(doc, []).replace('loom: document', "loom: document\nstatus: nonsense\nwordTarget: -5\ntension: 9\nrevision: 0");
    const restoredBad = mdToDocument(`${doc.name}.md`, bad, 0);
    expect(restoredBad.status).toBeUndefined();
    expect(restoredBad.wordTarget).toBeUndefined();
    expect(restoredBad.tension).toBeUndefined();
    expect(restoredBad.revision).toBeUndefined();
  });
});
