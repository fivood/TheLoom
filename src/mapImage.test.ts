import { describe, expect, it } from 'vitest';
import { dataUrlBytes, dataUrlMime, hasBaseImage, needsImageMigration, MIGRATE_MIN_BYTES } from './mapImage';
import { normalizeProject } from './util';
import type { MapDoc, Project } from './types';

const bigPng = (bytes: number) =>
  `data:image/png;base64,${'A'.repeat(Math.ceil(bytes * 4 / 3))}`;

describe('地图底图的存放方式', () => {
  it('估算 dataURL 字节数:base64 与明文两种编码', () => {
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/svg+xml;utf8,<svg/>')).toBe(6);
    expect(dataUrlBytes('不是 dataURL')).toBe(0);
  });

  it('从 dataURL 取 mime', () => {
    expect(dataUrlMime('data:image/png;base64,AA')).toBe('image/png');
    expect(dataUrlMime('data:image/svg+xml;utf8,<svg/>')).toBe('image/svg+xml');
    expect(dataUrlMime('nope')).toBe('');
  });

  it('大图才搬进资源库;小图搬了也省不下什么', () => {
    expect(needsImageMigration({ image: bigPng(MIGRATE_MIN_BYTES + 1024) })).toBe(true);
    expect(needsImageMigration({ image: bigPng(1024) })).toBe(false);
  });

  it('已经在资源库里的不再搬,没有底图的也不搬', () => {
    expect(needsImageMigration({ image: bigPng(200_000), imageHash: 'a'.repeat(64) })).toBe(false);
    expect(needsImageMigration({})).toBe(false);
  });

  it('两种存法都算「有底图」', () => {
    expect(hasBaseImage({ imageHash: 'a'.repeat(64) })).toBe(true);
    expect(hasBaseImage({ image: 'data:image/png;base64,AA' })).toBe(true);
    expect(hasBaseImage({})).toBe(false);
  });
});

describe('规范化:底图字段', () => {
  const projectWith = (map: Partial<MapDoc>): Project => normalizeProject({
    version: 1,
    maps: [{ id: 'm1', name: '图', markers: [], regions: [], ...map }],
  } as unknown as Project);

  it('剔除非法哈希与扩展名', () => {
    const m = projectWith({ imageHash: '短', imageExt: '../etc' }).maps[0];
    expect(m.imageHash).toBeUndefined();
    expect(m.imageExt).toBeUndefined();
  });

  it('合法值保留', () => {
    const m = projectWith({ imageHash: 'b'.repeat(64), imageExt: 'png' }).maps[0];
    expect(m.imageHash).toBe('b'.repeat(64));
    expect(m.imageExt).toBe('png');
  });

  it('绝不动内联 image —— 搬进资源库之前它是唯一的底图', () => {
    const inline = 'data:image/png;base64,AAAA';
    expect(projectWith({ image: inline }).maps[0].image).toBe(inline);
    // 哈希非法被剔除时,内联那份也必须留着
    expect(projectWith({ image: inline, imageHash: '坏' }).maps[0].image).toBe(inline);
  });
});
