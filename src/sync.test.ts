import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { pullProject, pushProject, type SyncConfig } from './sync';
import { resetThumbCacheForTest, storeAssetThumb } from './assetFiles';
import type { Project } from './types';

/**
 * 协作密文往返。
 *
 * 重点守一条:资源缩略图必须随密文一起走。接力的对端没有本机 IDB 缩略图库,
 * 桌面端连回填路径都没有(hydrateAssetThumbs 在 Tauri 下直接 return),
 * 推送时剥掉就是对端永久丢失 —— 曾经为了「减小密文」这么干过一次。
 */

const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';

function projectWithThumb(): Project {
  return {
    version: 1,
    name: '协作测试',
    flows: [],
    entities: [],
    documents: [],
    researchCards: [],
    folders: [],
    assets: [
      {
        id: 'a1', name: '封面', kind: 'image', mime: 'image/png', size: 1,
        tags: [], source: '', notes: '', createdAt: 1,
        hash: HASH, ext: 'png', thumbnail: THUMB,
      },
    ],
  } as unknown as Project;
}

const HASH = 'f0'.padEnd(64, '0');
const cfg: SyncConfig = { server: 'https://example.test', room: 'room-1', pass: 'passphrase', lastVersion: 0, lastSyncAt: 0 };

afterEach(() => vi.unstubAllGlobals());

// 复现网页版推送方的真实状态:缩略图已经落进本机 IDB。
// 少了这一步,stripAssetThumbs 会因为「未确认可恢复」而放行,
// 测试就守不住「推送时剥离」这个回归了。
beforeEach(async () => {
  resetThumbCacheForTest();
  await storeAssetThumb(null, HASH, THUMB);
});

describe('协作密文往返', () => {
  it('缩略图随密文一起送达对端(不得为了减小密文剥掉)', async () => {
    let captured = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        captured = (JSON.parse(String(init.body)) as { payload: string }).payload;
        return new Response(JSON.stringify({ version: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ version: 1, payload: captured }), { status: 200 });
    }));

    const version = await pushProject(cfg, projectWithThumb());
    expect(version).toBe(1);
    expect(captured.length).toBeGreaterThan(0);

    const pulled = await pullProject({ ...cfg, lastVersion: 1 });
    expect(pulled.version).toBe(1);
    expect(pulled.project.assets).toHaveLength(1);
    expect(pulled.project.assets[0].thumbnail).toBe(THUMB);
    expect(pulled.project.assets[0].hash).toBe(HASH);
  });

  it('口令不匹配时报解密失败,不返回半个项目', async () => {
    let captured = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        captured = (JSON.parse(String(init.body)) as { payload: string }).payload;
        return new Response(JSON.stringify({ version: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ version: 1, payload: captured }), { status: 200 });
    }));

    await pushProject(cfg, projectWithThumb());
    await expect(pullProject({ ...cfg, pass: '另一个口令' })).rejects.toThrow(/解密失败/);
  });
});
