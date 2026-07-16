/**
 * 零依赖的最小 zip 读写(仅够 xlsx 用)。
 * 用浏览器原生 CompressionStream('deflate-raw') 做压缩,自己拼 local file header + central directory + EOCD。
 * 支持 UTF-8 文件名(bit 11)与存储 / DEFLATE 两种压缩方式。
 * 不支持 zip64、加密、archive comment。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface ZipInputFile { name: string; content: string | Uint8Array }
export interface ZipEntry { name: string; content: Uint8Array }

/** 创建 zip Blob;文本自动 UTF-8 编码;大于 32 字节且能压缩的走 DEFLATE,否则原样存储 */
export async function makeZip(files: ZipInputFile[]): Promise<Blob> {
  const enc = new TextEncoder();
  const prepared: {
    nameBytes: Uint8Array;
    data: Uint8Array;
    compressed: Uint8Array;
    method: number;
    crc: number;
  }[] = [];

  for (const f of files) {
    const data = typeof f.content === 'string' ? enc.encode(f.content) : f.content;
    const nameBytes = enc.encode(f.name);
    const crc = crc32(data);
    let compressed = data;
    let method = 0;
    if (data.length > 32) {
      try {
        const c = await deflateRaw(data);
        if (c.length < data.length) { compressed = c; method = 8; }
      } catch { /* 压缩失败就存储 */ }
    }
    prepared.push({ nameBytes, data, compressed, method, crc });
  }

  const parts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const p of prepared) {
    const localHeader = new Uint8Array(30 + p.nameBytes.length);
    const dv = new DataView(localHeader.buffer);
    dv.setUint32(0, 0x04034b50, true);          // signature
    dv.setUint16(4, 20, true);                   // version needed
    dv.setUint16(6, 0x0800, true);               // general purpose (bit 11 = UTF-8)
    dv.setUint16(8, p.method, true);             // compression method
    dv.setUint16(10, 0, true);                   // mod time
    dv.setUint16(12, 0, true);                   // mod date
    dv.setUint32(14, p.crc, true);
    dv.setUint32(18, p.compressed.length, true); // compressed size
    dv.setUint32(22, p.data.length, true);       // uncompressed size
    dv.setUint16(26, p.nameBytes.length, true);  // file name length
    dv.setUint16(28, 0, true);                   // extra length
    localHeader.set(p.nameBytes, 30);
    parts.push(localHeader);
    parts.push(p.compressed);

    const central = new Uint8Array(46 + p.nameBytes.length);
    const dvc = new DataView(central.buffer);
    dvc.setUint32(0, 0x02014b50, true);
    dvc.setUint16(4, 20, true);                    // version made by
    dvc.setUint16(6, 20, true);                    // version needed
    dvc.setUint16(8, 0x0800, true);                // general purpose
    dvc.setUint16(10, p.method, true);
    dvc.setUint16(12, 0, true); dvc.setUint16(14, 0, true);
    dvc.setUint32(16, p.crc, true);
    dvc.setUint32(20, p.compressed.length, true);
    dvc.setUint32(24, p.data.length, true);
    dvc.setUint16(28, p.nameBytes.length, true);
    dvc.setUint16(30, 0, true);                    // extra length
    dvc.setUint16(32, 0, true);                    // comment length
    dvc.setUint16(34, 0, true);                    // disk number
    dvc.setUint16(36, 0, true);                    // internal attrs
    dvc.setUint32(38, 0, true);                    // external attrs
    dvc.setUint32(42, offset, true);               // local header offset
    central.set(p.nameBytes, 46);
    centralParts.push(central);

    offset += localHeader.length + p.compressed.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of centralParts) { parts.push(c); centralSize += c.length; }

  const eocd = new Uint8Array(22);
  const dve = new DataView(eocd.buffer);
  dve.setUint32(0, 0x06054b50, true);
  dve.setUint16(4, 0, true);
  dve.setUint16(6, 0, true);
  dve.setUint16(8, prepared.length, true);
  dve.setUint16(10, prepared.length, true);
  dve.setUint32(12, centralSize, true);
  dve.setUint32(16, centralStart, true);
  dve.setUint16(20, 0, true);
  parts.push(eocd);

  return new Blob(parts as BlobPart[], { type: 'application/zip' });
}

/** 解析 zip:从 EOCD 反向定位中心目录,再对每个 entry 抽取字节并按需 inflate */
export async function readZip(input: ArrayBuffer | Uint8Array): Promise<ZipEntry[]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder('utf-8');

  // 找 EOCD 签名(0x06054b50),从末尾往前 22..(22+65535)
  let eocdOffset = -1;
  const maxSearch = Math.min(bytes.length - 22, 65557);
  for (let i = 0; i <= maxSearch; i++) {
    const off = bytes.length - 22 - i;
    if (dv.getUint32(off, true) === 0x06054b50) { eocdOffset = off; break; }
  }
  if (eocdOffset < 0) throw new Error('zip:未找到 EOCD 签名');

  const totalEntries = dv.getUint16(eocdOffset + 10, true);
  const centralSize = dv.getUint32(eocdOffset + 12, true);
  const centralOffset = dv.getUint32(eocdOffset + 16, true);

  const out: ZipEntry[] = [];
  let cur = centralOffset;
  const centralEnd = centralOffset + centralSize;
  for (let n = 0; n < totalEntries && cur < centralEnd; n++) {
    if (dv.getUint32(cur, true) !== 0x02014b50) throw new Error(`zip:中心目录 #${n} 签名不对`);
    const method = dv.getUint16(cur + 10, true);
    const compSize = dv.getUint32(cur + 20, true);
    const uncompSize = dv.getUint32(cur + 24, true);
    const nameLen = dv.getUint16(cur + 28, true);
    const extraLen = dv.getUint16(cur + 30, true);
    const commentLen = dv.getUint16(cur + 32, true);
    const localOffset = dv.getUint32(cur + 42, true);
    const name = dec.decode(bytes.subarray(cur + 46, cur + 46 + nameLen));
    cur += 46 + nameLen + extraLen + commentLen;

    if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`zip:local header 签名不对 (${name})`);
    const lnLen = dv.getUint16(localOffset + 26, true);
    const leLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lnLen + leLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    let content: Uint8Array;
    if (method === 0) content = raw;
    else if (method === 8) content = await inflateRaw(raw);
    else throw new Error(`zip:不支持的压缩方式 ${method} (${name})`);
    if (content.length !== uncompSize) throw new Error(`zip:解压后大小不符 (${name})`);
    out.push({ name, content });
  }
  return out;
}

/** ZipEntry.content → utf-8 文本 */
export function readEntryText(entry: ZipEntry): string {
  return new TextDecoder('utf-8').decode(entry.content);
}
