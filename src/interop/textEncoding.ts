/**
 * 文本文件编码嗅探。
 *
 * 编码启发式(BOM → 严格 UTF-8 → CJK 得分)算法移植自 autopage 的
 * `src/lib/functions/file-loaders/txt/extract-txt.ts`
 * (© ッツ Reader Authors, BSD-3-Clause),原实现使用 UTF-8 / GB18030 /
 * Big5 / Shift-JIS 候选,按 CJK 字符密度打分。此文件在此基础上补 GBK
 * 回退(Windows 保存的中文 .md / .txt 常见)。
 */

const CJK = /[一-鿿]/;
const KANA = /[぀-ヿ]/;
const REPLACEMENT = '�';

/** 主入口:BOM → 严格 UTF-8 → 编码候选打分选优 */
export function decodeTextFile(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { /* fall through */ }
  return detectAndDecode(bytes);
}

/**
 * 已经拿到字符串但发现 U+FFFD 替换符很多时,尝试用 GBK 重新解码。
 * autopage 的 MD loader 用这招兜住 Windows 保存的中文 markdown。
 */
export function decodeWithFallback(file: File, utf8Text: string): Promise<string> {
  const replacements = (utf8Text.match(new RegExp(REPLACEMENT, 'g')) ?? []).length;
  if (replacements < 5) return Promise.resolve(utf8Text);
  return file.arrayBuffer().then((buf) => {
    try { return new TextDecoder('gbk').decode(buf); }
    catch { return utf8Text; }
  });
}

function detectAndDecode(bytes: Uint8Array): string {
  const sample = bytes.length > 65536 ? bytes.subarray(0, 65536) : bytes;
  const candidates: Array<'shift-jis' | 'gb18030' | 'big5'> = ['shift-jis', 'gb18030', 'big5'];
  let best: (typeof candidates)[number] = 'gb18030';
  let bestScore = -Infinity;
  for (const enc of candidates) {
    let decoded: string;
    try { decoded = new TextDecoder(enc).decode(sample); }
    catch { continue; }
    const score = scoreText(decoded);
    if (score > bestScore) { bestScore = score; best = enc; }
  }
  return new TextDecoder(best).decode(bytes);
}

function scoreText(text: string): number {
  let han = 0, kana = 0, replacement = 0, printable = 0;
  const cap = Math.min(text.length, 20000);
  for (let i = 0; i < cap; i++) {
    const ch = text[i];
    if (ch === REPLACEMENT) replacement++;
    else if (CJK.test(ch)) han++;
    else if (KANA.test(ch)) kana++;
    if (ch >= ' ' || ch === '\n' || ch === '\r' || ch === '\t') printable++;
  }
  // 假名密度高 → 日文;否则汉字密度决定简/繁;替换符是严重扣分
  const kanaBoost = kana > 20 ? 500 : 0;
  return printable - replacement * 20 + han * 3 + kanaBoost;
}
