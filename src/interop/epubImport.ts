/**
 * R13-2 EPUB 导入。
 *
 * 定位与提取流程参考 autopage 的
 * `src/lib/functions/file-loaders/epub/extract-epub.ts`
 * (© ッツ Reader Authors, BSD-3-Clause):
 *   META-INF/container.xml → 定位 OPF → 按 spine 顺序遍历 XHTML → 抽正文
 * 我们不走 autopage 的 `@zip.js/zip.js` + `fast-xml-parser`,而是复用本项目
 * `src/interop/zip.ts` + 自研极简 XML 扫描器 `xmlLite.ts`,保持零第三方依赖,
 * 浏览器与 Node(测试)环境行为一致。
 *
 * 输出走 R13-1 的 `ParsedManuscript`:一个 EPUB → 一卷,每个 spine XHTML → 一章,
 * 每章内按 `h1..h6` 标题切场景;没有内部标题时全章合成单场景。
 */
import type { DocBlock } from '../types';
import { uid } from '../util';
import { readZip, readEntryText, type ZipEntry } from './zip';
import type { ParsedChapter, ParsedManuscript, ParsedScene, ParsedVolume } from './manuscriptImport';
import { findAllElements, findElement, elementText, scanXml, decodeEntities, localName } from './xmlLite';

function joinPath(dir: string, rel: string): string {
  if (rel.startsWith('/')) return rel.replace(/^\/+/, '');
  const parts = (dir ? dir.split('/') : []).concat(rel.split('/')).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p === '.') continue;
    if (p === '..') { out.pop(); continue; }
    out.push(p);
  }
  return out.join('/');
}

function pathDir(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '';
}

function requireEntry(map: Map<string, ZipEntry>, name: string): ZipEntry {
  const entry = map.get(name);
  if (!entry) throw new Error(`epub:缺少 ${name}`);
  return entry;
}

/** container.xml → OPF 的 zip 路径 */
function findOpfPath(entry: ZipEntry): string {
  const source = readEntryText(entry);
  const attrs = findElement(source, 'rootfile');
  const path = attrs?.['full-path'];
  if (!path) throw new Error('epub:container.xml 未包含 rootfile full-path');
  return path;
}

interface OpfManifestItem { id: string; href: string; mediaType: string }
interface OpfMeta {
  title?: string;
  language?: string;
  creator?: string;
  manifest: Map<string, OpfManifestItem>;
  spine: string[];
  baseDir: string;
}

function parseOpf(entry: ZipEntry, opfPath: string): OpfMeta {
  const source = readEntryText(entry);
  const title = elementText(source, 'title');
  const language = elementText(source, 'language');
  const creator = elementText(source, 'creator');

  const manifest = new Map<string, OpfManifestItem>();
  for (const attrs of findAllElements(source, 'item')) {
    const id = attrs.id;
    const href = attrs.href;
    const mediaType = attrs['media-type'] ?? '';
    if (id && href) manifest.set(id, { id, href: decodeURIComponent(href), mediaType });
  }

  const spine: string[] = [];
  for (const attrs of findAllElements(source, 'itemref')) {
    if (attrs.linear === 'no') continue;
    if (attrs.idref) spine.push(attrs.idref);
  }

  return { title, language, creator, manifest, spine, baseDir: pathDir(opfPath) };
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCK_TAGS = new Set(['p', 'blockquote', 'li']);
const SKIP_CONTENT_TAGS = new Set(['script', 'style', 'nav', 'head']);

/** 一份 XHTML → 一个 ParsedChapter;内部 h1..h6 切场景,块级标签逐段收集 */
export function xhtmlToChapter(xhtml: string, chapterFallback: string): ParsedChapter {
  const scenes: ParsedScene[] = [];
  let currentScene: ParsedScene = { title: '', blocks: [], chars: 0 };
  let chapterTitle = chapterFallback;
  let sceneStarted = false;
  let skipDepth = 0;

  // 当前"打开中的块级容器"栈:每层记录 tag 与文本累加 buffer
  interface OpenBlock { tag: string; local: string; text: string }
  const blockStack: OpenBlock[] = [];

  const pushBlockText = (tagLocal: string, text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (HEADING_TAGS.has(tagLocal)) {
      // 第一个 h1(且尚未收集任何段落)当章标题;其余标题切场景
      if (tagLocal === 'h1' && !sceneStarted && currentScene.blocks.length === 0) {
        chapterTitle = clean;
      } else {
        if (currentScene.blocks.length > 0 || currentScene.title) scenes.push(currentScene);
        currentScene = { title: clean, blocks: [], chars: 0 };
        sceneStarted = true;
      }
      return;
    }
    currentScene.blocks.push({ id: uid(), type: 'paragraph', text: clean, flowRole: 'none' } satisfies DocBlock);
    currentScene.chars += countChars(clean);
  };

  for (const ev of scanXml(xhtml)) {
    if (ev.type === 'open') {
      if (SKIP_CONTENT_TAGS.has(ev.local)) { if (!ev.selfClose) skipDepth++; continue; }
      if (skipDepth > 0) continue;
      if (HEADING_TAGS.has(ev.local) || BLOCK_TAGS.has(ev.local)) {
        if (!ev.selfClose) blockStack.push({ tag: ev.tag, local: ev.local, text: '' });
      }
      continue;
    }
    if (ev.type === 'close') {
      if (SKIP_CONTENT_TAGS.has(ev.local)) { if (skipDepth > 0) skipDepth--; continue; }
      if (skipDepth > 0) continue;
      if (HEADING_TAGS.has(ev.local) || BLOCK_TAGS.has(ev.local)) {
        // 找到最近的匹配块并弹出;若不匹配就找到栈上匹配的位置连带弹出
        for (let idx = blockStack.length - 1; idx >= 0; idx--) {
          if (blockStack[idx].local === ev.local) {
            const inner = blockStack.splice(idx).map((b) => b.text).join(' ');
            pushBlockText(ev.local, inner);
            break;
          }
        }
      }
      continue;
    }
    if (ev.type === 'text' && skipDepth === 0) {
      if (blockStack.length > 0) blockStack[blockStack.length - 1].text += ev.text;
    }
  }
  // 结束时若还有未闭合的块,兜底输出
  while (blockStack.length > 0) {
    const b = blockStack.shift()!;
    pushBlockText(b.local, b.text);
  }
  if (currentScene.blocks.length > 0 || currentScene.title) scenes.push(currentScene);

  return { title: chapterTitle, scenes: scenes.length > 0 ? scenes : [{ title: '', blocks: [], chars: 0 }] };
}

function countChars(text: string): number {
  const cjk = text.match(/[一-鿿㐀-䶿]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return cjk + latin;
}

/** 主入口:EPUB 二进制 → ParsedManuscript */
export async function parseEpub(buffer: ArrayBuffer): Promise<ParsedManuscript> {
  const entries = await readZip(buffer);
  const map = new Map<string, ZipEntry>(entries.map((e) => [e.name, e]));
  const container = requireEntry(map, 'META-INF/container.xml');
  const opfPath = findOpfPath(container);
  const opfEntry = requireEntry(map, opfPath);
  const meta = parseOpf(opfEntry, opfPath);

  const warnings: string[] = [];
  const chapters: ParsedChapter[] = [];
  let seq = 0;
  for (const idref of meta.spine) {
    const item = meta.manifest.get(idref);
    if (!item) { warnings.push(`spine 引用了未在 manifest 中的 id:${idref}`); continue; }
    if (!/xhtml|html/i.test(item.mediaType)) continue;
    const absolute = joinPath(meta.baseDir, item.href);
    const entry = map.get(absolute);
    if (!entry) { warnings.push(`spine 项缺失文件:${absolute}`); continue; }
    seq++;
    try {
      chapters.push(xhtmlToChapter(readEntryText(entry), `第 ${seq} 篇`));
    } catch (e) {
      warnings.push(`${absolute} 解析失败:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (chapters.length === 0) warnings.push('EPUB 中未找到可导入的正文文件');

  const volume: ParsedVolume = { title: meta.title ?? '', chapters };
  const sceneCount = chapters.reduce((s, c) => s + c.scenes.length, 0);
  const totalChars = chapters.reduce((s, c) => s + c.scenes.reduce((s2, sc) => s2 + sc.chars, 0), 0);
  return {
    projectName: meta.title,
    author: meta.creator,
    volumes: [volume],
    warnings,
    sceneCount,
    totalChars,
  };
}

// 保留导入避免"未使用"警告(公开 API 供后续 R13 批次可能复用)
void decodeEntities;
void localName;
