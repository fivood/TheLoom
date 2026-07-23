import { describe, expect, it } from 'vitest';
import { sampleProject } from '../sample';
import { longNovelRegressionProject } from '../test-fixtures/regressionProjects';
import { parseDocx } from './docxImport';
import {
  DOCX_MIME,
  exportProjectToDocx,
  planDocxManuscript,
  verifyDocxExport,
} from './docxExport';
import { readEntryText, readZip } from './zip';

describe('R18-2 DOCX 成稿导出', () => {
  it('投稿稿生成标准 OOXML，并可重新解析为相同卷章场景顺序', async () => {
    const project = longNovelRegressionProject();
    const result = await exportProjectToDocx(project, {
      preset: 'submission',
      title: '雾站寻人记',
      author: '测试作者',
      includeSceneTitles: true,
      includeNotes: false,
      includeAnnotations: false,
      includeRevision: false,
      now: Date.UTC(2026, 6, 23),
    });

    expect(result.blob.type).toBe(DOCX_MIME);
    expect(result.plan).toMatchObject({
      title: '雾站寻人记',
      author: '测试作者',
      volumeCount: 1,
      chapterCount: 2,
      sceneCount: 3,
    });

    const verification = await verifyDocxExport(result.blob, result.plan);
    expect(verification).toMatchObject({
      valid: true,
      volumeCount: 1,
      chapterCount: 2,
      sceneCount: 3,
    });

    const parsed = await parseDocx(await result.blob.arrayBuffer());
    expect(parsed.projectName).toBe('雾站寻人记');
    expect(parsed.author).toBe('测试作者');
    expect(parsed.sceneCount).toBe(3);
    expect(parsed.volumes[0].chapters.map((chapter) => chapter.title)).toEqual(['第一章 雾站', '第二章 回声']);
    expect(parsed.volumes[0].chapters[0].scenes.map((scene) => scene.title)).toEqual(['空站台', '寄存柜']);
    expect(parsed.volumes[0].chapters[1].scenes[0].blocks[0].text).toBe('回声比脚步多了一次。');
  });

  it('编辑审阅稿包含修订、备注、批注和互动逻辑，投稿稿默认排除这些内容', async () => {
    const project = sampleProject();
    const document = project.documents[0];
    document.status = 'revising';
    document.revision = 3;
    document.notes = '核对时间线';
    project.annotations = [{
      id: 'annotation-docx',
      docId: document.id,
      blockId: document.blocks[0].id,
      text: '补足环境气味',
      createdAt: 1,
    }];

    const editorial = planDocxManuscript(project, {
      preset: 'editorial',
      includeSceneTitles: true,
      includeNotes: true,
      includeAnnotations: true,
      includeRevision: true,
    });
    const submission = planDocxManuscript(project, {
      preset: 'submission',
      includeSceneTitles: false,
      includeNotes: false,
      includeAnnotations: false,
      includeRevision: false,
    });
    const editorialText = editorial.paragraphs.map((paragraph) => paragraph.text).join('\n');
    const submissionText = submission.paragraphs.map((paragraph) => paragraph.text).join('\n');

    expect(editorialText).toContain('第 3 稿');
    expect(editorialText).toContain('场景备注：核对时间线');
    expect(editorialText).toContain('批注（待处理）：补足环境气味');
    expect(editorialText).toContain('条件：signal_blocked == true');
    expect(editorialText).toContain('指令：has_address = true; delay_noticed = true');
    expect(submissionText).not.toContain('核对时间线');
    expect(submissionText).not.toContain('signal_blocked');
    expect(submissionText).not.toContain('delay_noticed');
  });

  it('正文样式、A4 页面、列表编号和行内格式都写入 OOXML', async () => {
    const project = longNovelRegressionProject();
    project.documents[0].blocks[0].text = '**浓雾**里仍有*钟声*，旧字~~删去~~。';
    project.documents[0].blocks.push({
      id: 'block-list',
      type: 'list',
      text: '',
      items: ['第一项', '第二项'],
      ordered: true,
    });
    const result = await exportProjectToDocx(project, {
      preset: 'submission',
      includeSceneTitles: true,
      includeNotes: false,
      includeAnnotations: false,
      includeRevision: false,
      now: 1,
    });
    const entries = await readZip(await result.blob.arrayBuffer());
    const map = new Map(entries.map((entry) => [entry.name, readEntryText(entry)]));
    const documentXml = map.get('word/document.xml')!;
    const stylesXml = map.get('word/styles.xml')!;
    const numberingXml = map.get('word/numbering.xml')!;

    expect(documentXml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(documentXml).toContain('<w:b/>');
    expect(documentXml).toContain('<w:i/>');
    expect(documentXml).toContain('<w:strike/>');
    expect(documentXml).not.toContain('**浓雾**');
    expect(stylesXml).toContain('<w:ind w:firstLine="480"/>');
    expect(stylesXml).toContain('w:line="360"');
    expect(numberingXml).toContain('<w:numFmt w:val="decimal"/>');
    expect(documentXml).toContain('<w:numId w:val="2"/>');
  });

  it('编辑审阅稿同样使用 1.5 倍行距和两字符首行缩进', async () => {
    const result = await exportProjectToDocx(longNovelRegressionProject(), {
      preset: 'editorial',
      includeSceneTitles: true,
      includeNotes: true,
      includeAnnotations: true,
      includeRevision: true,
      now: 1,
    });
    const entries = await readZip(await result.blob.arrayBuffer());
    const styles = readEntryText(entries.find((entry) => entry.name === 'word/styles.xml')!);
    expect(styles).toContain('w:line="360"');
    expect(styles).toContain('<w:ind w:firstLine="440"/>');
  });
});
