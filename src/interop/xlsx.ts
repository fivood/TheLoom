/**
 * 最小 xlsx 读写(基于本项目的 zip.ts,零第三方依赖)。
 *
 * 只覆盖 TheLoom 需要的部分:
 *   写:多 sheet 工作簿,每 sheet 就是一张二维表(表头 + 数据行)
 *   读:遍历所有 sheet,把每行拆成字符串数组
 *
 * 不实现的部分:样式、公式、合并单元格、数字格式(所有单元格都按 inlineStr 写入,读时也按字符串还原)。
 * 对我们"稳定 ID + 字符串字段"的用法足够。
 */
import { makeZip, readZip, readEntryText } from './zip';

export interface Sheet {
  name: string;
  rows: (string | number | boolean | null | undefined)[][];
}

export interface ParsedSheet {
  name: string;
  /** 每行都是字符串(空单元格 = 空字符串);行长度 = 该 sheet 的最大列宽 */
  rows: string[][];
}

/* ---------- 通用 ---------- */

const XML_ESCAPE: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
};
function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPE[c]);
}
/** OOXML sharedStrings/inlineStr 不允许 U+0000..U+0008、U+000B..U+000C、U+000E..U+001F */
function stripControl(s: string): string {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** 列号 → Excel 列名:0→A,25→Z,26→AA */
export function columnName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "AA" → 26 */
function columnIndex(name: string): number {
  let n = 0;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/* ---------- 写 ---------- */

function sheetXml(sheet: Sheet): string {
  const rows: string[] = [];
  sheet.rows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((val, c) => {
      if (val === null || val === undefined || val === '') return;
      const ref = `${columnName(c)}${r + 1}`;
      if (typeof val === 'number' && Number.isFinite(val)) {
        cells.push(`<c r="${ref}"><v>${val}</v></c>`);
      } else if (typeof val === 'boolean') {
        cells.push(`<c r="${ref}" t="b"><v>${val ? 1 : 0}</v></c>`);
      } else {
        const text = stripControl(String(val));
        cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`);
      }
    });
    if (cells.length) rows.push(`<row r="${r + 1}">${cells.join('')}</row>`);
    else rows.push(`<row r="${r + 1}"/>`);
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`;
}

/** sheet 名清理:去掉 Excel 禁用字符,截到 31 字符,去重 */
function sanitizeSheetName(name: string, used: Set<string>): string {
  let n = name.replace(/[\\/*?:\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  if (!n) n = '表';
  let base = n;
  let i = 2;
  while (used.has(n.toLowerCase())) {
    const suffix = ` (${i++})`;
    n = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(n.toLowerCase());
  return n;
}

export async function writeXlsx(sheets: Sheet[]): Promise<Blob> {
  if (sheets.length === 0) sheets = [{ name: '空表', rows: [] }];
  const used = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: sanitizeSheetName(s.name, used) }));

  const files: { name: string; content: string }[] = [];

  files.push({
    name: '[Content_Types].xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${named.map((_, i) => `  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,
  });

  files.push({
    name: '_rels/.rels',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  });

  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${named.map((_, i) => `  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
</Relationships>`,
  });

  files.push({
    name: 'xl/workbook.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${named.map((s, i) => `    <sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n')}
  </sheets>
</workbook>`,
  });

  named.forEach((s, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s) });
  });

  return makeZip(files);
}

/* ---------- 读 ---------- */

/** OOXML 里 sheet 顺序由 workbook.xml 决定,rId → Target 由 xl/_rels/workbook.xml.rels 给出 */
export async function readXlsx(buf: ArrayBuffer | Uint8Array): Promise<ParsedSheet[]> {
  const entries = await readZip(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const wbEntry = byName.get('xl/workbook.xml');
  const relsEntry = byName.get('xl/_rels/workbook.xml.rels');
  if (!wbEntry || !relsEntry) throw new Error('xlsx:缺少 workbook.xml 或其关系文件');

  const wbXml = readEntryText(wbEntry);
  const relsXml = readEntryText(relsEntry);

  const relMap = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\s[^>]*\/>/g)) {
    const attrs = parseAttrs(m[0]);
    if (attrs.Id && attrs.Target) relMap.set(attrs.Id, attrs.Target);
  }

  // shared strings(选填)
  const sst: string[] = [];
  const sstEntry = byName.get('xl/sharedStrings.xml');
  if (sstEntry) {
    const sstXml = readEntryText(sstEntry);
    for (const m of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      sst.push(extractSiText(m[1]));
    }
  }

  const parsedSheets: ParsedSheet[] = [];
  for (const m of wbXml.matchAll(/<sheet\s[^>]*\/>/g)) {
    const attrs = parseAttrs(m[0]);
    const name = decodeXml(attrs.name ?? '');
    const rid = attrs['r:id'] ?? attrs.rId ?? '';
    const target = relMap.get(rid);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const sheetEntry = byName.get(path) ?? byName.get(path.replace(/^xl\//, ''));
    if (!sheetEntry) continue;
    parsedSheets.push({ name, rows: parseSheet(readEntryText(sheetEntry), sst) });
  }
  return parsedSheets;
}

function parseAttrs(chunk: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of chunk.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

const XML_UNESCAPE: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};
function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (_, ent: string) => {
    if (ent[0] === '#') {
      const n = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    }
    return XML_UNESCAPE[ent.toLowerCase()] ?? '';
  });
}

/** 从 <si> 内部提取所有 <t> 的拼接文本(支持 <r><t>...</t></r> 富文本片段) */
function extractSiText(inner: string): string {
  let out = '';
  for (const m of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
  return out;
}

function parseSheet(xml: string, sst: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowM of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowAttrs = parseAttrs(rowM[1]);
    const rowNum = parseInt(rowAttrs.r ?? '0', 10);
    while (rows.length < rowNum) rows.push([]);
    const cells: string[] = rows[rowNum - 1];
    for (const cellM of rowM[2].matchAll(/<c\b([^/>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = parseAttrs(cellM[1]);
      const ref = attrs.r ?? '';
      const colIdx = columnIndex(ref.replace(/\d+$/, ''));
      const type = attrs.t ?? 'n';
      const body = cellM[2] ?? '';
      let value = '';
      if (type === 'inlineStr') {
        value = extractSiText(body);
      } else if (type === 's') {
        const sm = body.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        const idx = sm ? parseInt(decodeXml(sm[1]), 10) : NaN;
        value = Number.isFinite(idx) && idx >= 0 && idx < sst.length ? sst[idx] : '';
      } else if (type === 'str' || type === 'b') {
        const sm = body.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        value = sm ? decodeXml(sm[1]) : '';
        if (type === 'b') value = value === '1' ? 'true' : 'false';
      } else {
        const sm = body.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        value = sm ? decodeXml(sm[1]) : '';
      }
      while (cells.length < colIdx) cells.push('');
      cells[colIdx] = value;
    }
  }
  // 规整:每行补齐到最大列宽
  const maxW = rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (const r of rows) while (r.length < maxW) r.push('');
  return rows;
}
