import { describe, expect, it } from 'vitest';
import { sampleProject } from '../sample';
import { normalizeProject } from '../util';
import { applyManuscript, parseManuscript } from './manuscriptImport';
import { decodeTextFile } from './textEncoding';

describe('textEncoding.decodeTextFile', () => {
  it('去除 UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);
    expect(decodeTextFile(bytes)).toBe('hi');
  });

  it('严格 UTF-8 正确通过', () => {
    const bytes = new TextEncoder().encode('你好,世界。');
    expect(decodeTextFile(bytes)).toBe('你好,世界。');
  });

  it('GB18030 中文按启发式回退', () => {
    // 手工构造:「你好」的 GB18030 编码 = C4 E3 BA C3
    const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
    const decoded = decodeTextFile(bytes);
    expect(decoded).toBe('你好');
  });
});

describe('parseManuscript(Markdown)', () => {
  it('# / ## / ### 三级标题拆卷 / 章 / 场景', () => {
    const text = [
      '# 上卷',
      '',
      '## 第一章',
      '',
      '### 场景一',
      '',
      '这是第一段。',
      '',
      '这是第二段。',
      '',
      '### 场景二',
      '',
      '第二场只有一句。',
      '',
      '## 第二章',
      '',
      '### 尾声',
      '',
      '结束。',
    ].join('\n');
    const parsed = parseManuscript(text, { format: 'md' });
    expect(parsed.volumes).toHaveLength(1);
    expect(parsed.volumes[0].title).toBe('上卷');
    expect(parsed.volumes[0].chapters.map((c) => c.title)).toEqual(['第一章', '第二章']);
    expect(parsed.volumes[0].chapters[0].scenes.map((s) => s.title)).toEqual(['场景一', '场景二']);
    expect(parsed.volumes[0].chapters[0].scenes[0].blocks.map((b) => b.text)).toEqual(['这是第一段。', '这是第二段。']);
    expect(parsed.sceneCount).toBe(3);
    expect(parsed.warnings).toEqual([]);
  });

  it('frontmatter 提取标题和作者', () => {
    const text = ['---', 'title: "未归档报告"', 'author: 塞茉薇', '---', '', '# 第一卷', '', '## 第一章', '', '正文。'].join('\n');
    const parsed = parseManuscript(text, { format: 'md' });
    expect(parsed.projectName).toBe('未归档报告');
    expect(parsed.author).toBe('塞茉薇');
    expect(parsed.volumes[0].title).toBe('第一卷');
  });

  it('分隔线 --- 切换场景', () => {
    const text = ['## 第一章', '', '前情。', '', '---', '', '后续。'].join('\n');
    const parsed = parseManuscript(text, { format: 'md' });
    expect(parsed.volumes[0].chapters[0].scenes).toHaveLength(2);
    expect(parsed.volumes[0].chapters[0].scenes[1].blocks[0].text).toBe('后续。');
  });

  it('无标题时全文入单场景 + 警告', () => {
    const parsed = parseManuscript('就一段话。\n\n再来一段。', { format: 'md' });
    expect(parsed.sceneCount).toBe(1);
    expect(parsed.volumes[0].chapters[0].scenes[0].blocks).toHaveLength(2);
    expect(parsed.warnings.join()).toContain('未识别到任何 # 标题');
  });

  it('代码围栏内的 # 不当标题处理', () => {
    const text = ['# 卷', '', '## 章', '', '```', '# 这是代码里的注释',  '## 也不是标题', '```', '', '真正正文。'].join('\n');
    const parsed = parseManuscript(text, { format: 'md' });
    expect(parsed.volumes).toHaveLength(1);
    expect(parsed.volumes[0].chapters).toHaveLength(1);
    const blocks = parsed.volumes[0].chapters[0].scenes[0].blocks;
    expect(blocks.some((b) => b.text.includes('这是代码里的注释'))).toBe(true);
    expect(blocks.some((b) => b.text === '真正正文。')).toBe(true);
  });
});

describe('parseManuscript(TXT)', () => {
  it('中文正则拆分卷章节', () => {
    const text = [
      '第一卷 序章',
      '',
      '第一章 相遇',
      '',
      '雨要停了。',
      '',
      '灯还亮着。',
      '',
      '第二章 分别',
      '',
      '再见。',
    ].join('\n');
    const parsed = parseManuscript(text, { format: 'txt' });
    expect(parsed.volumes[0].title).toBe('第一卷 序章');
    expect(parsed.volumes[0].chapters.map((c) => c.title)).toEqual(['第一章 相遇', '第二章 分别']);
    expect(parsed.volumes[0].chapters[0].scenes[0].blocks.map((b) => b.text)).toEqual(['雨要停了。', '灯还亮着。']);
    expect(parsed.warnings).toEqual([]);
  });

  it('Chapter N: Title 识别英文章节头', () => {
    const text = ['Part I: Awakening', '', 'Chapter 1 — Dawn', '', 'She woke.', '', 'Chapter 2. Dusk', '', 'She slept.'].join('\n');
    const parsed = parseManuscript(text, { format: 'txt' });
    expect(parsed.volumes[0].title).toContain('Part');
    expect(parsed.volumes[0].chapters).toHaveLength(2);
  });

  it('第X节 切换场景', () => {
    const text = ['第一章 前夜', '', '第一节', '', '前情。', '', '第二节 后续', '', '后续。'].join('\n');
    const parsed = parseManuscript(text, { format: 'txt' });
    expect(parsed.volumes[0].chapters[0].scenes.map((s) => s.title)).toEqual(['第一节', '第二节 后续']);
  });
});

describe('applyManuscript', () => {
  it('写入卷/章文件夹树 + 场景文档,不删除既有对象', () => {
    const project = normalizeProject(structuredClone(sampleProject()));
    const beforeDocs = project.documents.length;
    const beforeFolders = project.folders.filter((f) => f.module === 'document').length;
    const parsed = parseManuscript('# 上卷\n\n## 第一章\n\n### 场景一\n\n第一段。', { format: 'md' });
    const result = applyManuscript(project, parsed);
    expect(result.addedDocs).toBe(1);
    expect(result.addedFolders).toBe(2);
    expect(project.documents.length).toBe(beforeDocs + 1);
    expect(project.folders.filter((f) => f.module === 'document').length).toBe(beforeFolders + 2);
    const chapterFolder = project.folders.find((f) => f.name === '第一章');
    const scene = project.documents.find((d) => d.name === '场景一');
    expect(scene?.folderId).toBe(chapterFolder?.id);
    expect(scene?.status).toBe('outline');
    expect(scene?.blocks[0].text).toBe('第一段。');
    expect(project.documentCategories).toContain('导入稿件');
  });
});
