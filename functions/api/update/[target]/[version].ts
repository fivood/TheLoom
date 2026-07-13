/**
 * 自动更新清单中转
 *
 * 拉取 GitHub Releases 最新的 latest.json,把各平台的下载地址
 * 重写为本站 /api/download/{tag}/{file} 代理地址,使大陆等
 * GitHub 直连不稳定的网络也能完成更新。边缘缓存 5 分钟。
 * 版本比较由 Tauri 更新器客户端完成,这里始终返回最新清单。
 */

const REPO = 'fivood/TheLoom';
const MANIFEST_URL = `https://github.com/${REPO}/releases/latest/download/latest.json`;
const CACHE_TTL = 300;

interface Manifest {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, { signature: string; url: string }>;
}

export const onRequestGet: PagesFunction = async ({ request, waitUntil }) => {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/update/latest-manifest', request.url).toString());
  let upstream = await cache.match(cacheKey);

  if (!upstream) {
    const res = await fetch(MANIFEST_URL, { redirect: 'follow' });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `获取更新清单失败(HTTP ${res.status})` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    upstream = new Response(res.body, res);
    upstream.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
    waitUntil(cache.put(cacheKey, upstream.clone()));
  }

  let manifest: Manifest;
  try {
    manifest = await upstream.json();
  } catch {
    return new Response(JSON.stringify({ error: '更新清单格式错误' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const origin = new URL(request.url).origin;
  for (const platform of Object.values(manifest.platforms ?? {})) {
    const m = platform.url?.match(/\/releases\/download\/([^/]+)\/(.+)$/);
    if (m) {
      platform.url = `${origin}/api/download/${m[1]}/${encodeURIComponent(decodeURIComponent(m[2]))}`;
    }
  }

  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
