import { afterEach, describe, expect, it, vi } from 'vitest';
import { getObject, headObject, putObject, testConnection, type S3Config } from './s3';

const CFG: S3Config = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'my-bucket',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  prefix: 'theloom/',
};

/** 抓住最后一次 fetch 的参数,并按需伪造响应 */
function stubFetch(res: Partial<Response> & { status: number }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: new Headers((res.headers as Headers | undefined) ?? {}),
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      text: () => Promise.resolve(''),
    } as Response);
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('S3 客户端', () => {
  it('path-style 拼出 endpoint/bucket/prefix/key,并带上签名头', async () => {
    const calls = stubFetch({ status: 200, headers: new Headers({ ETag: '"abc"' }) });
    await putObject(CFG, 'project.enc', new Uint8Array([1]));
    expect(calls[0].url).toBe('https://acct.r2.cloudflarestorage.com/my-bucket/theloom/project.enc');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/auto\/s3\/aws4_request/);
    expect(h['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    // Host 必须交给浏览器,显式设置会被拒
    expect(h.Host).toBeUndefined();
  });

  it('virtual-host style 把桶名放进域名', async () => {
    const calls = stubFetch({ status: 200, headers: new Headers() });
    await putObject({ ...CFG, pathStyle: false }, 'a.bin', new Uint8Array([1]));
    expect(calls[0].url).toBe('https://my-bucket.acct.r2.cloudflarestorage.com/theloom/a.bin');
  });

  it('小载荷实算哈希,大载荷用 UNSIGNED-PAYLOAD 省一次全量读取', async () => {
    let calls = stubFetch({ status: 200, headers: new Headers() });
    await putObject(CFG, 'small', new Uint8Array(10));
    expect((calls[0].init.headers as Record<string, string>)['x-amz-content-sha256'])
      .toMatch(/^[0-9a-f]{64}$/);

    vi.unstubAllGlobals();
    calls = stubFetch({ status: 200, headers: new Headers() });
    await putObject(CFG, 'big', new Uint8Array(6 * 1024 * 1024));
    expect((calls[0].init.headers as Record<string, string>)['x-amz-content-sha256'])
      .toBe('UNSIGNED-PAYLOAD');
  });

  it('404 返回 null 而不是抛错 —— 首次同步时对象本就不存在', async () => {
    stubFetch({ status: 404, headers: new Headers() });
    expect(await getObject(CFG, 'nope')).toBeNull();
    expect(await headObject(CFG, 'nope')).toBeNull();
  });

  it('403 抛 S3Error 并带状态码', async () => {
    stubFetch({ status: 403, headers: new Headers() });
    await expect(getObject(CFG, 'x')).rejects.toMatchObject({ name: 'S3Error', status: 403 });
  });

  it('自检把 403 / 404 / CORS 三种失败分开报', async () => {
    stubFetch({ status: 403, headers: new Headers() });
    expect(await testConnection(CFG)).toMatchObject({ ok: false, reason: expect.stringContaining('403') });

    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const r = await testConnection(CFG);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('CORS');
  });

  it('前缀为空时不产生双斜杠', async () => {
    const calls = stubFetch({ status: 200, headers: new Headers() });
    await putObject({ ...CFG, prefix: '' }, 'k.bin', new Uint8Array([1]));
    expect(calls[0].url).toBe('https://acct.r2.cloudflarestorage.com/my-bucket/k.bin');
  });
});
