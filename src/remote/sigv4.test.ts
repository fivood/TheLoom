import { describe, expect, it } from 'vitest';
import { encodePath, sha256Hex, signRequest } from './sigv4';

/*
 * 向量来自 AWS 官方文档 "Signature Calculations for the Authorization Header"
 * 的 GET Object 示例。这组凭据是 AWS 公开的示例值,不是真实密钥。
 * 签名算法错一个字节,服务端只回 403 且不说原因,所以必须靠向量守住。
 */
const AK = 'AKIAIOSFODNN7EXAMPLE';
const SK = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('SigV4 签名', () => {
  it('空载荷的 SHA-256 与已知常量一致', async () => {
    expect(await sha256Hex('')).toBe(EMPTY_SHA);
  });

  it('AWS 文档 GET Object 示例:签名逐字节一致', async () => {
    const headers = await signRequest({
      method: 'GET',
      path: '/test.txt',
      headers: {
        Host: 'examplebucket.s3.amazonaws.com',
        Range: 'bytes=0-9',
      },
      payloadHash: EMPTY_SHA,
      accessKeyId: AK,
      secretAccessKey: SK,
      region: 'us-east-1',
      amzDate: '20130524T000000Z',
    });
    expect(headers.Authorization).toContain(
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers.Authorization).toContain(`Credential=${AK}/20130524/us-east-1/s3/aws4_request`);
    expect(headers.Authorization).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date');
  });

  it('AWS 文档 PUT Object 示例:签名逐字节一致', async () => {
    const bodyHash = await sha256Hex('Welcome to Amazon S3.');
    const headers = await signRequest({
      method: 'PUT',
      path: '/test%24file.text',
      headers: {
        Host: 'examplebucket.s3.amazonaws.com',
        Date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      payloadHash: bodyHash,
      accessKeyId: AK,
      secretAccessKey: SK,
      region: 'us-east-1',
      amzDate: '20130524T000000Z',
    });
    expect(headers.Authorization).toContain(
      'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  it('AWS 文档 LIST 示例:带查询串同样一致', async () => {
    const headers = await signRequest({
      method: 'GET',
      path: '/',
      query: 'max-keys=2&prefix=J',
      headers: { Host: 'examplebucket.s3.amazonaws.com' },
      payloadHash: EMPTY_SHA,
      accessKeyId: AK,
      secretAccessKey: SK,
      region: 'us-east-1',
      amzDate: '20130524T000000Z',
    });
    expect(headers.Authorization).toContain(
      'Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    );
  });

  it('路径转义保留斜杠,其余按 RFC3986', () => {
    expect(encodePath('/a/b c/d.json')).toBe('/a/b%20c/d.json');
    expect(encodePath('/项目/稿件.md')).toBe('/%E9%A1%B9%E7%9B%AE/%E7%A8%BF%E4%BB%B6.md');
    expect(encodePath("/it's(ok)!")).toBe('/it%27s%28ok%29%21');
  });

  it('头名大小写与空白不影响签名', async () => {
    const base = {
      method: 'GET', path: '/x', payloadHash: EMPTY_SHA,
      accessKeyId: AK, secretAccessKey: SK, region: 'us-east-1',
      amzDate: '20130524T000000Z',
    };
    const a = await signRequest({ ...base, headers: { Host: 'e.s3.amazonaws.com' } });
    const b = await signRequest({ ...base, headers: { HOST: '  e.s3.amazonaws.com  ' } });
    expect(a.Authorization).toBe(b.Authorization);
  });
});
