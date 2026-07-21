import { parseManuscript, type ParsedChapter, type ParsedManuscript, type ParsedVolume } from './manuscriptImport';
import { xhtmlToChapter } from './epubImport';
import { decodeTextFile } from './textEncoding';
import { decodeEntities } from './xmlLite';

/**
 * MOBI / AZW3 稿件导入:零第三方依赖的 PalmDB 解析,浏览器与桌面通用。
 * 解析算法移植自 autopage(BSD-3-Clause)的 Rust 实现
 * (kf8_parser.rs / mobi_parser.rs),覆盖:
 * - PalmDB 容器与记录表
 * - 按 extra_record_data_flags 剥离记录尾部元数据(Calibre 口径的反向 varint)
 * - PalmDoc LZ77 与 HUFF/CDIC 两种解压
 * - MOBI6+KF8 合订(BOUNDARY)与纯 KF8(AZW3)检测
 * - EXTH 元数据(书名 / 作者)
 * 文本导入不需要图片 / 封面 / 精确 KF8 fragment 重组,正文按 pagebreak
 * 切章后走与 EPUB 相同的 XHTML 段落抽取(xhtmlToChapter)。
 */

/* ---------- 二进制读取 ---------- */

const readU16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const readU32 = (b: Uint8Array, o: number) => (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);

function ascii(b: Uint8Array, o: number, len: number): string {
  let s = '';
  for (let i = 0; i < len && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
  return s;
}

/* ---------- PalmDB 容器 ---------- */

function parsePalmDb(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length < 86) throw new Error('文件太短,不是有效的 MOBI / AZW3');
  const type = ascii(bytes, 60, 8);
  if (type !== 'BOOKMOBI') throw new Error(`不是 MOBI 容器(类型 ${type.trim() || '未知'})`);
  const numRecords = readU16(bytes, 76);
  if (numRecords === 0) throw new Error('MOBI 容器中没有记录');
  const infoEnd = 78 + numRecords * 8;
  if (infoEnd > bytes.length) throw new Error('MOBI 记录表超出文件范围');
  const offsets: number[] = [];
  for (let i = 0; i < numRecords; i++) offsets.push(readU32(bytes, 78 + i * 8));
  const records: Uint8Array[] = [];
  for (let i = 0; i < numRecords; i++) {
    const start = offsets[i];
    const end = i + 1 < numRecords ? offsets[i + 1] : bytes.length;
    records.push(start <= end && end <= bytes.length ? bytes.subarray(start, end) : bytes.subarray(0, 0));
  }
  return records;
}

/* ---------- 记录尾部元数据剥离 ---------- */

/** Calibre 口径的反向 varint:从记录末尾向前读,MSB=1 为终止位 */
function sizeofTrailingEntry(data: Uint8Array, psize: number): number {
  let bitpos = 0;
  let result = 0;
  let p = psize;
  for (;;) {
    if (p === 0) return result;
    p--;
    const v = data[p];
    result |= (v & 0x7f) << bitpos;
    bitpos += 7;
    if ((v & 0x80) !== 0 || bitpos >= 28) return result;
  }
}

function stripRecordTrailers(record: Uint8Array, flags: number): Uint8Array {
  const size = record.length;
  let num = 0;
  let f = flags >>> 1;
  while (f !== 0) {
    if ((f & 1) === 1) {
      const ts = sizeofTrailingEntry(record, size - num);
      if (ts === 0 || ts > size - num) return record;
      num += ts;
    }
    f >>>= 1;
  }
  if ((flags & 1) === 1 && size > num) {
    const off = size - num - 1;
    num += (record[off] & 0x03) + 1;
  }
  if (num >= size) return record.subarray(0, 0);
  return record.subarray(0, size - num);
}

/* ---------- PalmDoc LZ77 解压 ---------- */

function decompressPalmDoc(data: Uint8Array): number[] {
  const length = data.length;
  let pos = 0;
  const text: number[] = [];
  let prev: number | null = null;
  while (pos < length) {
    const byte = data[pos];
    pos++;
    if (prev !== null) {
      const distLen = (((prev << 8) | byte) & 0x3fff);
      prev = null;
      const offset = distLen >> 3;
      const len = (distLen & 0x0007) + 3;
      let start: number;
      if (offset > text.length) {
        if (text.length === 0) return text;
        start = offset % text.length;
      } else {
        start = text.length - offset;
      }
      const end = Math.min(start + len, text.length);
      for (let i = start; i < end; i++) text.push(text[i]);
    } else if (byte === 0x0 || (byte >= 0x09 && byte <= 0x7f)) {
      text.push(byte);
    } else if (byte >= 0x1 && byte <= 0x8) {
      if (pos + byte <= length) {
        for (let i = 0; i < byte; i++) text.push(data[pos + i]);
        pos += byte;
      }
    } else if (byte >= 0x80 && byte <= 0xbf) {
      if (pos >= length) return text;
      prev = byte;
    } else {
      text.push(0x20);
      text.push(byte ^ 0x80);
    }
  }
  return text;
}

/* ---------- HUFF/CDIC 解压(Calibre 算法) ---------- */

interface HuffDict1Entry { codelen: number; term: boolean; maxcode: number }

class HuffCdic {
  private dict1: HuffDict1Entry[] = [];
  private mincode: number[] = new Array(33).fill(0);
  private maxcode: number[] = new Array(33).fill(0);
  private dictionary: { data: Uint8Array; flag: boolean }[] = [];

  constructor(huffRecord: Uint8Array, cdicRecords: Uint8Array[]) {
    if (huffRecord.length < 24 || ascii(huffRecord, 0, 4) !== 'HUFF') {
      throw new Error('HUFF 表头无效');
    }
    const off1 = readU32(huffRecord, 8);
    const off2 = readU32(huffRecord, 12);
    if (off1 + 1024 > huffRecord.length || off2 + 256 > huffRecord.length) {
      throw new Error('HUFF 表数据不完整');
    }
    for (let i = 0; i < 256; i++) {
      const v = readU32(huffRecord, off1 + i * 4);
      const codelen = v & 0x1f;
      const term = (v & 0x80) !== 0;
      const maxcodeRaw = v >>> 8;
      // 32 位 wrap 语义与 Rust wrapping_add/sub 一致(JS << 自带 mod 2^32)
      const maxcode = codelen > 0 ? ((((maxcodeRaw + 1) << (32 - codelen)) >>> 0) - 1) >>> 0 : 0;
      this.dict1.push({ codelen, term, maxcode });
    }
    for (let i = 0; i < 32; i++) {
      const minRaw = readU32(huffRecord, off2 + i * 8);
      const maxRaw = readU32(huffRecord, off2 + i * 8 + 4);
      const cl = i + 1;
      this.mincode[cl] = (minRaw << (32 - cl)) >>> 0;
      this.maxcode[cl] = ((((maxRaw + 1) << (32 - cl)) >>> 0) - 1) >>> 0;
    }
    for (const cdic of cdicRecords) {
      if (cdic.length < 16 || ascii(cdic, 0, 4) !== 'CDIC') throw new Error('CDIC 表头无效');
      const phrases = readU32(cdic, 8);
      const bits = readU32(cdic, 12);
      const n = Math.min(1 << bits, Math.max(0, phrases - this.dictionary.length));
      for (let j = 0; j < n; j++) {
        const offPos = 16 + j * 2;
        if (offPos + 2 > cdic.length) break;
        const off = readU16(cdic, offPos);
        const dataBase = 16 + off;
        if (dataBase + 2 > cdic.length) break;
        const blen = readU16(cdic, dataBase);
        const sliceLen = blen & 0x7fff;
        const flag = (blen & 0x8000) !== 0;
        const end = Math.min(dataBase + 2 + sliceLen, cdic.length);
        this.dictionary.push({ data: cdic.slice(dataBase + 2, end), flag });
      }
    }
  }

  unpack(data: Uint8Array): Uint8Array {
    // 输入侧
    let bitsleft = data.length * 8;
    const padded = new Uint8Array(data.length + 8);
    padded.set(data);
    let pos = 0;
    // 64 位窗口用两个 32 位无符号整数模拟,避免 BigInt(慢 10-100 倍)
    let high = readU32(padded, 0);
    let low = readU32(padded, 4);
    let n = 32;
    // 输出侧:预分配 8x 输入字节的缓冲区,不够就倍增;比 Array.push 快数十倍
    let out = new Uint8Array(Math.max(64, data.length * 8));
    let outLen = 0;
    const ensure = (need: number) => {
      if (outLen + need <= out.length) return;
      let newSize = out.length;
      while (newSize < outLen + need) newSize *= 2;
      const bigger = new Uint8Array(newSize);
      bigger.set(out.subarray(0, outLen));
      out = bigger;
    };
    for (;;) {
      if (n <= 0) {
        pos += 4;
        high = readU32(padded, pos);
        low = pos + 4 < padded.length ? readU32(padded, pos + 4) : 0;
        n += 32;
      }
      // code = (u64 >> n) & 0xFFFFFFFF —— n∈[1,32] 由代码路径保证
      const code = n >= 32
        ? (high >>> (n - 32)) >>> 0
        : (((high << (32 - n)) | (low >>> n)) >>> 0);
      const top8 = code >>> 24;
      let codelen = this.dict1[top8].codelen;
      const term = this.dict1[top8].term;
      let maxcodeVal = this.dict1[top8].maxcode;
      if (!term) {
        while (codelen < 33 && (code >>> 0) < this.mincode[codelen]) codelen++;
        if (codelen >= 33) break;
        maxcodeVal = this.maxcode[codelen];
      }
      n -= codelen;
      bitsleft -= codelen;
      if (bitsleft < 0) break;
      const r = (((maxcodeVal - code) >>> 0) >>> (32 - codelen));
      if (r >= this.dictionary.length) break;
      const entry = this.dictionary[r];
      let slice: Uint8Array;
      if (entry.flag) {
        slice = entry.data;
      } else {
        slice = this.unpack(entry.data);
        this.dictionary[r] = { data: slice, flag: true };
      }
      ensure(slice.length);
      out.set(slice, outLen);
      outLen += slice.length;
    }
    return out.subarray(0, outLen);
  }
}

/* ---------- EXTH 元数据(书名 / 作者) ---------- */

function parseExthMeta(rec0: Uint8Array): { title?: string; author?: string } {
  const out: { title?: string; author?: string } = {};
  if (rec0.length < 0x88 || ascii(rec0, 16, 4) !== 'MOBI') return out;
  const mobiLen = readU32(rec0, 20);
  const exthFlag = rec0.length >= 0x84 ? readU32(rec0, 0x80) : 0;
  if ((exthFlag & 0x40) === 0) return out;
  const exthStart = 16 + mobiLen;
  if (exthStart + 12 > rec0.length || ascii(rec0, exthStart, 4) !== 'EXTH') return out;
  const count = readU32(rec0, exthStart + 8);
  const dec = new TextDecoder('utf-8', { fatal: false });
  let p = exthStart + 12;
  for (let i = 0; i < count && p + 8 <= rec0.length; i++) {
    const recType = readU32(rec0, p);
    const recLen = readU32(rec0, p + 4);
    if (recLen < 8 || p + recLen > rec0.length) break;
    const value = rec0.subarray(p + 8, p + recLen);
    if (recType === 503 && !out.title) out.title = dec.decode(value).trim();
    if (recType === 100 && !out.author) out.author = dec.decode(value).trim();
    p += recLen;
  }
  return out;
}

/* ---------- 正文抽取 ---------- */

/** CP1252 高位区(0x80-0x9F)特殊字符;其余同 Latin-1 */
const CP1252_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function decodeCp1252(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) {
    if (b >= 0x80 && b <= 0x9f) s += CP1252_HIGH[b] ?? String.fromCharCode(b);
    else s += String.fromCharCode(b);
  }
  return s;
}

interface MobiText {
  html: string;
  title?: string;
  author?: string;
  isKf8: boolean;
}

export type MobiProgress = (stage: 'read' | 'decompress' | 'split', pct: number) => void;

function extractSegmentHtml(records: Uint8Array[], onProgress?: MobiProgress): { html: string; meta: { title?: string; author?: string } } {
  const rec0 = records[0];
  if (rec0.length < 18) throw new Error('MOBI 首记录损坏');
  const compression = readU16(rec0, 0);
  const textRecordCount = readU16(rec0, 8);
  const textEncoding = rec0.length >= 0x20 ? readU32(rec0, 0x1c) : 65001;
  let extraFlags = 0;
  if (rec0.length >= 0xf4) {
    const mobiLen = readU32(rec0, 0x14);
    if (mobiLen >= 0xe4) extraFlags = readU16(rec0, 0xf2);
  }
  const textEnd = 1 + textRecordCount;
  if (textEnd > records.length) throw new Error('MOBI 文本记录数超出容器范围');

  let raw: Uint8Array;
  if (compression === 17480) {
    // HUFF/CDIC:表位置在 rec0 0x70/0x74
    if (rec0.length < 0x78) throw new Error('HUFF 压缩的 MOBI 首记录太短');
    const huffOffset = readU32(rec0, 0x70);
    const huffCount = readU32(rec0, 0x74);
    if (huffOffset === 0 || huffCount === 0 || huffOffset + huffCount > records.length) {
      throw new Error('HUFF 表位置无效');
    }
    const huff = new HuffCdic(records[huffOffset], records.slice(huffOffset + 1, huffOffset + huffCount));
    const parts: Uint8Array[] = [];
    for (let i = 1; i < textEnd; i++) {
      parts.push(huff.unpack(stripRecordTrailers(records[i], extraFlags)));
      // 每记录回调一次;textRecordCount 决定分辨率(几百记录对 700 章书来说够用)
      if (onProgress && (i % 8 === 0 || i === textEnd - 1)) {
        onProgress('decompress', i / (textEnd - 1));
      }
    }
    const total = parts.reduce((s, p) => s + p.length, 0);
    raw = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { raw.set(p, o); o += p.length; }
  } else if (compression === 1 || compression === 2) {
    const buf: number[] = [];
    for (let i = 1; i < textEnd; i++) {
      const trimmed = stripRecordTrailers(records[i], extraFlags);
      if (compression === 1) for (const b of trimmed) buf.push(b);
      else for (const b of decompressPalmDoc(trimmed)) buf.push(b);
      if (onProgress && (i % 8 === 0 || i === textEnd - 1)) {
        onProgress('decompress', i / (textEnd - 1));
      }
    }
    raw = new Uint8Array(buf);
  } else {
    throw new Error(`不支持的 MOBI 压缩方式(${compression})`);
  }

  // 剥控制字符(Calibre 口径)
  raw = raw.filter((b) => b !== 0x00 && b !== 0x1e && b !== 0x02);

  // 解码:声明 cp1252 用映射表;其余(65001 为主)走已有的
  // BOM / 严格 UTF-8 / CJK 得分启发式(覆盖错标编码的中文书)
  const html = textEncoding === 1252 ? decodeCp1252(raw) : decodeTextFile(raw);
  return { html, meta: parseExthMeta(rec0) };
}

/** 提取正文 HTML:合订(BOUNDARY)优先用 MOBI6 段,纯 KF8(AZW3)整体解析 */
function extractMobiText(bytes: Uint8Array, onProgress?: MobiProgress): MobiText {
  const records = parsePalmDb(bytes);
  const boundaryIdx = records.findIndex((r) => ascii(r, 0, 8) === 'BOUNDARY');
  const rec0 = records[0];
  const pureKf8 = rec0.length >= 16 + 0x60 && ascii(rec0, 16, 4) === 'MOBI' && readU32(rec0, 16 + 0x58) === 8;

  // 合订本:BOUNDARY 之前是完整的 MOBI6 段,解析简单且文本一致
  const segment = boundaryIdx > 0 ? records.slice(0, boundaryIdx) : records;
  const { html, meta } = extractSegmentHtml(segment, onProgress);
  return { html, title: meta.title, author: meta.author, isKf8: pureKf8 };
}

/* ---------- 章节切分 → ParsedManuscript ---------- */

/** MOBI 分页标记(autopage splitIntoSections 同款正则) */
const PAGEBREAK_RE =
  /<(?:mbp:pagebreak|p\s+style="page-break-after:\s*always[^"]*"|div\s+class="mbp_pagebreak")\s*\/?>(?:<\/(?:mbp:pagebreak|p|div)>)?/gi;

/** HTML → 纯文本(段落间空行),供无结构大部头的 TXT 正则兜底切章 */
function htmlToPlainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(?:\/p|\/h[1-6]|\/div|br\s*\/?|\/li)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join('\n');
}

/** 主入口:MOBI / AZW3 二进制 → ParsedManuscript(单卷,分页符切章)
 *  onProgress:('decompress', 0..1)HUFF/CDIC 或 PalmDoc 解压进度;
 *             ('split', 0..1)章节切分进度(700 章级书里很快,不必刷太密) */
export function parseMobi(buffer: ArrayBuffer, onProgress?: MobiProgress): ParsedManuscript {
  const bytes = new Uint8Array(buffer);
  const warnings: string[] = [];
  const { html, title, author } = extractMobiText(bytes, onProgress);

  const parts = html.split(PAGEBREAK_RE).filter((p) => p.trim().length > 0);
  if (parts.length === 0) parts.push(html);

  const chapters: ParsedChapter[] = [];
  const total = parts.length;
  parts.forEach((part, i) => {
    try {
      const ch = xhtmlToChapter(part, `第 ${i + 1} 篇`);
      if (ch.scenes.some((s) => s.blocks.length > 0) || ch.title) chapters.push(ch);
    } catch (e) {
      warnings.push(`第 ${i + 1} 段解析失败:${e instanceof Error ? e.message : String(e)}`);
    }
    if (onProgress && (i % 16 === 0 || i === total - 1)) {
      onProgress('split', total > 0 ? (i + 1) / total : 1);
    }
  });
  if (chapters.length === 0) warnings.push('MOBI 中未提取到可导入的正文');

  const sceneCount = chapters.reduce((s, c) => s + c.scenes.length, 0);
  const totalChars = chapters.reduce((s, c) => s + c.scenes.reduce((s2, sc) => s2 + sc.chars, 0), 0);

  // 有些书不用分页符也没有标题标签(整本一大块)。字数很大但只切出
  // 极少章节时,退回纯文本走 TXT 的「第X章 / Chapter N」正则切分。
  if (chapters.length <= 2 && totalChars > 30000) {
    const fallback = parseManuscript(htmlToPlainText(html), { format: 'txt' });
    if (fallback.sceneCount > sceneCount) {
      return {
        ...fallback,
        projectName: title ?? fallback.projectName,
        author: author ?? fallback.author,
        warnings: [...warnings, 'MOBI 内部无章节结构,已按「第X章」等文本标记切分', ...fallback.warnings],
      };
    }
  }

  const volume: ParsedVolume = { title: title ?? '', chapters };
  return {
    projectName: title,
    author,
    volumes: [volume],
    warnings,
    sceneCount,
    totalChars,
  };
}
