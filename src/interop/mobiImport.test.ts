import { describe, expect, it } from 'vitest';
import { parseMobi } from './mobiImport';

/* ---------- 合成 MOBI 构造器 ---------- */

const enc = new TextEncoder();

function u16(v: number): number[] { return [(v >> 8) & 0xff, v & 0xff]; }
function u32(v: number): number[] { return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]; }

/** rec0:PalmDoc 头 + MOBI 头(+ 可选 EXTH) */
function buildRec0(opts: {
  compression: number;
  textRecordCount: number;
  encoding?: number;
  exth?: { title?: string; author?: string };
}): Uint8Array {
  const encoding = opts.encoding ?? 65001;
  const exthRecords: number[] = [];
  if (opts.exth) {
    const items: number[][] = [];
    if (opts.exth.title) {
      const v = [...enc.encode(opts.exth.title)];
      items.push([...u32(503), ...u32(8 + v.length), ...v]);
    }
    if (opts.exth.author) {
      const v = [...enc.encode(opts.exth.author)];
      items.push([...u32(100), ...u32(8 + v.length), ...v]);
    }
    const body = items.flat();
    exthRecords.push(...[...'EXTH'].map((c) => c.charCodeAt(0)), ...u32(12 + body.length), ...u32(items.length), ...body);
  }
  const mobiLen = 0x100; // MOBI 头长度(填满到 16 + 0x100 处开始 EXTH)
  const rec = new Uint8Array(16 + mobiLen + exthRecords.length);
  rec.set(u16(opts.compression), 0);
  rec.set(u16(opts.textRecordCount), 8);
  rec.set([...'MOBI'].map((c) => c.charCodeAt(0)), 16);
  rec.set(u32(mobiLen), 20);
  rec.set(u32(encoding), 0x1c);
  if (opts.exth) rec.set(u32(0x40), 0x80); // EXTH flag
  // extra_record_data_flags @0xF2 = 0(测试记录无 trailer)
  rec.set(exthRecords, 16 + mobiLen);
  return rec;
}

/** 组装 PalmDB 容器 */
function buildMobi(records: Uint8Array[]): ArrayBuffer {
  const headerSize = 78 + records.length * 8;
  let offset = headerSize;
  const offsets = records.map((r) => { const o = offset; offset += r.length; return o; });
  const out = new Uint8Array(offset);
  out.set(enc.encode('测试书'.slice(0, 10)), 0);
  out.set([...'BOOKMOBI'].map((c) => c.charCodeAt(0)), 60);
  out.set(u16(records.length), 76);
  records.forEach((_, i) => out.set(u32(offsets[i]), 78 + i * 8));
  records.forEach((r, i) => out.set(r, offsets[i]));
  return out.buffer as ArrayBuffer;
}

const SAMPLE_HTML =
  '<html><body>' +
  '<h1>第一章 雨夜</h1><p>灯塔的光在雾里转了三圈。</p><p>船没有灯。</p>' +
  '<mbp:pagebreak/>' +
  '<h1>第二章 出海</h1><p>浪把名字拍碎在礁石上。</p>' +
  '</body></html>';

describe('parseMobi(合成 MOBI6)', () => {
  it('无压缩 + UTF-8:按分页符切两章,段落成场景块', () => {
    const text = enc.encode(SAMPLE_HTML);
    const ms = parseMobi(buildMobi([buildRec0({ compression: 1, textRecordCount: 1 }), text]));
    expect(ms.volumes[0].chapters).toHaveLength(2);
    expect(ms.volumes[0].chapters[0].title).toBe('第一章 雨夜');
    expect(ms.volumes[0].chapters[1].title).toBe('第二章 出海');
    const blocks0 = ms.volumes[0].chapters[0].scenes.flatMap((s) => s.blocks);
    expect(blocks0.map((b) => b.text)).toEqual(['灯塔的光在雾里转了三圈。', '船没有灯。']);
    expect(ms.totalChars).toBeGreaterThan(0);
  });

  it('多文本记录拼接', () => {
    const text = enc.encode(SAMPLE_HTML);
    const half = Math.floor(text.length / 2);
    const ms = parseMobi(buildMobi([
      buildRec0({ compression: 1, textRecordCount: 2 }),
      text.subarray(0, half),
      text.subarray(half),
    ]));
    expect(ms.volumes[0].chapters).toHaveLength(2);
  });

  it('PalmDoc 压缩:字面直通字节可解压', () => {
    // 0x09-0x7f 是直通字节,纯 ASCII HTML 的"压缩"数据就是原文
    const ascii = '<html><body><h1>Ch 1</h1><p>hello world</p></body></html>';
    const ms = parseMobi(buildMobi([
      buildRec0({ compression: 2, textRecordCount: 1 }),
      enc.encode(ascii),
    ]));
    expect(ms.volumes[0].chapters[0].title).toBe('Ch 1');
    expect(ms.volumes[0].chapters[0].scenes[0].blocks[0].text).toBe('hello world');
  });

  it('EXTH 书名与作者进入 projectName / author', () => {
    const text = enc.encode(SAMPLE_HTML);
    const ms = parseMobi(buildMobi([
      buildRec0({ compression: 1, textRecordCount: 1, exth: { title: '雾岬灯塔', author: '五木' } }),
      text,
    ]));
    expect(ms.projectName).toBe('雾岬灯塔');
    expect(ms.author).toBe('五木');
  });

  it('非 MOBI 文件给出明确错误', () => {
    const junk = new Uint8Array(200);
    junk.set(enc.encode('PK\x03\x04'), 0);
    expect(() => parseMobi(junk.buffer as ArrayBuffer)).toThrow(/不是 MOBI/);
  });

  it('无结构大部头退回「第X章」文本切分', () => {
    const para = '雨还在下。灯塔的光在雾里转了三圈,船没有灯,浪把名字拍碎在礁石上。'.repeat(220);
    let body = '';
    for (let i = 1; i <= 5; i++) body += `<p>第${['一', '二', '三', '四', '五'][i - 1]}章 风暴</p><p>${para}</p>`;
    const html = `<html><body>${body}</body></html>`;
    const ms = parseMobi(buildMobi([buildRec0({ compression: 1, textRecordCount: 1 }), enc.encode(html)]));
    expect(ms.warnings.some((w) => w.includes('文本标记切分'))).toBe(true);
    const chapters = ms.volumes.flatMap((v) => v.chapters);
    expect(chapters.length).toBeGreaterThanOrEqual(5);
  });

  it('合订本(BOUNDARY)取 MOBI6 段', () => {
    const text = enc.encode(SAMPLE_HTML);
    const boundary = enc.encode('BOUNDARY');
    const kf8Junk = new Uint8Array(64); // BOUNDARY 之后的 KF8 段(不参与解析)
    const ms = parseMobi(buildMobi([
      buildRec0({ compression: 1, textRecordCount: 1 }),
      text,
      boundary,
      kf8Junk,
    ]));
    expect(ms.volumes[0].chapters).toHaveLength(2);
  });
});
