import { describe, expect, it } from 'vitest';
import { applyBatchEdit, setObjectFavorites } from './batch';
import { sampleProject } from './sample';
import type { FolderModule, ObjectTemplate } from './types';
import { normalizeProject } from './util';

const project = () => {
  const p = normalizeProject(structuredClone(sampleProject()));
  if (p.assets.length === 0) {
    p.assets.push({
      id: 'asset-fixture',
      name: '雨夜参考图',
      kind: 'image',
      mime: 'image/png',
      size: 12,
      tags: [],
      source: '',
      notes: '',
      createdAt: 1,
    });
  }
  return p;
};

describe('R11-3 收藏夹', () => {
  it('五个 Navigator 模块都能统一收藏和取消收藏', () => {
    const p = project();
    const cases: [FolderModule, string, { favorite?: boolean }][] = [
      ['flow', p.flows[0].id, p.flows[0]],
      ['entity', p.entities[0].id, p.entities[0]],
      ['asset', p.assets[0].id, p.assets[0]],
      ['document', p.documents[0].id, p.documents[0]],
      ['research', p.researchCards[0].id, p.researchCards[0]],
    ];
    for (const [module, id, item] of cases) {
      expect(setObjectFavorites(p, module, [id], true)).toBe(1);
      expect(item.favorite).toBe(true);
      setObjectFavorites(p, module, [id], false);
      expect(item.favorite).toBeUndefined();
    }
  });
});

describe('R11-3 批量编辑', () => {
  it('实体可批量改类型、归档并套用模板,模板字段安全补齐', () => {
    const p = project();
    const ids = p.entities.slice(0, 2).map((entity) => entity.id);
    const template: ObjectTemplate = {
      id: 'batch-character-template',
      name: '批量角色卡',
      module: 'entity',
      fields: [{ label: '核心欲望', required: true }],
      createdAt: 1,
      updatedAt: 1,
    };
    p.templates = [template];
    p.folders.push({ id: 'batch-entity-folder', module: 'entity', name: '主角组', parentId: null });

    expect(applyBatchEdit(p, 'entity', ids, {
      favorite: true,
      folderId: 'batch-entity-folder',
      entityKind: 'character',
      templateId: template.id,
    })).toBe(2);

    for (const entity of p.entities.filter((item) => ids.includes(item.id))) {
      expect(entity).toMatchObject({
        favorite: true,
        folderId: 'batch-entity-folder',
        kind: 'character',
        templateId: template.id,
      });
      expect(entity.fields.some((field) => field.label === '核心欲望')).toBe(true);
    }
  });

  it('文档可批量改分类、状态和模板', () => {
    const p = project();
    const ids = p.documents.slice(0, 2).map((document) => document.id);
    const before = Date.now();
    const template: ObjectTemplate = {
      id: 'batch-document-template',
      name: '章节模板',
      module: 'document',
      fields: [{ label: '章节目标' }],
      createdAt: 1,
      updatedAt: 1,
    };
    p.templates = [template];

    applyBatchEdit(p, 'document', ids, {
      documentCategory: '第二卷',
      documentStatus: 'revising',
      templateId: template.id,
    });

    for (const document of p.documents.filter((item) => ids.includes(item.id))) {
      expect(document.category).toBe('第二卷');
      expect(document.status).toBe('revising');
      expect(document.templateId).toBe(template.id);
      expect(document.fields?.some((field) => field.label === '章节目标')).toBe(true);
      expect(document.updatedAt).toBeGreaterThanOrEqual(before);
    }
  });

  it('资源与资料可批量增删标签,资料可同步修改分类和置顶', () => {
    const p = project();
    const asset = p.assets[0];
    asset.tags = ['夜景', '旧标签'];
    applyBatchEdit(p, 'asset', [asset.id], {
      addTags: ['雨夜', '夜景', '移除优先'],
      removeTags: ['旧标签', '移除优先'],
    });
    expect(asset.tags).toEqual(['夜景', '雨夜']);

    const card = p.researchCards[0];
    card.tags = ['旧标签'];
    applyBatchEdit(p, 'research', [card.id], {
      researchCategory: '城市考据',
      researchPinned: true,
      addTags: ['伦敦'],
      removeTags: ['旧标签'],
    });
    expect(card).toMatchObject({ category: '城市考据', pinned: true, tags: ['伦敦'] });
  });

  it('未传入的字段保持不变,清空值显式使用 null', () => {
    const p = project();
    const document = p.documents[0];
    document.favorite = true;
    document.folderId = 'old-folder';
    document.status = 'done';
    const category = document.category;
    const updatedAt = document.updatedAt;

    applyBatchEdit(p, 'document', [document.id], { favorite: false, folderId: null });

    expect(document.updatedAt).toBe(updatedAt);
    document.favorite = true;
    document.folderId = 'old-folder';

    applyBatchEdit(p, 'document', [document.id], { folderId: null, documentStatus: null });

    expect(document.folderId).toBeUndefined();
    expect(document.status).toBeUndefined();
    expect(document.favorite).toBe(true);
    expect(document.category).toBe(category);
  });
});
