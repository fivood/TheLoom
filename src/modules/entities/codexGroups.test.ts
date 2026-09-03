import { describe, expect, it } from 'vitest';
import type { Entity, Folder, ObjectTemplate } from '../../types';
import { groupEntities } from './codexGroups';

const ent = (id: string, patch: Partial<Entity> = {}): Entity => ({
  id, kind: 'concept', name: id, color: '#888', emoji: '', summary: '', fields: [], notes: '', createdAt: 1, ...patch,
});

const folders: Folder[] = [
  { id: 'f-world', module: 'entity', name: '世界观' },
  { id: 'f-magic', module: 'entity', name: '魔法体系', parentId: 'f-world' },
  { id: 'f-empty', module: 'entity', name: '待写的宗教' },
  { id: 'f-doc', module: 'document', name: '不该出现' },
];

describe('设定集分类分组', () => {
  it('按文件夹分组:保留空分类,子文件夹显示完整路径,失效归属落到未分组', () => {
    const list = [
      ent('a', { folderId: 'f-magic', summary: '有内容' }),
      ent('b', { folderId: 'f-magic' }),
      ent('c'),
      ent('d', { folderId: 'f-deleted' }),
    ];
    const groups = groupEntities(list, folders, [], 'folder');
    expect(groups.map((g) => g.label)).toEqual(['世界观', '世界观 · 魔法体系', '待写的宗教', '未分组']);
    // 空分类必须留下:先摆骨架再填内容
    expect(groups.find((g) => g.label === '待写的宗教')!.items).toHaveLength(0);
    const magic = groups.find((g) => g.key === 'f-magic')!;
    expect(magic.items.map((e) => e.id)).toEqual(['a', 'b']);
    expect(magic.filled).toBe(1);
    // 指向已删除文件夹的实体不能凭空消失
    expect(groups[groups.length - 1].items.map((e: Entity) => e.id)).toEqual(['c', 'd']);
  });

  it('按类型分组固定五类,空类同样保留', () => {
    const groups = groupEntities([ent('a', { kind: 'character' })], folders, [], 'kind');
    expect(groups).toHaveLength(5);
    expect(groups[0].items.map((e) => e.id)).toEqual(['a']);
    expect(groups.every((g) => g.label.length > 0)).toBe(true);
  });

  it('按模板分组只认实体模板,未套模板单列一组', () => {
    const templates: ObjectTemplate[] = [
      { id: 't1', module: 'entity', name: '神祇', entityKind: 'concept', fields: [], createdAt: 1, updatedAt: 1 },
      { id: 't2', module: 'document', name: '文档模板', fields: [], createdAt: 1, updatedAt: 1 },
    ];
    const groups = groupEntities([ent('a', { templateId: 't1' }), ent('b')], folders, templates, 'template');
    expect(groups.map((g) => g.label)).toEqual(['神祇', '未套模板']);
    expect(groups[1].items.map((e) => e.id)).toEqual(['b']);
  });
});
