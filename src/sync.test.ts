import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  clearPendingPush, flushPendingPush, hasPendingPush, loadPendingPush,
  pullProject, pushProject, queuePendingPush, type SyncConfig,
} from './sync';
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

// vitest 是 node 环境,没有 localStorage;按项目约定造最小假件,不引 jsdom。
// 保留 Map 本体,方便断言「localStorage 里到底存了什么」。
const lsStore = new Map<string, string>();

// 复现网页版推送方的真实状态:缩略图已经落进本机 IDB。
// 少了这一步,stripAssetThumbs 会因为「未确认可恢复」而放行,
// 测试就守不住「推送时剥离」这个回归了。
beforeEach(async () => {
  lsStore.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (lsStore.has(k) ? lsStore.get(k)! : null),
    setItem: (k: string, v: string) => { lsStore.set(k, String(v)); },
    removeItem: (k: string) => { lsStore.delete(k); },
    clear: () => { lsStore.clear(); },
  });
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

describe('离线推送队列', () => {
  beforeEach(async () => {
    await clearPendingPush();
    lsStore.clear();
  });

  it('重负载进 IndexedDB,localStorage 只留轻量标记', async () => {
    await queuePendingPush(cfg, projectWithThumb());

    // 关键:项目内容(含缩略图)不得出现在 localStorage 里 —— 那是 5MB 配额
    const allLs = [...lsStore.values()].join('');
    expect(allLs).not.toContain(THUMB);
    expect(allLs).not.toContain('协作测试');
    expect(allLs.length).toBeLessThan(200);

    // 但队列本身完好:同步可查、异步可取回
    expect(hasPendingPush()).not.toBeNull();
    const loaded = await loadPendingPush();
    expect(loaded?.project.assets[0].thumbnail).toBe(THUMB);
    expect(loaded?.cfg.room).toBe(cfg.room);
  });

  it('清空后同步标记与异步负载一起消失', async () => {
    await queuePendingPush(cfg, projectWithThumb());
    await clearPendingPush();
    expect(hasPendingPush()).toBeNull();
    expect(await loadPendingPush()).toBeNull();
  });

  it('升级前存下的旧格式队列不会凭空消失', async () => {
    const legacy = { cfg, project: projectWithThumb(), queuedAt: 1700000000000 };
    localStorage.setItem('theloom-sync-pending-v1', JSON.stringify(legacy));
    expect(hasPendingPush()?.queuedAt).toBe(1700000000000);
    const loaded = await loadPendingPush();
    expect(loaded?.project.assets[0].thumbnail).toBe(THUMB);
  });

  it('补发成功后清空队列', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(JSON.stringify({ version: 7 }), { status: 200 })
        : new Response('{}', { status: 200 })));
    await queuePendingPush(cfg, projectWithThumb());
    const result = await flushPendingPush();
    expect(result.ok).toBe(true);
    expect(result.version).toBe(7);
    expect(hasPendingPush()).toBeNull();
  });

  it('补发遇 409 冲突时保留队列,交给用户处理', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: '云端已有更新版本,请先拉取', version: 9 }), { status: 409 })));
    await queuePendingPush(cfg, projectWithThumb());
    const result = await flushPendingPush();
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(hasPendingPush()).not.toBeNull();
  });

  it('没有队列时补发是无害的空操作', async () => {
    const result = await flushPendingPush();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/没有待推送/);
  });
});
