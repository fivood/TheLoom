import { encodePath, sha256Hex, signRequest } from './sigv4';

/**
 * S3 兼容存储的最小客户端(Cloudflare R2 / Backblaze B2 / MinIO / 阿里云 OSS …)。
 *
 * 只实现同步用得到的四个动作,不引 aws-sdk。网页与 Tauri 共用:
 * - **网页端需要在存储桶上配 CORS**(允许本站 origin、GET/PUT/HEAD/DELETE、
 *   暴露 ETag),否则浏览器直连会被拦;桌面端无此限制。
 * - 默认 path-style(`endpoint/bucket/key`),R2 / MinIO 都用这种;
 *   AWS 正统是 virtual-host style,置 `pathStyle: false` 切换。
 */

export interface S3Config {
  endpoint: string;      // https://<account>.r2.cloudflarestorage.com
  region: string;        // R2 固定 auto
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;       // 桶内目录,如 theloom/
  pathStyle?: boolean;   // 默认 true
}

export class S3Error extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'S3Error';
  }
}

/** 大文件不做载荷哈希:HTTPS 已保证传输完整性,省一次全量读取 */
const UNSIGNED = 'UNSIGNED-PAYLOAD';

function joinKey(cfg: S3Config, key: string): string {
  const prefix = (cfg.prefix ?? '').replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${key}` : key;
}

function target(cfg: S3Config, key: string): { url: string; host: string; path: string } {
  const base = new URL(cfg.endpoint);
  const full = joinKey(cfg, key);
  if (cfg.pathStyle === false) {
    const host = `${cfg.bucket}.${base.host}`;
    const path = encodePath(`/${full}`);
    return { url: `${base.protocol}//${host}${path}`, host, path };
  }
  const path = encodePath(`/${cfg.bucket}/${full}`);
  return { url: `${base.protocol}//${base.host}${path}`, host: base.host, path };
}

/** 列举类请求打在桶根上,前缀走查询参数,不能拼进路径 */
function bucketTarget(cfg: S3Config): { url: string; host: string; path: string } {
  const base = new URL(cfg.endpoint);
  if (cfg.pathStyle === false) {
    const host = `${cfg.bucket}.${base.host}`;
    return { url: `${base.protocol}//${host}/`, host, path: '/' };
  }
  const path = encodePath(`/${cfg.bucket}`);
  return { url: `${base.protocol}//${base.host}${path}`, host: base.host, path };
}

async function send(
  cfg: S3Config,
  method: string,
  key: string,
  body?: Uint8Array,
  extraHeaders: Record<string, string> = {},
  query?: string,
): Promise<Response> {
  const { url, host, path } = query ? bucketTarget(cfg) : target(cfg, key);
  // 载荷小就实算哈希(更严格);大文件走 UNSIGNED-PAYLOAD 避免二次读取
  const payloadHash = !body
    ? await sha256Hex('')
    : body.byteLength <= 5 * 1024 * 1024 ? await sha256Hex(body) : UNSIGNED;

  const headers = await signRequest({
    method,
    path,
    query,
    headers: { Host: host, ...extraHeaders },
    payloadHash,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
  });
  // Host 由浏览器自己带,显式设置会被拒
  delete headers.Host;

  const res = await fetch(query ? `${url}?${query}` : url, {
    method,
    headers,
    body: body ? (body.slice().buffer as ArrayBuffer) : undefined,
  });
  if (!res.ok && res.status !== 404) {
    throw new S3Error(res.status, `${method} ${key} 失败:${res.status} ${await res.text().catch(() => '')}`.trim());
  }
  return res;
}

export async function putObject(
  cfg: S3Config, key: string, body: Uint8Array, contentType = 'application/octet-stream',
): Promise<string | null> {
  const res = await send(cfg, 'PUT', key, body, { 'Content-Type': contentType });
  return res.headers.get('ETag');
}

/** 对象不存在返回 null,而不是抛错 —— 首次同步时这是正常情况 */
export async function getObject(cfg: S3Config, key: string): Promise<Uint8Array | null> {
  const res = await send(cfg, 'GET', key);
  if (res.status === 404) return null;
  return new Uint8Array(await res.arrayBuffer());
}

export interface ObjectHead {
  etag: string | null;
  size: number;
  lastModified: number;
}

export async function headObject(cfg: S3Config, key: string): Promise<ObjectHead | null> {
  const res = await send(cfg, 'HEAD', key);
  if (res.status === 404) return null;
  const lm = res.headers.get('Last-Modified');
  return {
    etag: res.headers.get('ETag'),
    size: Number(res.headers.get('Content-Length') ?? 0),
    lastModified: lm ? Date.parse(lm) : 0,
  };
}

export async function deleteObject(cfg: S3Config, key: string): Promise<void> {
  await send(cfg, 'DELETE', key);
}

export interface ListedObject {
  /** 相对 prefix 的键(已剥掉 cfg.prefix 与传入的子前缀) */
  key: string;
  size: number;
  etag: string | null;
  lastModified: number;
}

/**
 * 列出某个子前缀下的全部对象(ListObjectsV2,自动翻页)。
 *
 * 返回的 key 已经剥掉前缀,调用方拿到的就是「相对路径」—— 文件夹同步据此
 * 还原出 documents/xxx.md 这样的结构。
 */
export async function listObjects(cfg: S3Config, subPrefix: string): Promise<ListedObject[]> {
  const full = joinKey(cfg, subPrefix);
  const out: ListedObject[] = [];
  let token: string | undefined;
  // 上限保护:单个项目不该有上万个文件,真到了说明前缀配错了
  for (let page = 0; page < 50; page++) {
    const params: Record<string, string> = { 'list-type': '2', prefix: full, 'max-keys': '1000' };
    if (token) params['continuation-token'] = token;
    const query = Object.keys(params).sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');
    const res = await send(cfg, 'GET', '', undefined, {}, query);
    if (res.status === 404) return out;
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const body = m[1];
      const pick = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)?.[1] ?? '';
      const key = pick('Key');
      if (!key.startsWith(full)) continue;
      out.push({
        key: key.slice(full.length),
        size: Number(pick('Size')) || 0,
        etag: pick('ETag') || null,
        lastModified: Date.parse(pick('LastModified')) || 0,
      });
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
    if (!token) break;
  }
  return out;
}

/** 连通性自检:配置面板用,把 403 / CORS / 桶不存在区分开 */
export async function testConnection(cfg: S3Config): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await headObject(cfg, '.theloom-probe');
    return { ok: true };
  } catch (e) {
    if (e instanceof S3Error) {
      if (e.status === 403) return { ok: false, reason: '密钥无权访问该桶(403),请检查 Access Key 与桶名' };
      if (e.status === 404) return { ok: false, reason: '桶不存在(404),请检查桶名与 endpoint' };
      return { ok: false, reason: e.message };
    }
    // fetch 层直接抛 = 多半是 CORS 或 endpoint 拼错
    return {
      ok: false,
      reason: '连不上。网页端需在桶上配置 CORS(允许本站 origin 与 GET/PUT/HEAD/DELETE、暴露 ETag);也请检查 endpoint 是否正确',
    };
  }
}
