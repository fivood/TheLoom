/**
 * 极简 XML / XHTML 扫描器,专供 EPUB 导入使用。
 *
 * 不追求完整 DOM,只提供 EPUB 需要的能力:
 *   - 找到指定标签(可带命名空间前缀,如 opf:manifest / manifest 都能命中)
 *   - 读属性
 *   - 抽取块级文本(段落 / 标题 / 引用 / 列表项)
 *
 * 支持 HTML 实体(&amp; &lt; &gt; &quot; &apos; &nbsp;)、数字实体
 * (&#N; / &#xN;)、CDATA、注释、自闭标签、命名空间前缀、大小写宽松。
 * 不支持外部 DTD / DOCTYPE(直接跳过)。
 */

/** 去掉命名空间前缀,大小写不敏感比对 */
export function localName(tag: string): string {
  const idx = tag.indexOf(':');
  return (idx >= 0 ? tag.slice(idx + 1) : tag).toLowerCase();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”',
};

/** 解码 HTML 实体(命名 + 十进制 + 十六进制) */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (raw, ref: string) => {
    if (ref[0] === '#') {
      const num = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : raw;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? raw;
  });
}

export type XmlEvent =
  | { type: 'open'; tag: string; local: string; attrs: Record<string, string>; selfClose: boolean }
  | { type: 'close'; tag: string; local: string }
  | { type: 'text'; text: string };

/** 按 SAX 风格扫描 XML/XHTML 源码 */
export function* scanXml(source: string): Generator<XmlEvent> {
  let i = 0;
  const n = source.length;
  while (i < n) {
    if (source[i] !== '<') {
      const end = source.indexOf('<', i);
      const chunk = end < 0 ? source.slice(i) : source.slice(i, end);
      if (chunk) yield { type: 'text', text: decodeEntities(chunk) };
      i = end < 0 ? n : end;
      continue;
    }
    // 注释
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    // CDATA
    if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i + 9);
      const chunk = source.slice(i + 9, end < 0 ? n : end);
      if (chunk) yield { type: 'text', text: chunk };
      i = end < 0 ? n : end + 3;
      continue;
    }
    // DOCTYPE / 声明 / 处理指令
    if (source[i + 1] === '!' || source[i + 1] === '?') {
      const end = source.indexOf('>', i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    // 闭合标签
    if (source[i + 1] === '/') {
      const end = source.indexOf('>', i + 2);
      if (end < 0) { i = n; continue; }
      const tag = source.slice(i + 2, end).trim();
      yield { type: 'close', tag, local: localName(tag) };
      i = end + 1;
      continue;
    }
    // 打开标签
    const end = source.indexOf('>', i);
    if (end < 0) { i = n; continue; }
    let body = source.slice(i + 1, end);
    let selfClose = false;
    if (body.endsWith('/')) { selfClose = true; body = body.slice(0, -1); }
    const spaceIdx = firstSpace(body);
    const tag = (spaceIdx < 0 ? body : body.slice(0, spaceIdx)).trim();
    const attrs = spaceIdx < 0 ? {} : parseAttrs(body.slice(spaceIdx + 1));
    yield { type: 'open', tag, local: localName(tag), attrs, selfClose };
    i = end + 1;
  }
}

function firstSpace(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) return i;
  }
  return -1;
}

function parseAttrs(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'|([\w:-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const name = m[1] ?? m[3] ?? m[5];
    const value = m[2] ?? m[4] ?? '';
    out[name] = decodeEntities(value);
  }
  return out;
}

/** 找到第一个 local name 匹配的 open 事件,返回其 attrs;找不到返回 null */
export function findElement(source: string, local: string): Record<string, string> | null {
  const target = local.toLowerCase();
  for (const ev of scanXml(source)) {
    if (ev.type === 'open' && ev.local === target) return ev.attrs;
  }
  return null;
}

/** 找到所有 local name 匹配的 open 事件的 attrs */
export function findAllElements(source: string, local: string): Record<string, string>[] {
  const target = local.toLowerCase();
  const out: Record<string, string>[] = [];
  for (const ev of scanXml(source)) {
    if (ev.type === 'open' && ev.local === target) out.push(ev.attrs);
  }
  return out;
}

/** 找到第一个匹配 open 事件对应的元素内的原始文本(合并空白) */
export function elementText(source: string, local: string): string | undefined {
  const target = local.toLowerCase();
  let depth = -1;
  let buf = '';
  for (const ev of scanXml(source)) {
    if (depth < 0) {
      if (ev.type === 'open' && ev.local === target) {
        if (ev.selfClose) return '';
        depth = 1;
      }
      continue;
    }
    if (ev.type === 'text') buf += ev.text;
    else if (ev.type === 'open' && !ev.selfClose) depth++;
    else if (ev.type === 'close') { depth--; if (depth === 0) return buf.replace(/\s+/g, ' ').trim(); }
  }
  return undefined;
}
