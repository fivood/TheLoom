import { toBase64 } from '../crypto';

/**
 * OneDrive(Microsoft Graph)后端。与 S3 后端提供同一组 get/head/put/delete,
 * 由 backend.ts 按 provider 分发,加密层与冲突层完全复用。
 *
 * 选它而不是 Google Drive:Graph 的 `approot:/{路径}:/content` 是**路径寻址**,
 * 和现有的 key 语义直接对上;Drive 只能按 file-id 操作,每个 key 都要先 list 查 id。
 *
 * 权限用 Files.ReadWrite.AppFolder —— 只能读写自己的应用文件夹,
 * 碰不到 OneDrive 里的其他文件。
 *
 * 已知限制:SPA 的 refresh token 只有 24 小时,且 Safari 拦第三方 cookie 后
 * 静默续期常常失败,所以过一阵需要重新点登录。这是浏览器端 OAuth 的固定成本。
 */

const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'Files.ReadWrite.AppFolder offline_access';
const TOKEN_KEY = 'theloom-onedrive-token-v1';
const PKCE_KEY = 'theloom-onedrive-pkce';

export class OneDriveAuthError extends Error {
  constructor(message = '需要重新登录 OneDrive') {
    super(message);
    this.name = 'OneDriveAuthError';
  }
}

export interface OneDriveTarget {
  clientId?: string;
  prefix?: string;
}

/* ---------- PKCE ---------- */

function base64url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 要求 verifier 长度 43–128;48 字节 base64url 出来正好 64 字符 */
export function newVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(48)));
}

export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** 注册应用时要填的重定向 URI(类型必须选 SPA,否则 token 端点不发 CORS 头) */
export function redirectUri(): string {
  return `${location.origin}/`;
}

/* ---------- 令牌 ---------- */

interface Token {
  access: string;
  refresh: string;
  /** 过期时刻(毫秒) */
  exp: number;
  clientId: string;
}

function loadToken(): Token | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) as Token : null;
  } catch { return null; }
}

function saveToken(t: Token | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* 忽略 */ }
}

export function signedIn(): boolean {
  return !!loadToken();
}

export function signOut(): void {
  saveToken(null);
}

async function tokenRequest(
  body: Record<string, string>,
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const desc = (json as { error_description?: string }).error_description ?? res.status;
    throw new OneDriveAuthError(`登录失败:${desc}`);
  }
  return json as { access_token: string; refresh_token?: string; expires_in: number };
}

/** 跳转到微软登录页。会离开当前页面,回来时走 completeAuth */
export async function beginAuth(clientId: string): Promise<void> {
  const verifier = newVerifier();
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, clientId }));
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPE,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  location.assign(`${AUTH}/authorize?${q}`);
}

/** 同步判断:这次加载是不是登录跳回来的(供 App 决定要不要自动开面板) */
export function redirectPending(): boolean {
  try {
    const q = new URLSearchParams(location.search);
    return (q.has('code') || q.has('error')) && !!sessionStorage.getItem(PKCE_KEY);
  } catch { return false; }
}

/** 消费 URL 上的授权码换令牌;不是跳回来的就返回 'none' */
export async function completeAuth(): Promise<'ok' | 'none'> {
  if (!redirectPending()) return 'none';
  const q = new URLSearchParams(location.search);
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? '{}') as { verifier?: string; clientId?: string };
  sessionStorage.removeItem(PKCE_KEY);
  history.replaceState(null, '', location.origin + location.pathname);
  const err = q.get('error');
  if (err) throw new OneDriveAuthError(`${err}:${q.get('error_description') ?? ''}`);
  if (!saved.verifier || !saved.clientId) throw new OneDriveAuthError('登录状态已丢失,请重试');

  const got = await tokenRequest({
    client_id: saved.clientId,
    grant_type: 'authorization_code',
    code: q.get('code') ?? '',
    redirect_uri: redirectUri(),
    code_verifier: saved.verifier,
  });
  saveToken({
    access: got.access_token,
    refresh: got.refresh_token ?? '',
    exp: Date.now() + got.expires_in * 1000,
    clientId: saved.clientId,
  });
  return 'ok';
}

/** 取可用的 access token;快过期就用 refresh token 续,续不上要求重新登录 */
async function accessToken(): Promise<string> {
  const t = loadToken();
  if (!t) throw new OneDriveAuthError('尚未登录 OneDrive');
  if (t.exp - 60_000 > Date.now()) return t.access;
  if (!t.refresh) { saveToken(null); throw new OneDriveAuthError(); }
  try {
    const got = await tokenRequest({
      client_id: t.clientId,
      grant_type: 'refresh_token',
      refresh_token: t.refresh,
      scope: SCOPE,
    });
    // refresh token 会轮换:必须存回新的,否则下次续期用的是已作废的旧串
    saveToken({
      access: got.access_token,
      refresh: got.refresh_token ?? t.refresh,
      exp: Date.now() + got.expires_in * 1000,
      clientId: t.clientId,
    });
    return got.access_token;
  } catch {
    saveToken(null);
    throw new OneDriveAuthError();
  }
}

/* ---------- 文件操作 ---------- */

/** 应用文件夹内的相对路径;各段单独编码,`/` 保留为层级 */
export function itemPath(cfg: OneDriveTarget, key: string): string {
  const prefix = (cfg.prefix ?? '').replace(/^\/+|\/+$/g, '');
  const full = prefix ? `${prefix}/${key}` : key;
  return full.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function itemUrl(cfg: OneDriveTarget, key: string, suffix = ''): string {
  return `${GRAPH}/me/drive/special/approot:/${itemPath(cfg, key)}${suffix}`;
}

async function graph(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { saveToken(null); throw new OneDriveAuthError(); }
  if (!res.ok && res.status !== 404) {
    throw new Error(`OneDrive ${init.method ?? 'GET'} 失败:${res.status} ${await res.text().catch(() => '')}`.trim());
  }
  return res;
}

export interface ObjectHead {
  etag: string | null;
  size: number;
  lastModified: number;
}

interface DriveItem {
  cTag?: string;
  eTag?: string;
  size?: number;
  lastModifiedDateTime?: string;
}

/** cTag 只在内容变化时变,eTag 连元数据改动也会变 —— 冲突判定要用前者 */
export function headOf(item: DriveItem): ObjectHead {
  return {
    etag: item.cTag ?? item.eTag ?? null,
    size: item.size ?? 0,
    lastModified: item.lastModifiedDateTime ? Date.parse(item.lastModifiedDateTime) : 0,
  };
}

export async function headObject(cfg: OneDriveTarget, key: string): Promise<ObjectHead | null> {
  const res = await graph(`${itemUrl(cfg, key)}?select=cTag,eTag,size,lastModifiedDateTime`);
  if (res.status === 404) return null;
  return headOf(await res.json() as DriveItem);
}

export async function getObject(cfg: OneDriveTarget, key: string): Promise<Uint8Array | null> {
  const res = await graph(itemUrl(cfg, key, ':/content'));
  if (res.status === 404) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/** Graph 的简单上传上限是 4MB,超过要走 upload session */
const SIMPLE_LIMIT = 4 * 1024 * 1024;
/** 分片必须是 320KiB 的整数倍 */
const CHUNK = 320 * 1024 * 25;

export async function putObject(
  cfg: OneDriveTarget, key: string, body: Uint8Array, contentType = 'application/octet-stream',
): Promise<string | null> {
  if (body.byteLength <= SIMPLE_LIMIT) {
    const res = await graph(itemUrl(cfg, key, ':/content?@microsoft.graph.conflictBehavior=replace'), {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: body.slice().buffer as ArrayBuffer,
    });
    return headOf(await res.json() as DriveItem).etag;
  }

  const start = await graph(itemUrl(cfg, key, ':/createUploadSession'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  });
  const { uploadUrl } = await start.json() as { uploadUrl: string };
  const total = body.byteLength;
  let sent = 0;
  while (sent < total) {
    const end = Math.min(sent + CHUNK, total);
    // uploadUrl 自带凭据,再带 Authorization 头反而会被拒
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${sent}-${end - 1}/${total}` },
      body: body.slice(sent, end).buffer as ArrayBuffer,
    });
    if (!res.ok) throw new Error(`OneDrive 分片上传失败:${res.status}`);
    sent = end;
    if (sent >= total) return headOf(await res.json() as DriveItem).etag;
  }
  return null;
}

export async function deleteObject(cfg: OneDriveTarget, key: string): Promise<void> {
  await graph(itemUrl(cfg, key), { method: 'DELETE' });
}

export async function testConnection(cfg: OneDriveTarget): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await headObject(cfg, '.theloom-probe');
    return { ok: true };
  } catch (e) {
    if (e instanceof OneDriveAuthError) return { ok: false, reason: e.message };
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
