import { describe, expect, it } from 'vitest';
import { challengeOf, headOf, itemPath, newVerifier } from './onedrive';
import { remoteScope, targetReady } from './backend';

describe('OneDrive 后端', () => {
  it('PKCE verifier 长度合规且不重复', () => {
    const a = newVerifier();
    const b = newVerifier();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a.length).toBeLessThanOrEqual(128);
    // base64url:不能出现 + / =,否则微软会拒
    expect(a).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('code_challenge 用 RFC 7636 附录 B 的标准向量', async () => {
    // 这条向量是 RFC 自带的;签名类的东西不对拍向量根本无从反推错在哪
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await challengeOf(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('路径拼接带前缀并逐段编码', () => {
    expect(itemPath({ prefix: 'theloom/' }, 'project.enc')).toBe('theloom/project.enc');
    expect(itemPath({ prefix: '/theloom/' }, 'assets/a.png')).toBe('theloom/assets/a.png');
    expect(itemPath({}, 'project.enc')).toBe('project.enc');
    expect(itemPath({ prefix: '我的 稿' }, 'project.enc'))
      .toBe(`${encodeURIComponent('我的 稿')}/project.enc`);
  });

  it('冲突判定优先取 cTag —— eTag 连元数据改动也会变', () => {
    expect(headOf({ cTag: 'c1', eTag: 'e1' }).etag).toBe('c1');
    expect(headOf({ eTag: 'e1' }).etag).toBe('e1');
    expect(headOf({}).etag).toBeNull();
    expect(headOf({ lastModifiedDateTime: '2026-08-23T10:00:00Z' }).lastModified)
      .toBe(Date.parse('2026-08-23T10:00:00Z'));
  });

  it('密钥作用域按后端分开,且 S3 那支的字符串保持原样', () => {
    // 改了这一行就等于把已有桶里的数据锁死
    expect(remoteScope({ bucket: 'b', prefix: 'theloom/' })).toBe('theloom:b/theloom/');
    expect(remoteScope({ provider: 'onedrive', prefix: 'theloom/' })).toBe('theloom:onedrive/theloom/');
  });

  it('OneDrive 未登录时不算配置齐全', () => {
    expect(targetReady({ provider: 'onedrive', clientId: 'x' })).toBe(false);
    expect(targetReady({ endpoint: 'e', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' })).toBe(true);
  });
});
