import { describe, expect, it } from 'vitest';
import { makeZip } from './zip';
import { parseDocx } from './docxImport';

const DOC_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** 构造一段 w:p;style 传 'Heading1' / 'Title' 等;runs 是文本 run 数组 */
function para(style: string | null, runs: string[]): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  const rs = runs.map((t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`).join('');
  return `<w:p>${pPr}${rs}</w:p>`;
}

function buildDocXml(paragraphs: string[]): string {
  return `<?xml version="1.0"?><w:document ${DOC_NS}><w:body>${paragraphs.join('')}</w:body></w:document>`;
}

function buildCoreXml(title: string, creator: string): string {
  return `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>${creator}</dc:creator></cp:coreProperties>`;
}

async function buildDocxFile(paragraphs: string[], core?: { title: string; creator: string }): Promise<ArrayBuffer> {
  const files = [
    { name: 'word/document.xml', content: buildDocXml(paragraphs) },
    ...(core ? [{ name: 'docProps/core.xml', content: buildCoreXml(core.title, core.creator) }] : []),
  ];
  const blob = await makeZip(files);
  return await blob.arrayBuffer();
}

describe('parseDocx', () => {
  it('Heading1/2/3 拆卷 / 章 / 场景 + core.xml 提取标题作者', async () => {
    const buf = await buildDocxFile([
      para('Heading1', ['第一卷']),
      para('Heading2', ['第一章 相遇']),
      para('Heading3', ['场景一']),
      para(null, ['雨要停了。']),
      para(null, ['灯还亮着。']),
      para('Heading3', ['场景二']),
      para(null, ['沉默。']),
      para('Heading2', ['第二章 分别']),
      para('Heading3', ['尾声']),
      para(null, ['结束。']),
    ], { title: '未归档报告', creator: '塞茉薇' });
    const parsed = await parseDocx(buf);
    expect(parsed.projectName).toBe('未归档报告');
    expect(parsed.author).toBe('塞茉薇');
    expect(parsed.volumes[0].title).toBe('第一卷');
    expect(parsed.volumes[0].chapters.map((c) => c.title)).toEqual(['第一章 相遇', '第二章 分别']);
    expect(parsed.volumes[0].chapters[0].scenes.map((s) => s.title)).toEqual(['场景一', '场景二']);
    expect(parsed.volumes[0].chapters[0].scenes[0].blocks.map((b) => b.text)).toEqual(['雨要停了。', '灯还亮着。']);
    expect(parsed.sceneCount).toBe(3);
    expect(parsed.warnings).toEqual([]);
  });

  it('Title 段落作为 projectName;单卷 EPUB 式退化(无 Heading1)', async () => {
    const buf = await buildDocxFile([
      para('Title', ['一日的记录']),
      para('Heading2', ['清晨']),
      para(null, ['天亮了。']),
      para('Heading2', ['傍晚']),
      para(null, ['天黑了。']),
    ]);
    const parsed = await parseDocx(buf);
    expect(parsed.projectName).toBe('一日的记录');
    expect(parsed.volumes[0].title).toBe('');
    expect(parsed.volumes[0].chapters.map((c) => c.title)).toEqual(['清晨', '傍晚']);
  });

  it('多个 run 合并为一段;w:br 视作换行,w:tab 视作空格', async () => {
    // 手工构造一段带 br + tab 的段落
    const p = `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>`
      + `<w:p><w:r><w:t>前</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>后</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>末</w:t></w:r></w:p>`;
    const buf = await buildDocxFile([p]);
    const parsed = await parseDocx(buf);
    const blocks = parsed.volumes[0].chapters[0].scenes[0].blocks;
    expect(blocks[0].text).toBe('前\n后 末');
  });

  it('没有任何 heading 时全文入单场景 + 警告', async () => {
    const buf = await buildDocxFile([
      para(null, ['第一段。']),
      para(null, ['第二段。']),
    ]);
    const parsed = await parseDocx(buf);
    expect(parsed.sceneCount).toBe(1);
    expect(parsed.volumes[0].chapters[0].scenes[0].blocks).toHaveLength(2);
    expect(parsed.warnings.join()).toContain('未识别到任何标题样式');
  });

  it('缺少 word/document.xml 抛出明确错误', async () => {
    const blob = await makeZip([{ name: 'other.txt', content: 'nope' }]);
    await expect(parseDocx(await blob.arrayBuffer())).rejects.toThrow(/word\/document\.xml/);
  });
});
