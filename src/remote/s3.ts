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

async function send(
  cfg: S3Config,
  method: string,
  key: string,
  body?: Uint8Array,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const { url, host, path } = target(cfg, key);
  // 载荷小就实算哈希(更严格);大文件走 UNSIGNED-PAYLOAD 避免二次读取
  const payloadHash = !body
    ? await sha256Hex('')
    : body.byteLength <= 5 * 1024 * 1024 ? await sha256Hex(body) : UNSIGNED;

  const headers = await signRequest({
    method,
    path,
    headers: { Host: host, ...extraHeaders },
    payloadHash,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
  });
  // Host 由浏览器自己带,显式设置会被拒
  delete headers.Host;

  const res = await fetch(url, {
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
