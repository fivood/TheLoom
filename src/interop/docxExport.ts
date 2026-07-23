import { documentFolderAncestors } from '../documentStructure';
import type { DocBlock, DocStatus, Document, Project } from '../types';
import { DOC_STATUS_LABEL } from '../types';
import { documentWordCount, linearizeByFolders } from '../util';
import { makeZip, readEntryText, readZip } from './zip';
import { scanXml } from './xmlLite';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type DocxManuscriptPreset = 'submission' | 'editorial';

export interface DocxExportOptions {
  documentIds?: Set<string>;
  preset: DocxManuscriptPreset;
  title?: string;
  author?: string;
  includeSceneTitles: boolean;
  includeNotes: boolean;
  includeAnnotations: boolean;
  includeRevision: boolean;
  now?: number;
}

interface InlineToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
}

export interface DocxPlannedParagraph {
  style: string;
  text: string;
  source: string;
  numId?: 1 | 2;
  pageBreak?: boolean;
}

export interface DocxManuscriptPlan {
  title: string;
  author: string;
  preset: DocxManuscriptPreset;
  documents: Document[];
  paragraphs: DocxPlannedParagraph[];
  volumeCount: number;
  chapterCount: number;
  sceneCount: number;
  bodyParagraphCount: number;
  totalWords: number;
}

export interface DocxExportResult {
  blob: Blob;
  plan: DocxManuscriptPlan;
}

export interface DocxVerification {
  valid: boolean;
  issues: string[];
  paragraphCount: number;
  volumeCount: number;
  chapterCount: number;
  sceneCount: number;
}

interface PresetTokens {
  bodySize: number;
  bodyLine: number;
  firstLine: number;
  bodyAfter: number;
  titleSize: number;
  authorSize: number;
  volumeSize: number;
  chapterSize: number;
  sceneSize: number;
  metaSize: number;
  showReviewLabel: boolean;
}

const PRESET_TOKENS: Record<DocxManuscriptPreset, PresetTokens> = {
  submission: {
    bodySize: 24,
    bodyLine: 360,
    firstLine: 480,
    bodyAfter: 0,
    titleSize: 44,
    authorSize: 24,
    volumeSize: 32,
    chapterSize: 30,
    sceneSize: 24,
    metaSize: 19,
    showReviewLabel: false,
  },
  editorial: {
    bodySize: 22,
    bodyLine: 360,
    firstLine: 440,
    bodyAfter: 80,
    titleSize: 40,
    authorSize: 22,
    volumeSize: 30,
    chapterSize: 28,
    sceneSize: 23,
    metaSize: 19,
    showReviewLabel: true,
  },
};

const INLINE_RULES = [
  { start: '**', end: '**', format: { bold: true } },
  { start: '*', end: '*', format: { italic: true } },
  { start: '~~', end: '~~', format: { strike: true } },
] as const;

function parseInline(text: string, inherited: Omit<InlineToken, 'text'> = {}): InlineToken[] {
  const output: InlineToken[] = [];
  let index = 0;
  let buffer = '';
  const flush = () => {
    if (!buffer) return;
    output.push({ text: buffer, ...inherited });
    buffer = '';
  };
  while (index < text.length) {
    let matched = false;
    for (const rule of INLINE_RULES) {
      if (!text.startsWith(rule.start, index)) continue;
      const end = text.indexOf(rule.end, index + rule.start.length);
      if (end < 0) continue;
      flush();
      output.push(...parseInline(text.slice(index + rule.start.length, end), { ...inherited, ...rule.format }));
      index = end + rule.end.length;
      matched = true;
      break;
    }
    if (!matched) {
      buffer += text[index];
      index++;
    }
  }
  flush();
  return output;
}

function plainInline(text: string): string {
  return parseInline(text).map((token) => token.text).join('');
}

function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function addParagraph(
  paragraphs: DocxPlannedParagraph[],
  style: string,
  source: string,
  options: Pick<DocxPlannedParagraph, 'numId' | 'pageBreak'> = {},
): void {
  const text = plainInline(source).trim();
  if (!text && !options.pageBreak) return;
  paragraphs.push({ style, text, source, ...options });
}

function entityName(project: Project, id: string | undefined): string {
  if (!id) return '';
  return project.entities.find((entity) => entity.id === id)?.name ?? '';
}

function revisionLine(project: Project, document: Document): string {
  const parts: string[] = [];
  if (document.status) parts.push(`状态：${DOC_STATUS_LABEL[document.status as DocStatus]}`);
  if (document.revision) parts.push(`第 ${document.revision} 稿`);
  const pov = entityName(project, document.povId);
  const location = entityName(project, document.locationId);
  if (pov) parts.push(`POV：${pov}`);
  if (location) parts.push(`地点：${location}`);
  if (document.timeLabel) parts.push(`时间：${document.timeLabel}`);
  return parts.join(' · ');
}

function addBlock(
  paragraphs: DocxPlannedParagraph[],
  project: Project,
  block: DocBlock,
  preset: DocxManuscriptPreset,
  includeNotes: boolean,
): void {
  const editorial = preset === 'editorial';
  if (block.type === 'paragraph' || block.type === 'action') {
    addParagraph(paragraphs, 'ManuscriptBody', block.text);
  } else if (block.type === 'heading') {
    addParagraph(paragraphs, 'SceneAnchor', block.text);
  } else if (block.type === 'subheading') {
    addParagraph(paragraphs, 'ManuscriptSubheading', block.text);
  } else if (block.type === 'dialogue') {
    const speaker = entityName(project, block.speakerId);
    addParagraph(paragraphs, 'Dialogue', speaker ? `${speaker}：${block.text}` : block.text);
  } else if (block.type === 'quote') {
    addParagraph(paragraphs, 'ManuscriptQuote', block.text);
  } else if (block.type === 'list') {
    for (const item of block.items ?? []) addParagraph(paragraphs, 'ManuscriptList', item, { numId: block.ordered ? 2 : 1 });
  } else if (block.type === 'choice' && editorial) {
    addParagraph(paragraphs, 'LogicNote', block.text ? `选项：${block.text}` : '选项');
    for (const choice of block.choices ?? []) addParagraph(paragraphs, 'ManuscriptList', choice.label, { numId: 1 });
  } else if (block.type === 'condition' && editorial) {
    addParagraph(paragraphs, 'LogicNote', `条件：${block.condition ?? ''}`);
  } else if (block.type === 'instruction' && editorial) {
    addParagraph(paragraphs, 'LogicNote', `指令：${block.instruction ?? ''}`);
  } else if (block.type === 'note' && includeNotes) {
    addParagraph(paragraphs, 'ReviewNote', `正文注释：${block.text}`);
  }
}

export function planDocxManuscript(project: Project, options: DocxExportOptions): DocxManuscriptPlan {
  const selected = options.documentIds;
  const documents = linearizeByFolders(project.documents, project.folders, 'document')
    .filter((document) => !selected || selected.has(document.id));
  const title = options.title?.trim() || project.name || '未命名作品';
  const author = options.author?.trim() || '';
  const paragraphs: DocxPlannedParagraph[] = [];
  const volumeIds = new Set<string>();
  const chapterIds = new Set<string>();
  let lastVolumeId = '';
  let lastChapterId = '';
  let startedContent = false;

  addParagraph(paragraphs, 'ManuscriptTitle', title);
  if (author) addParagraph(paragraphs, 'ManuscriptAuthor', author);
  if (PRESET_TOKENS[options.preset].showReviewLabel) addParagraph(paragraphs, 'CoverMeta', '编辑审阅稿');
  addParagraph(paragraphs, 'Normal', '', { pageBreak: true });

  for (const document of documents) {
    const ancestors = documentFolderAncestors(document.folderId, project.folders);
    const volume = [...ancestors].reverse().find((folder) => folder.documentRole === 'volume');
    const chapter = [...ancestors].reverse().find((folder) => folder.documentRole === 'chapter');
    let addedVolume = false;

    if (volume && volume.id !== lastVolumeId) {
      if (startedContent) addParagraph(paragraphs, 'Normal', '', { pageBreak: true });
      addParagraph(paragraphs, 'Heading1', volume.name);
      volumeIds.add(volume.id);
      lastVolumeId = volume.id;
      lastChapterId = '';
      startedContent = true;
      addedVolume = true;
    }
    if (chapter && chapter.id !== lastChapterId) {
      if (startedContent && !addedVolume) addParagraph(paragraphs, 'Normal', '', { pageBreak: true });
      addParagraph(paragraphs, 'Heading2', chapter.name);
      chapterIds.add(chapter.id);
      lastChapterId = chapter.id;
      startedContent = true;
    }
    if (options.includeSceneTitles) addParagraph(paragraphs, 'Heading3', document.name);
    if (options.includeRevision) {
      const line = revisionLine(project, document);
      if (line) addParagraph(paragraphs, 'Metadata', line);
    }
    if (options.includeNotes && document.notes.trim()) {
      addParagraph(paragraphs, 'ReviewNote', `场景备注：${document.notes.trim()}`);
    }
    for (const block of document.blocks) addBlock(paragraphs, project, block, options.preset, options.includeNotes);
    if (options.includeAnnotations) {
      for (const annotation of project.annotations ?? []) {
        if (annotation.docId !== document.id) continue;
        const state = annotation.resolved ? '已解决' : '待处理';
        addParagraph(paragraphs, 'ReviewNote', `批注（${state}）：${annotation.text}`);
      }
    }
    startedContent = true;
  }

  return {
    title,
    author,
    preset: options.preset,
    documents,
    paragraphs,
    volumeCount: volumeIds.size,
    chapterCount: chapterIds.size,
    sceneCount: documents.length,
    bodyParagraphCount: paragraphs.filter((paragraph) =>
      paragraph.text && !['ManuscriptTitle', 'ManuscriptAuthor', 'CoverMeta', 'Heading1', 'Heading2', 'Heading3'].includes(paragraph.style)).length,
    totalWords: documents.reduce((sum, document) => sum + documentWordCount(document), 0),
  };
}

function runXml(token: InlineToken): string {
  const properties = [
    token.bold ? '<w:b/>' : '',
    token.italic ? '<w:i/>' : '',
    token.strike ? '<w:strike/>' : '',
  ].join('');
  const parts = token.text.split('\n');
  const content = parts.map((part, index) => {
    const preserve = /^\s|\s$/.test(part) ? ' xml:space="preserve"' : '';
    return `${index > 0 ? '<w:br/>' : ''}<w:t${preserve}>${xml(part)}</w:t>`;
  }).join('');
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${content}</w:r>`;
}

function paragraphXml(paragraph: DocxPlannedParagraph): string {
  if (paragraph.pageBreak) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const numbering = paragraph.numId
    ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${paragraph.numId}"/></w:numPr>`
    : '';
  const properties = `<w:pPr><w:pStyle w:val="${paragraph.style}"/>${numbering}</w:pPr>`;
  return `<w:p>${properties}${parseInline(paragraph.source.trim()).map(runXml).join('')}</w:p>`;
}

function stylesXml(preset: DocxManuscriptPreset): string {
  const token = PRESET_TOKENS[preset];
  const style = (
    id: string,
    name: string,
    basedOn: string,
    pPr: string,
    rPr: string,
    options = '',
  ) => `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/>${options}<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
  const fonts = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>';
  const black = '<w:color w:val="000000"/>';
  const gray = '<w:color w:val="666666"/>';
  const baseRun = `${fonts}<w:sz w:val="${token.bodySize}"/><w:szCs w:val="${token.bodySize}"/>${black}`;
  const bodyP = `<w:spacing w:before="0" w:after="${token.bodyAfter}" w:line="${token.bodyLine}" w:lineRule="auto"/><w:ind w:firstLine="${token.firstLine}"/><w:jc w:val="both"/><w:widowControl/>`;
  const heading = (size: number) => `${fonts}<w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${black}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>${baseRun}<w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="${token.bodyAfter}" w:line="${token.bodyLine}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="${token.bodyAfter}" w:line="${token.bodyLine}" w:lineRule="auto"/></w:pPr><w:rPr>${baseRun}</w:rPr></w:style>
  ${style('ManuscriptTitle', '书名', 'Normal', '<w:spacing w:before="2400" w:after="240"/><w:jc w:val="center"/><w:keepNext/>', `${fonts}<w:b/><w:sz w:val="${token.titleSize}"/><w:szCs w:val="${token.titleSize}"/>${black}`)}
  ${style('ManuscriptAuthor', '作者', 'Normal', '<w:spacing w:before="0" w:after="160"/><w:jc w:val="center"/>', `${fonts}<w:sz w:val="${token.authorSize}"/><w:szCs w:val="${token.authorSize}"/>${black}`)}
  ${style('CoverMeta', '封面说明', 'Normal', '<w:spacing w:before="80" w:after="0"/><w:jc w:val="center"/>', `${fonts}<w:sz w:val="${token.metaSize}"/><w:szCs w:val="${token.metaSize}"/>${gray}`)}
  ${style('Heading1', '卷标题', 'Normal', '<w:spacing w:before="0" w:after="240"/><w:jc w:val="center"/><w:keepNext/>', heading(token.volumeSize), '<w:qFormat/><w:uiPriority w:val="9"/>')}
  ${style('Heading2', '章标题', 'Normal', '<w:spacing w:before="0" w:after="240"/><w:keepNext/>', heading(token.chapterSize), '<w:qFormat/><w:uiPriority w:val="9"/>')}
  ${style('Heading3', '场景标题', 'Normal', '<w:spacing w:before="200" w:after="120"/><w:keepNext/>', heading(token.sceneSize), '<w:qFormat/><w:uiPriority w:val="9"/>')}
  ${style('ManuscriptBody', '正文', 'Normal', bodyP, baseRun)}
  ${style('Dialogue', '对白', 'ManuscriptBody', bodyP, baseRun)}
  ${style('SceneAnchor', '场景锚点', 'Normal', '<w:spacing w:before="160" w:after="80"/><w:keepNext/>', heading(token.sceneSize))}
  ${style('ManuscriptSubheading', '正文小标题', 'Normal', '<w:spacing w:before="160" w:after="80"/><w:keepNext/>', `${fonts}<w:b/><w:sz w:val="${token.bodySize}"/><w:szCs w:val="${token.bodySize}"/>${black}`)}
  ${style('ManuscriptQuote', '引用', 'Normal', `<w:spacing w:before="80" w:after="80" w:line="${token.bodyLine}" w:lineRule="auto"/><w:ind w:left="480" w:right="240"/>`, `${baseRun}<w:i/>`)}
  ${style('ManuscriptList', '列表正文', 'Normal', `<w:spacing w:before="0" w:after="${token.bodyAfter}" w:line="${token.bodyLine}" w:lineRule="auto"/>`, baseRun)}
  ${style('Metadata', '场景元数据', 'Normal', '<w:spacing w:before="0" w:after="100"/><w:keepNext/>', `${fonts}<w:sz w:val="${token.metaSize}"/><w:szCs w:val="${token.metaSize}"/>${gray}`)}
  ${style('ReviewNote', '编辑批注', 'Normal', '<w:spacing w:before="80" w:after="80"/><w:ind w:left="240" w:right="240"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>', `${fonts}<w:sz w:val="${token.metaSize}"/><w:szCs w:val="${token.metaSize}"/>${black}`)}
  ${style('LogicNote', '互动逻辑', 'ReviewNote', '<w:spacing w:before="60" w:after="60"/><w:ind w:left="240" w:right="240"/><w:shd w:val="clear" w:color="auto" w:fill="F7F7F7"/>', `${fonts}<w:sz w:val="${token.metaSize}"/><w:szCs w:val="${token.metaSize}"/>${gray}`)}
</w:styles>`;
}

function numberingXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/></w:rPr></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;
}

function documentXml(plan: DocxManuscriptPlan): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${plan.paragraphs.map(paragraphXml).join('')}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId4"/>
      <w:footerReference w:type="default" r:id="rId5"/>
      <w:titlePg/>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:type="lines" w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function headerXml(title: string, author: string): string {
  const label = author ? `${title}　·　${author}` : title;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="18"/><w:color w:val="777777"/></w:rPr><w:t>${xml(label)}</w:t></w:r></w:p></w:hdr>`;
}

function footerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="18"/><w:color w:val="777777"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
}

export async function exportProjectToDocx(project: Project, options: DocxExportOptions): Promise<DocxExportResult> {
  const plan = planDocxManuscript(project, options);
  const created = new Date(options.now ?? Date.now()).toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(plan.title)}</dc:title><dc:creator>${xml(plan.author)}</dc:creator><cp:lastModifiedBy>TheLoom</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`;
  const zip = await makeZip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    { name: 'docProps/core.xml', content: core },
    { name: 'docProps/app.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>TheLoom</Application><AppVersion>1.0</AppVersion></Properties>' },
    { name: 'word/document.xml', content: documentXml(plan) },
    { name: 'word/styles.xml', content: stylesXml(options.preset) },
    { name: 'word/numbering.xml', content: numberingXml() },
    { name: 'word/settings.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/><w:defaultTabStop w:val="720"/></w:settings>' },
    { name: 'word/header1.xml', content: headerXml(plan.title, plan.author) },
    { name: 'word/footer1.xml', content: footerXml() },
    {
      name: 'word/_rels/document.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
    },
  ]);
  const blob = new Blob([await zip.arrayBuffer()], { type: DOCX_MIME });
  return { blob, plan };
}

function extractDocumentParagraphs(source: string): Array<{ style: string; text: string }> {
  const output: Array<{ style: string; text: string }> = [];
  let inParagraph = false;
  let inText = false;
  let style = 'Normal';
  let text = '';
  for (const event of scanXml(source)) {
    if (event.type === 'open') {
      if (event.local === 'p') {
        inParagraph = true;
        inText = false;
        style = 'Normal';
        text = '';
      } else if (inParagraph && event.local === 'pstyle') {
        style = event.attrs['w:val'] ?? event.attrs.val ?? style;
      } else if (inParagraph && event.local === 't') {
        inText = true;
      } else if (inParagraph && event.local === 'br') {
        if ((event.attrs['w:type'] ?? event.attrs.type) !== 'page') text += '\n';
      }
    } else if (event.type === 'close') {
      if (event.local === 't') inText = false;
      if (event.local === 'p') {
        output.push({ style, text: text.trim() });
        inParagraph = false;
      }
    } else if (event.type === 'text' && inParagraph && inText) {
      text += event.text;
    }
  }
  return output;
}

export async function verifyDocxExport(blob: Blob, plan: DocxManuscriptPlan): Promise<DocxVerification> {
  const issues: string[] = [];
  const entries = await readZip(await blob.arrayBuffer());
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  for (const required of [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
    'word/styles.xml',
    'word/numbering.xml',
    'word/_rels/document.xml.rels',
  ]) {
    if (!byName.has(required)) issues.push(`缺少 ${required}`);
  }
  const documentEntry = byName.get('word/document.xml');
  if (!documentEntry) {
    return { valid: false, issues, paragraphCount: 0, volumeCount: 0, chapterCount: 0, sceneCount: 0 };
  }
  const actual = extractDocumentParagraphs(readEntryText(documentEntry)).filter((paragraph) => paragraph.text);
  const expected = plan.paragraphs.filter((paragraph) => paragraph.text).map((paragraph) => ({
    style: paragraph.style,
    text: paragraph.text,
  }));
  if (actual.length !== expected.length) {
    issues.push(`段落数不一致：预期 ${expected.length}，实际 ${actual.length}`);
  }
  const length = Math.min(actual.length, expected.length);
  for (let index = 0; index < length; index++) {
    if (actual[index].style !== expected[index].style || actual[index].text !== expected[index].text) {
      issues.push(`第 ${index + 1} 段不一致`);
      if (issues.length >= 12) break;
    }
  }
  const count = (style: string) => actual.filter((paragraph) => paragraph.style === style).length;
  const volumeCount = count('Heading1');
  const chapterCount = count('Heading2');
  const sceneCount = count('Heading3');
  if (volumeCount !== plan.volumeCount) issues.push(`卷标题数不一致：预期 ${plan.volumeCount}，实际 ${volumeCount}`);
  if (chapterCount !== plan.chapterCount) issues.push(`章标题数不一致：预期 ${plan.chapterCount}，实际 ${chapterCount}`);
  if (plan.paragraphs.some((paragraph) => paragraph.style === 'Heading3') && sceneCount !== plan.sceneCount) {
    issues.push(`场景标题数不一致：预期 ${plan.sceneCount}，实际 ${sceneCount}`);
  }
  return {
    valid: issues.length === 0,
    issues,
    paragraphCount: actual.length,
    volumeCount,
    chapterCount,
    sceneCount,
  };
}
