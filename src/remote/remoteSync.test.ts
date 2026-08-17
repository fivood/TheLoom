import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleProject } from '../sample';
import { decryptBytes, deriveAesKey, encryptBytes } from '../crypto';
import {
  RemoteConflict, loadRemoteConfig, pullFromRemote, pushToRemote, remoteConfigured,
  remoteStatus, saveRemoteConfig, type RemoteConfig,
} from './remoteSync';

const CFG: RemoteConfig = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  region: 'auto', bucket: 'b', accessKeyId: 'AK', secretAccessKey: 'SK',
  prefix: 'theloom/', pass: '口令口令', lastEtag: '', lastSyncAt: 0,
};

/** 内存里的假桶:记录写入的字节,GET/HEAD 照着回 */
function fakeBucket() {
  const store = new Map<string, Uint8Array>();
  let etag = 'e1';
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const key = new URL(url).pathname;
    const method = (init.method ?? 'GET').toUpperCase();
    if (method === 'PUT') {
      store.set(key, new Uint8Array(init.body as ArrayBuffer));
      etag = `e${store.size + 1}`;
      return { ok: true, status: 200, headers: new Headers({ ETag: etag }), text: async () => '' } as Response;
    }
    const bytes = store.get(key);
    if (!bytes) return { ok: false, status: 404, headers: new Headers(), text: async () => '' } as Response;
    return {
      ok: true, status: 200,
      headers: new Headers({ ETag: etag, 'Content-Length': String(bytes.length), 'Last-Modified': new Date().toUTCString() }),
      arrayBuffer: async () => bytes.buffer,
      text: async () => '',
    } as Response;
  });
  return { setEtag: (v: string) => { etag = v; } };
}

/** vitest 跑在 node 环境,没有 localStorage;补个内存实现 */
function memoryStorage() {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('外链网盘同步', () => {
  it('推送再拉取:项目内容往返一致', async () => {
    fakeBucket();
    const project = sampleProject();
    await pushToRemote(CFG, project);
    const got = await pullFromRemote(CFG);
    expect(got).not.toBeNull();
    expect(got!.project.name).toBe(project.name);
    expect(got!.project.documents.length).toBe(project.documents.length);
    expect(got!.project.entities.length).toBe(project.entities.length);
  });

  it('桶里存的是密文:明文标题不出现在字节里', async () => {
    const seen: Uint8Array[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      if ((init.method ?? '').toUpperCase() === 'PUT') seen.push(new Uint8Array(init.body as ArrayBuffer));
      return { ok: true, status: 200, headers: new Headers({ ETag: 'e' }), text: async () => '' } as Response;
    });
    const project = sampleProject();
    await pushToRemote(CFG, project);
    const blob = new TextDecoder('utf-8', { fatal: false }).decode(seen[0]);
    expect(blob).not.toContain(project.name);
    expect(blob).not.toContain('塞梅尔维斯');
  });

  it('口令不对解不开', async () => {
    fakeBucket();
    await pushToRemote(CFG, sampleProject());
    await expect(pullFromRemote({ ...CFG, pass: '另一个口令' })).rejects.toThrow();
  });

  it('远端被别人写过时抛冲突,不覆盖', async () => {
    const bucket = fakeBucket();
    await pushToRemote(CFG, sampleProject());
    const withBaseline: RemoteConfig = { ...CFG, lastEtag: 'e2' };
    bucket.setEtag('written-by-other');
    await expect(pushToRemote(withBaseline, sampleProject())).rejects.toBeInstanceOf(RemoteConflict);
  });

  it('force 推送跳过冲突检查', async () => {
    const bucket = fakeBucket();
    await pushToRemote(CFG, sampleProject());
    bucket.setEtag('written-by-other');
    await expect(pushToRemote({ ...CFG, lastEtag: 'e2' }, sampleProject(), true)).resolves.toBeTruthy();
  });

  it('首次使用:远端还没有对象时拉取返回 null 而不是报错', async () => {
    fakeBucket();
    expect(await pullFromRemote(CFG)).toBeNull();
    expect(await remoteStatus(CFG)).toMatchObject({ exists: false, changed: false });
  });

  it('remoteStatus 能报出远端有更新', async () => {
    const bucket = fakeBucket();
    await pushToRemote(CFG, sampleProject());
    expect(await remoteStatus({ ...CFG, lastEtag: 'e2' })).toMatchObject({ exists: true, changed: false });
    bucket.setEtag('e-new');
    expect(await remoteStatus({ ...CFG, lastEtag: 'e2' })).toMatchObject({ changed: true });
  });

  it('配置往返;缺任一必填项都算未配置', () => {
    memoryStorage();
    saveRemoteConfig(CFG);
    expect(loadRemoteConfig().bucket).toBe('b');
    expect(remoteConfigured(CFG)).toBe(true);
    expect(remoteConfigured({ ...CFG, pass: '' })).toBe(false);
    expect(remoteConfigured({ ...CFG, endpoint: '' })).toBe(false);
  });

  it('同一口令在不同桶派生出不同密钥 —— 密文不能跨桶解开', async () => {
    const plain = new TextEncoder().encode('稿子');
    const a = await deriveAesKey('theloom:bucketA/theloom/', '同一个口令');
    const b = await deriveAesKey('theloom:bucketB/theloom/', '同一个口令');
    const ct = await encryptBytes(plain, a);
    await expect(decryptBytes(ct, b)).rejects.toThrow();
    expect(new TextDecoder().decode(await decryptBytes(ct, a))).toBe('稿子');
  });
});
