import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  assetExt, assetFileName, computeOrphans, deleteAssetThumbs, hashBlob, isAssetStored, listAssetThumbKeys,
  loadAssetThumb, projectBrowserBlobKeysToClear, resetThumbCacheForTest, storeAssetThumb, stripAssetThumbs,
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

describe('R8 资源缩略图:持久化前剔除', () => {
  const THUMB = 'data:image/jpeg;base64,AAAA';
  const base = () => ({
    version: 1,
    name: '测试项目',
    flows: [],
    entities: [],
    documents: [],
    researchCards: [],
    folders: [],
    assets: [
      { id: 'a1', name: '图', kind: 'image', mime: 'image/png', size: 1, tags: [], source: '', notes: '', createdAt: 1, hash: 'h1', thumbnail: THUMB },
      { id: 'a2', name: '文', kind: 'file', mime: 'text/plain', size: 1, tags: [], source: '', notes: '', createdAt: 1, hash: 'h2' },
    ],
  } as unknown as import('./types').Project);

  beforeEach(() => resetThumbCacheForTest());

  it('无缩略图时返回原引用,不产生拷贝', async () => {
    const p = base();
    p.assets[0].thumbnail = undefined;
    expect(stripAssetThumbs(p)).toBe(p);
  });

  it('缩略图尚未存进 IDB 时一律保持内联(剥离不可逆,不能赌)', () => {
    const p = base();
    expect(stripAssetThumbs(p)).toBe(p);
    expect(p.assets[0].thumbnail).toBe(THUMB);
  });

  it('已确认存进 IDB 后才剔除,保留其余字段且不修改原对象', async () => {
    const p = base();
    await storeAssetThumb(null, 'h1', THUMB);
    const out = stripAssetThumbs(p);
    expect(out).not.toBe(p);
    expect(out.assets[0].thumbnail).toBeUndefined();
    expect(out.assets[0].hash).toBe('h1');
    expect(out.assets[0].name).toBe('图');
    expect(out.assets[1]).toEqual(p.assets[1]);
    expect(p.assets[0].thumbnail).toBe(THUMB);
  });

  it('无 hash 的旧资源永不剔除(没有 IDB 键可回填)', async () => {
    const p = base();
    delete (p.assets[0] as { hash?: string }).hash;
    await storeAssetThumb(null, 'h1', THUMB);
    expect(stripAssetThumbs(p)).toBe(p);
    expect(p.assets[0].thumbnail).toBe(THUMB);
  });

  it('缩略图被清理工具删除后不再剔除', async () => {
    const p = base();
    await storeAssetThumb(null, 'h1', THUMB);
    expect(stripAssetThumbs(p).assets[0].thumbnail).toBeUndefined();
    await deleteAssetThumbs(['h1']);
    expect(stripAssetThumbs(p)).toBe(p);
  });
});

describe('R8 资源缩略图:IndexedDB 往返', () => {
  it('网页模式存读往返;文件夹模式跳过', async () => {
    const h1 = 'a1'.padEnd(64, '0');
    const h2 = 'b2'.padEnd(64, '0');
    const dataUrl = 'data:image/jpeg;base64,QUJD';
    await storeAssetThumb(null, h1, dataUrl);
    await storeAssetThumb('/some/folder', h2, dataUrl);
    expect(await loadAssetThumb(h1)).toBe(dataUrl);
    expect(await loadAssetThumb(h2)).toBeNull();
    expect(await loadAssetThumb('c3'.padEnd(64, '0'))).toBeNull();
    expect(await listAssetThumbKeys()).toContain(h1);
    expect(await listAssetThumbKeys()).not.toContain(h2);
  });

  it('清理工具可按哈希删除缩略图', async () => {
    const h = 'd4'.padEnd(64, '0');
    await storeAssetThumb(null, h, 'data:image/jpeg;base64,QUJD');
    expect(await loadAssetThumb(h)).not.toBeNull();
    await deleteAssetThumbs([h]);
    expect(await loadAssetThumb(h)).toBeNull();
    expect(await listAssetThumbKeys()).not.toContain(h);
  });
});
