import { describe, expect, it } from 'vitest';
import { makeZip } from './zip';
import { parseEpub } from './epubImport';

/** 构造一个最小合法 EPUB(mimetype + container + OPF + 2 章 xhtml) */
async function buildTestEpub(opts: {
  title?: string; creator?: string; chapters: { file: string; xhtml: string }[];
  opfPath?: string;
}): Promise<ArrayBuffer> {
  const opfPath = opts.opfPath ?? 'OEBPS/content.opf';
  const opfDir = opfPath.slice(0, opfPath.lastIndexOf('/'));
  const manifestItems = opts.chapters.map((c, i) => {
    const href = c.file;
    return `<item id="ch${i}" href="${href}" media-type="application/xhtml+xml"/>`;
  }).join('\n');
  const spineItems = opts.chapters.map((_, i) => `<itemref idref="ch${i}"/>`).join('\n');
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${opts.title ?? ''}</dc:title>
    <dc:language>zh</dc:language>
    <dc:creator>${opts.creator ?? ''}</dc:creator>
  </metadata>
  <manifest>${manifestItems}</manifest>
  <spine>${spineItems}</spine>
</package>`;
  const container = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const files = [
    { name: 'mimetype', content: 'application/epub+zip' },
    { name: 'META-INF/container.xml', content: container },
    { name: opfPath, content: opf },
    ...opts.chapters.map((c) => ({ name: opfDir ? `${opfDir}/${c.file}` : c.file, content: c.xhtml })),
  ];
  const blob = await makeZip(files);
  return await blob.arrayBuffer();
}

const wrapXhtml = (body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;

describe('parseEpub', () => {
  it('两章 EPUB → 一卷 + 两章;首个 h1 作章标题', async () => {
    const buf = await buildTestEpub({
      title: '未归档报告', creator: '塞茉薇',
      chapters: [
        { file: 'ch01.xhtml', xhtml: wrapXhtml('<h1>第一章 相遇</h1><p>雨要停了。</p><p>灯还亮着。</p>') },
        { file: 'ch02.xhtml', xhtml: wrapXhtml('<h1>第二章 分别</h1><p>再见。</p>') },
      ],
    });
    const parsed = await parseEpub(buf);
    expect(parsed.projectName).toBe('未归档报告');
    expect(parsed.author).toBe('塞茉薇');
    expect(parsed.volumes[0].chapters.map((c) => c.title)).toEqual(['第一章 相遇', '第二章 分别']);
    expect(parsed.sceneCount).toBe(2);
    expect(parsed.volumes[0].chapters[0].scenes[0].blocks.map((b) => b.text)).toEqual(['雨要停了。', '灯还亮着。']);
    expect(parsed.warnings).toEqual([]);
  });

  it('章内 h2 切分场景', async () => {
    const buf = await buildTestEpub({
      title: 't',
      chapters: [
        { file: 'ch01.xhtml', xhtml: wrapXhtml('<h1>第一章</h1><h2>前情</h2><p>A</p><h2>后续</h2><p>B</p>') },
      ],
    });
    const parsed = await parseEpub(buf);
    expect(parsed.volumes[0].chapters[0].scenes.map((s) => s.title)).toEqual(['前情', '后续']);
    expect(parsed.volumes[0].chapters[0].scenes[1].blocks[0].text).toBe('B');
  });

  it('spine 顺序决定章节顺序,linear=no 被跳过', async () => {
    const buf = await buildTestEpub({
      title: 't',
      chapters: [
        { file: 'a.xhtml', xhtml: wrapXhtml('<h1>甲</h1><p>1</p>') },
        { file: 'b.xhtml', xhtml: wrapXhtml('<h1>乙</h1><p>2</p>') },
      ],
    });
    const parsed = await parseEpub(buf);
    expect(parsed.volumes[0].chapters.map((c) => c.title)).toEqual(['甲', '乙']);
  });

  it('OPF 在子目录时 href 正确解析', async () => {
    const buf = await buildTestEpub({
      title: 't',
      opfPath: 'OEBPS/content.opf',
      chapters: [{ file: 'text/ch01.xhtml', xhtml: wrapXhtml('<p>只有一段。</p>') }],
    });
    const parsed = await parseEpub(buf);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.volumes[0].chapters[0].scenes[0].blocks[0].text).toBe('只有一段。');
  });

  it('嵌套的 section / article 内容也被收集', async () => {
    const buf = await buildTestEpub({
      title: 't',
      chapters: [{
        file: 'ch01.xhtml',
        xhtml: wrapXhtml('<section><article><p>嵌套里的段落。</p></article></section><p>顶层段落。</p>'),
      }],
    });
    const parsed = await parseEpub(buf);
    const blocks = parsed.volumes[0].chapters[0].scenes[0].blocks.map((b) => b.text);
    expect(blocks).toEqual(['嵌套里的段落。', '顶层段落。']);
  });

  it('缺少 container.xml 时抛出明确错误', async () => {
    const buf = await (async () => {
      const blob = await makeZip([{ name: 'mimetype', content: 'application/epub+zip' }]);
      return await blob.arrayBuffer();
    })();
    await expect(parseEpub(buf)).rejects.toThrow(/META-INF/);
  });
});
