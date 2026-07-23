/**
 * R13-3 DOCX 导入。
 *
 * DOCX 是 zip + OOXML,复用本项目 `src/interop/zip.ts` 解压 +
 * `src/interop/xmlLite.ts` 扫描,不引入第三方 XML/DOCX 库。
 *
 * 支持的结构:
 *   - `word/document.xml`  主正文
 *   - `<w:p>`               段落
 *     - `<w:pPr><w:pStyle w:val="Heading1|Heading2|Heading3|Title|Subtitle"/></w:pPr>`
 *     - `<w:r><w:t>...</w:t></w:r>`  run + 文本
 *     - `<w:br/>`  换行(合并进段落文本)
 *     - `<w:tab/>` 制表(合并为空格)
 *   - `docProps/core.xml`  可选:`<dc:title>` `<dc:creator>`
 *
 * 层级映射:
 *   Title          → projectName
 *   Heading1       → 卷
 *   Heading2       → 章
 *   Heading3/4/5/6 → 场景(4~6 视作三级子场景)
 *   其它            → 正文段落
 */
import type { DocBlock } from '../types';
import { uid } from '../util';
import { readZip, readEntryText, type ZipEntry } from './zip';
import type { ParsedChapter, ParsedManuscript, ParsedScene, ParsedVolume } from './manuscriptImport';
import { elementText, scanXml } from './xmlLite';

const HEADING_STYLES = new Set(['heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6']);

function styleLevel(name: string): number | null {
  const norm = name.replace(/\s+/g, '').toLowerCase();
  if (norm === 'title' || norm === 'manuscripttitle') return 0;
  if (norm === 'author' || norm === 'manuscriptauthor' || norm === 'covermeta') return -1;
  if (norm === 'subtitle') return 0.5;
  if (HEADING_STYLES.has(norm)) return Number(norm.slice(-1));
  return null;
}

interface DocParagraph {
  /** 0=Title, 0.5=Subtitle, 1..6=Heading N, null=普通段落 */
  level: number | null;
  text: string;
}

/** 遍历 word/document.xml,按 <w:p> 展开为段落 */
function extractParagraphs(source: string): DocParagraph[] {
  const paragraphs: DocParagraph[] = [];
  let pText = '';
  let pLevel: number | null = null;
  let inPara = false;
  let inRun = false;
  let inText = false;
  let inPStyle = false;
  let styleName = '';

  for (const ev of scanXml(source)) {
    if (ev.type === 'open') {
      if (ev.local === 'p') { inPara = true; pText = ''; pLevel = null; styleName = ''; continue; }
      if (!inPara) continue;
      if (ev.local === 'pstyle') {
        inPStyle = true;
        const val = ev.attrs['w:val'] ?? ev.attrs.val;
        if (val) styleName = val;
        if (ev.selfClose) { inPStyle = false; pLevel = styleLevel(styleName); }
        continue;
      }
      if (ev.local === 'r') { inRun = true; continue; }
      if (inRun) {
        if (ev.local === 't') { inText = true; continue; }
        if (ev.local === 'br') { pText += '\n'; continue; }
        if (ev.local === 'tab') { pText += ' '; continue; }
      }
      continue;
    }
    if (ev.type === 'close') {
      if (ev.local === 't') { inText = false; continue; }
      if (ev.local === 'r') { inRun = false; continue; }
      if (ev.local === 'pstyle') { inPStyle = false; if (styleName) pLevel = styleLevel(styleName); continue; }
      if (ev.local === 'p') {
        const text = pText.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
        paragraphs.push({ level: pLevel, text });
        inPara = false;
        pText = '';
        pLevel = null;
      }
      continue;
    }
    if (ev.type === 'text' && inText) {
      pText += ev.text;
    }
    void inPStyle;
  }
  return paragraphs;
}

/** docProps/core.xml → { title, creator } */
function extractCoreMeta(source: string): { title?: string; creator?: string } {
  return {
    title: elementText(source, 'title'),
    creator: elementText(source, 'creator'),
  };
}

function requireEntry(map: Map<string, ZipEntry>, name: string): ZipEntry {
  const entry = map.get(name);
  if (!entry) throw new Error(`docx:缺少 ${name}`);
  return entry;
}

function countChars(text: string): number {
  const cjk = text.match(/[一-鿿㐀-䶿]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return cjk + latin;
}

/**
 * 段落序列 → 卷/章/场景:
 *   Heading1 → 新卷;Heading2 → 新章;Heading3+ → 新场景;
 *   Title 作 projectName;Subtitle 若在标题后紧接、且未出现层级标题,视为章标题(用作短篇集)
 *   其它段落挂在当前场景下(paragraph 块);
 *   没有任何层级标题时,全部段落挂在单卷单章单场景内。
 */
function assembleVolumes(paragraphs: DocParagraph[], warnings: string[]): { volumes: ParsedVolume[]; projectName?: string } {
  const volumes: ParsedVolume[] = [];
  let volume: ParsedVolume | null = null;
  let chapter: ParsedChapter | null = null;
  let scene: ParsedScene | null = null;
  let projectName: string | undefined;
  let sawHeading = false;

  const ensureVolume = () => { if (!volume) { volume = { title: '', chapters: [] }; volumes.push(volume); } return volume; };
  const ensureChapter = () => { if (!chapter) { chapter = { title: '', scenes: [] }; ensureVolume().chapters.push(chapter); } return chapter; };
  const ensureScene = () => { if (!scene) { scene = { title: '', blocks: [], chars: 0 }; ensureChapter().scenes.push(scene); } return scene; };

  for (const p of paragraphs) {
    if (p.level === -1) continue;
    if (p.level === 0) {
      // Title:取第一个非空的作为项目名
      if (!projectName && p.text) projectName = p.text;
      continue;
    }
    if (p.level === 0.5) {
      // Subtitle:若还没标题层级,作为章的短说明写入下一段;这里简单挂到当前场景/章
      if (p.text) {
        const s = ensureScene();
        s.blocks.push({ id: uid(), type: 'subheading', text: p.text, level: 2 } satisfies DocBlock);
      }
      continue;
    }
    if (p.level === 1) {
      sawHeading = true;
      volume = { title: p.text, chapters: [] };
      volumes.push(volume);
      chapter = null;
      scene = null;
      continue;
    }
    if (p.level === 2) {
      sawHeading = true;
      chapter = { title: p.text, scenes: [] };
      ensureVolume().chapters.push(chapter);
      scene = null;
      continue;
    }
    if (p.level !== null && p.level >= 3) {
      sawHeading = true;
      scene = { title: p.text, blocks: [], chars: 0 };
      ensureChapter().scenes.push(scene);
      continue;
    }
    // 普通段落
    if (!p.text) continue;
    const s = ensureScene();
    s.blocks.push({ id: uid(), type: 'paragraph', text: p.text, flowRole: 'none' } satisfies DocBlock);
    s.chars += countChars(p.text);
  }

  if (!sawHeading) {
    warnings.push('DOCX 中未识别到任何标题样式(Heading1~6 / Title),全文作为单场景导入');
  }

  return { volumes, projectName };
}

/** 主入口:DOCX 二进制 → ParsedManuscript */
export async function parseDocx(buffer: ArrayBuffer): Promise<ParsedManuscript> {
  const entries = await readZip(buffer);
  const map = new Map<string, ZipEntry>(entries.map((e) => [e.name, e]));
  const documentEntry = requireEntry(map, 'word/document.xml');
  const paragraphs = extractParagraphs(readEntryText(documentEntry));

  const coreEntry = map.get('docProps/core.xml');
  const coreMeta = coreEntry ? extractCoreMeta(readEntryText(coreEntry)) : {};

  const warnings: string[] = [];
  const assembled = assembleVolumes(paragraphs, warnings);
  const projectName = coreMeta.title || assembled.projectName;
  const author = coreMeta.creator;

  // 兜底:没有识别到卷/章时也要有一个占位卷 + 章
  const volumes = assembled.volumes.length > 0
    ? assembled.volumes
    : [{ title: '', chapters: [{ title: '', scenes: [{ title: '', blocks: [], chars: 0 }] }] }] satisfies ParsedVolume[];

  let sceneCount = 0, totalChars = 0;
  for (const v of volumes) for (const c of v.chapters) for (const s of c.scenes) {
    sceneCount++;
    totalChars += s.chars;
  }

  return { projectName, author, volumes, warnings, sceneCount, totalChars };
}
