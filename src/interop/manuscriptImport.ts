/**
 * R13-1 稿件导入:纯 TXT / Markdown 长文档 → 卷/章/场景 结构。
 *
 * 输出与 R5-A / R10-A5 的完整项目导入统一(卷 → 章 → 场景 → 正文块),
 * 但不需要模型:全部靠标题层级 + 中文章节正则本地拆分。
 * 二进制格式(EPUB / DOCX / PDF)将复用同一 ParsedManuscript 出口。
 */
import type { DocBlock, Document, Folder, Project } from '../types';
import { uid } from '../util';
import { decodeTextFile, decodeWithFallback } from './textEncoding';

export interface ParsedScene {
  title: string;
  blocks: DocBlock[];
  /** 原始正文字符数(不含空白),供预检显示 */
  chars: number;
}

export interface ParsedChapter {
  title: string;
  scenes: ParsedScene[];
}

export interface ParsedVolume {
  title: string;
  chapters: ParsedChapter[];
}

export interface ParsedManuscript {
  projectName?: string;
  author?: string;
  volumes: ParsedVolume[];
  /** 解析器产生的警告(未识别的行、层级异常等) */
  warnings: string[];
  /** 全部场景数与正文总字符数,用于预检卡片 */
  sceneCount: number;
  totalChars: number;
}

export type ManuscriptFormat = 'md' | 'txt';

export interface ParseOptions {
  format?: ManuscriptFormat;
  /** 空白行合并阈值:超过 N 个连续空行视为章节分隔(TXT 用) */
  blankSeparator?: number;
}

const CN_VOLUME_RE = /^\s*(第[零一二三四五六七八九十百千万\d]+[卷部篇])[\s：:.、]*(.*)$/;
const CN_CHAPTER_RE = /^\s*(第[零一二三四五六七八九十百千万\d]+[章回])[\s：:.、]*(.*)$/;
const CN_SCENE_RE = /^\s*(第[零一二三四五六七八九十百千万\d]+[节场幕])[\s：:.、]*(.*)$/;
const EN_CHAPTER_RE = /^\s*Chapter\s+([IVXLC\d]+)\s*[:：.\-—]?\s*(.*)$/i;
const EN_PART_RE = /^\s*Part\s+([IVXLC\d]+)\s*[:：.\-—]?\s*(.*)$/i;

export async function readManuscriptFile(file: File): Promise<{ text: string; format: ManuscriptFormat }> {
  const buf = await file.arrayBuffer();
  const raw = decodeTextFile(new Uint8Array(buf));
  const text = await decodeWithFallback(file, raw);
  const format: ManuscriptFormat = /\.md$|\.markdown$/i.test(file.name) ? 'md' : 'txt';
  return { text, format };
}

/** 主入口 */
export function parseManuscript(text: string, options: ParseOptions = {}): ParsedManuscript {
  const format = options.format ?? 'txt';
  const warnings: string[] = [];
  const { body, projectName, author } = stripFrontMatter(text, warnings);
  const volumes = format === 'md' ? parseMd(body, warnings) : parseTxt(body, warnings, options.blankSeparator ?? 2);
  const { sceneCount, totalChars } = countManuscript(volumes);
  return { projectName, author, volumes, warnings, sceneCount, totalChars };
}

interface FrontMatter { body: string; projectName?: string; author?: string }

function stripFrontMatter(text: string, warnings: string[]): FrontMatter {
  if (!text.startsWith('---')) return { body: text };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { body: text };
  const raw = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  const meta: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w\-]*)\s*:\s*(.*)$/.exec(line);
    if (m) meta[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  const projectName = meta.title || meta.name;
  const author = meta.author;
  if (Object.keys(meta).length === 0) warnings.push('文档以 --- 开头但未识别到有效 frontmatter,将作为正文导入');
  return { body, projectName, author };
}

/** Markdown:`#` = 卷,`##` = 章,`###`(或没有二级时的 `##`)= 场景 */
function parseMd(text: string, warnings: string[]): ParsedVolume[] {
  const lines = text.split(/\r?\n/);
  const volumes: ParsedVolume[] = [];
  let volume: ParsedVolume | null = null;
  let chapter: ParsedChapter | null = null;
  let scene: ParsedScene | null = null;
  let inCodeFence = false;
  let sawHeading = false;
  let paragraphBuf: string[] = [];

  const ensureVolume = () => { if (!volume) { volume = { title: '', chapters: [] }; volumes.push(volume); } return volume; };
  const ensureChapter = () => { if (!chapter) { chapter = { title: '', scenes: [] }; ensureVolume().chapters.push(chapter); } return chapter; };
  const ensureScene = () => { if (!scene) { scene = { title: '', blocks: [], chars: 0 }; ensureChapter().scenes.push(scene); } return scene; };
  const flushParagraph = () => {
    const text = paragraphBuf.join('\n').trim();
    paragraphBuf = [];
    if (!text) return;
    const s = ensureScene();
    s.blocks.push({ id: uid(), type: 'paragraph', text, flowRole: 'none' });
    s.chars += countChars(text);
  };
  const startScene = (title: string) => {
    flushParagraph();
    scene = { title, blocks: [], chars: 0 };
    ensureChapter().scenes.push(scene);
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      paragraphBuf.push(line);
      continue;
    }
    if (inCodeFence) { paragraphBuf.push(line); continue; }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      sawHeading = true;
      flushParagraph();
      const level = heading[1].length;
      const title = heading[2].trim();
      if (level === 1) { volume = { title, chapters: [] }; volumes.push(volume); chapter = null; scene = null; }
      else if (level === 2) { chapter = { title, scenes: [] }; ensureVolume().chapters.push(chapter); scene = null; }
      else if (level === 3) { startScene(title); }
      else {
        // 四级以上作为子标题嵌入当前场景
        const s = ensureScene();
        s.blocks.push({ id: uid(), type: 'subheading', text: title, level: level === 4 ? 3 : 2 });
      }
      continue;
    }

    if (/^\s*(---+|===+|\*\*\*+)\s*$/.test(line)) {
      // 分隔线 = 场景切换(在 md 里既能分节又能画装饰,取前者)
      flushParagraph();
      startScene('');
      continue;
    }

    if (line.trim() === '') { flushParagraph(); continue; }

    paragraphBuf.push(line);
  }
  flushParagraph();

  if (!sawHeading) warnings.push('未识别到任何 # 标题,全文作为单场景导入');
  return normalizeVolumes(volumes, warnings, '正文');
}

/** 纯文本:按中文章卷 / Chapter 正则拆分;空白行只做段落分隔 */
function parseTxt(text: string, warnings: string[], blankSeparator: number): ParsedVolume[] {
  const lines = text.split(/\r?\n/);
  const volumes: ParsedVolume[] = [];
  let volume: ParsedVolume | null = null;
  let chapter: ParsedChapter | null = null;
  let scene: ParsedScene | null = null;
  let paragraphBuf: string[] = [];
  let blankRun = 0;

  const ensureVolume = () => { if (!volume) { volume = { title: '', chapters: [] }; volumes.push(volume); } return volume; };
  const ensureChapter = () => { if (!chapter) { chapter = { title: '', scenes: [] }; ensureVolume().chapters.push(chapter); } return chapter; };
  const ensureScene = () => { if (!scene) { scene = { title: '', blocks: [], chars: 0 }; ensureChapter().scenes.push(scene); } return scene; };
  const flushParagraph = () => {
    const text = paragraphBuf.join('').replace(/\s+$/, '');
    paragraphBuf = [];
    if (!text.trim()) return;
    const s = ensureScene();
    s.blocks.push({ id: uid(), type: 'paragraph', text, flowRole: 'none' });
    s.chars += countChars(text);
  };
  const startScene = (title: string) => {
    flushParagraph();
    scene = { title, blocks: [], chars: 0 };
    ensureChapter().scenes.push(scene);
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();

    if (trimmed === '') {
      blankRun++;
      flushParagraph();
      // 多空行本身不切场景,只有命中章节正则才切。blankSeparator 用于未来软切场
      void blankSeparator;
      continue;
    }
    blankRun = 0;
    void blankRun;

    const cnVol = CN_VOLUME_RE.exec(trimmed);
    const enPart = !cnVol ? EN_PART_RE.exec(trimmed) : null;
    if (cnVol || enPart) {
      flushParagraph();
      const title = cnVol
        ? [cnVol[1], cnVol[2]].filter(Boolean).join(' ').trim()
        : `Part ${[enPart![1], enPart![2]].filter(Boolean).join(' ').trim()}`;
      volume = { title, chapters: [] }; volumes.push(volume); chapter = null; scene = null;
      continue;
    }
    const cnCh = CN_CHAPTER_RE.exec(trimmed);
    const enCh = !cnCh ? EN_CHAPTER_RE.exec(trimmed) : null;
    if (cnCh || enCh) {
      flushParagraph();
      const title = cnCh
        ? [cnCh[1], cnCh[2]].filter(Boolean).join(' ').trim()
        : `Chapter ${[enCh![1], enCh![2]].filter(Boolean).join(' ').trim()}`;
      chapter = { title, scenes: [] }; ensureVolume().chapters.push(chapter); scene = null;
      continue;
    }
    const sm = CN_SCENE_RE.exec(trimmed);
    if (sm) {
      const title = [sm[1], sm[2]].filter(Boolean).join(' ').trim();
      startScene(title);
      continue;
    }

    paragraphBuf.push(trimmed + '\n');
  }
  flushParagraph();

  if (volumes.length === 0) warnings.push('未识别到卷 / 章 / 节标题(中文正则 / Chapter),全文作为单场景导入');
  return normalizeVolumes(volumes, warnings, '正文');
}

/** 兜底:没有场景/章的层级自动补齐,同时清掉纯空场景 */
function normalizeVolumes(volumes: ParsedVolume[], warnings: string[], defaultTitle: string): ParsedVolume[] {
  if (volumes.length === 0) return [{ title: '', chapters: [{ title: '', scenes: [{ title: defaultTitle, blocks: [], chars: 0 }] }] }];
  for (const v of volumes) {
    if (v.chapters.length === 0) v.chapters.push({ title: '', scenes: [] });
    for (const c of v.chapters) {
      if (c.scenes.length === 0) c.scenes.push({ title: '', blocks: [], chars: 0 });
      c.scenes = c.scenes.filter((s) => s.blocks.length > 0 || s.title.trim());
      if (c.scenes.length === 0) c.scenes.push({ title: c.title || defaultTitle, blocks: [], chars: 0 });
    }
  }
  if (volumes.some((v) => v.chapters.every((c) => c.scenes.every((s) => s.blocks.length === 0)))) {
    warnings.push('部分卷 / 章内没有正文,已保留为空占位');
  }
  return volumes;
}

function countChars(text: string): number {
  // 与 audit.ts 的 countWords 口径一致:CJK 按字,拉丁按词
  const cjk = text.match(/[一-鿿㐀-䶿]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return cjk + latin;
}

function countManuscript(volumes: ParsedVolume[]): { sceneCount: number; totalChars: number } {
  let sceneCount = 0, totalChars = 0;
  for (const v of volumes) for (const c of v.chapters) for (const s of c.scenes) {
    sceneCount++;
    totalChars += s.chars;
  }
  return { sceneCount, totalChars };
}

/**
 * 把解析结果写入项目:
 * 卷 / 章 → 文档模块的两级文件夹树;
 * 场景 → 每个一份 Document(status='outline',blocks 直接使用解析出的段落)。
 * 只新增、不删除、不覆盖既有对象;可用 Ctrl+Z 一步撤销。
 */
export function applyManuscript(project: Project, parsed: ParsedManuscript): {
  addedDocs: number;
  addedFolders: number;
  volumeFolders: Folder[];
} {
  const now = Date.now();
  let addedDocs = 0;
  let addedFolders = 0;
  const volumeFolders: Folder[] = [];
  const volumeOrder = project.folders.filter((f) => f.module === 'document' && !f.parentId).length;

  for (let vi = 0; vi < parsed.volumes.length; vi++) {
    const v = parsed.volumes[vi];
    const vTitle = v.title || `卷${vi + 1}`;
    const volumeFolder: Folder = {
      id: uid(), name: vTitle, module: 'document', parentId: null,
      order: volumeOrder + vi,
    };
    project.folders.push(volumeFolder);
    volumeFolders.push(volumeFolder);
    addedFolders++;

    for (let ci = 0; ci < v.chapters.length; ci++) {
      const c = v.chapters[ci];
      const cTitle = c.title || `第${ci + 1}章`;
      const chapterFolder: Folder = {
        id: uid(), name: cTitle, module: 'document', parentId: volumeFolder.id, order: ci,
      };
      project.folders.push(chapterFolder);
      addedFolders++;

      for (let si = 0; si < c.scenes.length; si++) {
        const s = c.scenes[si];
        const doc: Document = {
          id: uid(),
          folderId: chapterFolder.id,
          order: si,
          name: s.title || `场景${si + 1}`,
          category: '导入稿件',
          blocks: s.blocks.length > 0 ? s.blocks : [{ id: uid(), type: 'paragraph', text: '', flowRole: 'none' }],
          notes: '',
          status: 'outline',
          createdAt: now,
          updatedAt: now,
        };
        project.documents.push(doc);
        addedDocs++;
      }
    }
  }
  if (!project.documentCategories.includes('导入稿件')) {
    project.documentCategories.push('导入稿件');
  }
  return { addedDocs, addedFolders, volumeFolders };
}
