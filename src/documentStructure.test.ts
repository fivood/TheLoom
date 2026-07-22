import { describe, expect, it } from 'vitest';
import type { Document, Folder, Project } from './types';
import { documentChapterIdentity, documentSceneLabel, inspectDocumentStructure, suggestedDocumentChildRole } from './documentStructure';
import { normalizeProject } from './util';

const folders: Folder[] = [
  { id: 'v1', name: '第一卷', module: 'document', documentRole: 'volume' },
  { id: 'c1', name: '第一章', module: 'document', parentId: 'v1', documentRole: 'chapter' },
  { id: 'sec1', name: '雨夜', module: 'document', parentId: 'c1', documentRole: 'section' },
];

const scene = (id: string, folderId?: string): Document => ({
  id,
  name: id,
  folderId,
  category: '正文',
  blocks: [],
  notes: '',
  createdAt: 1,
  updatedAt: 1,
});

describe('R17-1 卷章场景结构', () => {
  it('小节内场景使用最近章节作为分组身份', () => {
    expect(documentChapterIdentity(scene('s1', 'sec1'), folders)).toEqual({
      key: 'c1',
      folderId: 'c1',
      label: '第一卷 · 第一章',
    });
    const renamed = structuredClone(folders);
    renamed[1].name = '雨夜来客';
    expect(documentChapterIdentity(scene('s1', 'sec1'), renamed).key).toBe('c1');
    expect(suggestedDocumentChildRole(folders[0])).toBe('chapter');
    expect(suggestedDocumentChildRole(folders[1])).toBe('section');
  });

  it('非法层级只产生诊断，不改动原结构', () => {
    const invalid = [
      { id: 'chapter', name: '孤立章', module: 'document', documentRole: 'chapter' },
      { id: 'volume', name: '卷', module: 'document', documentRole: 'volume' },
    ] satisfies Folder[];
    const documents = [scene('direct', 'volume')];
    const before = structuredClone({ invalid, documents });
    const issues = inspectDocumentStructure(documents, invalid);
    expect(issues.map((issue) => issue.code)).toEqual([
      'document-structure.folder-parent',
      'document-structure.scene-parent',
    ]);
    expect({ invalid, documents }).toEqual(before);
  });

  it('旧文件夹保持普通分组，清理非法角色但不推断角色', () => {
    const project = normalizeProject({
      version: 1,
      name: '旧项目',
      flows: [],
      folders: [
        { id: 'legacy', name: '第一章', module: 'document' },
        { id: 'wrong-module', name: '实体卷', module: 'entity', documentRole: 'volume' },
        { id: 'wrong-role', name: '错误', module: 'document', documentRole: 'act' },
      ],
      updatedAt: 1,
    } as unknown as Project);
    expect(project.folders.find((folder) => folder.id === 'legacy')?.documentRole).toBeUndefined();
    expect(project.folders.find((folder) => folder.id === 'wrong-module')?.documentRole).toBeUndefined();
    expect(project.folders.find((folder) => folder.id === 'wrong-role')?.documentRole).toBeUndefined();
  });

  it('场景改名和移动后投影立即读取新标题与路径', () => {
    const document = scene('s1', 'sec1');
    document.name = '旧钟楼';
    expect(documentSceneLabel(document, folders)).toBe('第一卷 · 第一章 · 雨夜 · 旧钟楼');
    document.name = '改名后的钟楼';
    document.folderId = 'c1';
    expect(documentSceneLabel(document, folders)).toBe('第一卷 · 第一章 · 改名后的钟楼');
  });
});
