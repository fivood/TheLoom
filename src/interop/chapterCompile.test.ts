import { describe, expect, it } from 'vitest';
import { sampleProject } from '../sample';
import type { Document, Folder, Project } from '../types';
import { normalizeProject } from '../util';
import { compileDocuments } from './chapterCompile';

function makeProject(): Project {
  const p = normalizeProject(structuredClone(sampleProject()));
  p.documents = [];
  p.folders = [];
  return p;
}

function folder(id: string, name: string, parentId: string | null, order: number): Folder {
  return { id, name, module: 'document', parentId, order };
}
function doc(id: string, name: string, folderId: string, order: number, text: string): Document {
  return {
    id, name, folderId, order,
    category: '导入稿件',
    blocks: [{ id: `${id}-b`, type: 'paragraph', text, flowRole: 'none' }],
    notes: '', createdAt: 1, updatedAt: 1,
  };
}

describe('compileDocuments', () => {
  const project = makeProject();
  project.name = '测试稿';
  project.folders.push(folder('v1', '第一卷', null, 0), folder('c1', '第一章', 'v1', 0), folder('c2', '第二章', 'v1', 1));
  project.folders[0].documentRole = 'volume';
  project.folders[1].documentRole = 'chapter';
  project.folders[2].documentRole = 'chapter';
  project.documents.push(
    doc('s1', '开场', 'c1', 0, '雨要停了。'),
    doc('s2', '尾声', 'c2', 0, '天亮了。'),
  );

  it('按文件夹顺序拼接;md 输出带卷/章路径', () => {
    const res = compileDocuments(project, { format: 'md' });
    expect(res.docCount).toBe(2);
    expect(res.extension).toBe('md');
    expect(res.mime).toBe('text/markdown');
    expect(res.documents.map((d) => d.name)).toEqual(['开场', '尾声']);
    expect(res.content).toContain('# 第一卷 · 第一章');
    expect(res.content).toContain('## 开场');
    expect(res.content).toContain('# 第一卷 · 第二章');
    expect(res.content).toContain('雨要停了。');
    // 开场必须先于尾声
    expect(res.content.indexOf('开场')).toBeLessThan(res.content.indexOf('尾声'));
  });

  it('documentIds 集合过滤,只编译选中的', () => {
    const res = compileDocuments(project, { format: 'md', documentIds: new Set(['s2']) });
    expect(res.documents.map((d) => d.name)).toEqual(['尾声']);
    expect(res.content).not.toContain('开场');
    expect(res.content).toContain('尾声');
  });

  it('includeFolderPath=false 时不写路径', () => {
    const res = compileDocuments(project, { format: 'md', includeFolderPath: false });
    expect(res.content).not.toContain('第一卷 · 第一章');
    expect(res.content).toContain('# 开场');
  });

  it('txt 输出用中文分隔线包裹路径,不带 Markdown 标记', () => {
    const res = compileDocuments(project, { format: 'txt' });
    expect(res.extension).toBe('txt');
    expect(res.content).toContain('—— 第一卷 · 第一章 ——');
    expect(res.content).not.toMatch(/^#/m);
  });

  it('fdx 输出为合法 XML,每篇文档前有 Scene Heading', () => {
    const res = compileDocuments(project, { format: 'fdx' });
    expect(res.extension).toBe('fdx');
    expect(res.content).toContain('<?xml');
    expect(res.content).toContain('<Paragraph Type="Scene Heading"');
    expect(res.content).toContain('第一卷 · 第一章 · 开场');
    expect(res.content).toContain('第一卷 · 第二章 · 尾声');
  });

  it('空选择时 docCount=0,content 是空字符串或空 fdx 骨架', () => {
    const res = compileDocuments(project, { format: 'md', documentIds: new Set(['nope']) });
    expect(res.docCount).toBe(0);
    expect(res.content).toBe('');
  });

  it('显式空集合不会回退为全选', () => {
    const res = compileDocuments(project, { format: 'md', documentIds: new Set() });
    expect(res.docCount).toBe(0);
    expect(res.content).toBe('');
  });
});
