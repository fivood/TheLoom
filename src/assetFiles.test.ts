import { describe, expect, it } from 'vitest';
import {
  assetExt, assetFileName, computeOrphans, hashBlob, isAssetStored, projectBrowserBlobKeysToClear,
  type StoredAssetFile,
} from './assetFiles';

describe('R8 资源原文件:哈希与命名', () => {
  it('hashBlob 输出稳定的 SHA-256 hex', async () => {
    const h = await hashBlob(new Blob(['abc']));
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await hashBlob(new Blob(['abc']))).toBe(h);
    expect(await hashBlob(new Blob(['abd']))).not.toBe(h);
  });

  it('assetExt 优先取文件名扩展,回落 mime,再回落 bin', () => {
    expect(assetExt('冒雨.PNG', 'image/png')).toBe('png');
    expect(assetExt('主题曲', 'audio/mpeg')).toBe('mp3');
    expect(assetExt('设定稿', 'application/x-unknown')).toBe('bin');
    expect(assetExt('a.tar.gz', '')).toBe('gz');
  });

  it('assetFileName 取 hash 前 16 位;非法 hash 抛错,非法 ext 回 bin', () => {
    const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(assetFileName(hash, 'png')).toBe('asset-ba7816bf8f01cfea.png');
    expect(assetFileName(hash, undefined)).toBe('asset-ba7816bf8f01cfea.bin');
    expect(assetFileName(hash, 'BAD EXT')).toBe('asset-ba7816bf8f01cfea.bin');
    expect(() => assetFileName('short', 'png')).toThrow();
  });
});

describe('R8 资源原文件:存在性与孤儿计算', () => {
  const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

  it('isAssetStored 桌面按文件名、网页按完整哈希', () => {
    const a = { hash, ext: 'png' };
    expect(isAssetStored(a, new Set(['asset-ba7816bf8f01cfea.png']), 'C:/proj')).toBe(true);
    expect(isAssetStored(a, new Set(['asset-ba7816bf8f01cfea.png']), null)).toBe(false);
    expect(isAssetStored(a, new Set([hash]), null)).toBe(true);
    expect(isAssetStored({ hash: undefined }, new Set([hash]), null)).toBe(false);
  });

  it('computeOrphans 只报未被任何引用文本命中的存储键', () => {
    const stored: StoredAssetFile[] = [
      { key: 'asset-ba7816bf8f01cfea.png', size: 10 },
      { key: 'asset-deadbeefdeadbeef.mp3', size: 20 },
      { key: hash },
    ];
    const referenced = [JSON.stringify({ assets: [{ hash }] })];
    const orphans = computeOrphans(stored, referenced);
    expect(orphans.map((f) => f.key)).toEqual(['asset-deadbeefdeadbeef.mp3']);
  });

  it('computeOrphans 引用出现在快照等其他文本里也算被引用', () => {
    const stored: StoredAssetFile[] = [{ key: 'asset-deadbeefdeadbeef.mp3' }];
    expect(computeOrphans(stored, ['{}', `快照:deadbeefdeadbeef1234…`])).toEqual([]);
    expect(computeOrphans(stored, ['{}'])).toHaveLength(1);
  });

  it('项目落盘后只清理未被其他槽位或快照引用的浏览器资源', () => {
    const project = {
      assets: [
        { hash: 'a'.repeat(64) },
        { hash: 'b'.repeat(64) },
        { hash: 'a'.repeat(64) },
      ],
    } as import('./types').Project;
    expect(projectBrowserBlobKeysToClear(project, [`另一个槽位仍引用 ${'b'.repeat(64)}`])).toEqual(['a'.repeat(64)]);
  });
});
