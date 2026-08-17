/**
 * AWS Signature V4 签名(S3 兼容存储用)。
 *
 * 手写而不引依赖:整个算法就是几轮 HMAC-SHA256,WebCrypto 原生支持,
 * 网页与 Tauri 同一份实现。aws-sdk 为这点功能要拖进几百 KB。
 *
 * 正确性靠 AWS 文档里的官方测试向量守住(见 sigv4.test.ts)——签名算法
 * 差一个字节就整体失败,且失败信息是服务端的 403,极难反推,必须有向量测试。
 */

const ENC = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    'raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', k, ENC.encode(data));
}

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? ENC.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** S3 要求路径按 RFC3986 转义,但保留 `/` */
export function encodePath(path: string): string {
  return path.split('/').map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

export interface SignInput {
  method: string;
  /** 已编码的路径,以 / 开头 */
  path: string;
  /** 查询串(不含 ?),需已按 key 排序 */
  query?: string;
  headers: Record<string, string>;
  /** 载荷的 SHA-256 十六进制;大文件可传 'UNSIGNED-PAYLOAD' */
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  /** ISO8601 basic,如 20130524T000000Z;省略则取当前时间 */
  amzDate?: string;
}

export function amzDateNow(now = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/** 返回要附加到请求上的头(含 Authorization) */
export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const service = input.service ?? 's3';
  const amzDate = input.amzDate ?? amzDateNow();
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = { ...input.headers, 'x-amz-date': amzDate };
  headers['x-amz-content-sha256'] = input.payloadHash;

  // 规范化:头名小写、按名排序、值压缩空白
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalHeaders = entries.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = entries.map(([k]) => k).join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    input.query ?? '',
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  let key: ArrayBuffer | Uint8Array = ENC.encode(`AWS4${input.secretAccessKey}`);
  for (const part of [dateStamp, input.region, service, 'aws4_request']) {
    key = await hmac(key, part);
  }
  const signature = toHex(await hmac(key, stringToSign));

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, `
      + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
