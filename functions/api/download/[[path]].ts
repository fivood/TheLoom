/**
 * Release 资产下载代理
 *
 * /api/download/{tag}/{file} → 经 Cloudflare 边缘流式转发
 *   github.com/fivood/TheLoom/releases/download/{tag}/{file}
 * /api/download/latest      → 302 到最新 Windows 安装包
 *
 * 仅允许本仓库的 Release 资产,发布资产不可变,边缘缓存 1 天。
 */

const REPO = 'fivood/TheLoom';

export const onRequestGet: PagesFunction = async ({ request, params, waitUntil }) => {
  const parts = Array.isArray(params.path) ? params.path : [params.path];

  // /api/download/latest → 重定向到最新 Windows 安装包
  if (parts.length === 1 && parts[0] === 'latest') {
    const res = await fetch(`https://github.com/${REPO}/releases/latest/download/latest.json`, { redirect: 'follow' });
    if (!res.ok) return new Response('暂无发布版本', { status: 404 });
    const manifest = await res.json() as { platforms?: Record<string, { url: string }> };
    const url = manifest.platforms?.['windows-x86_64']?.url;
    const m = url?.match(/\/releases\/download\/([^/]+)\/(.+)$/);
    if (!m) return new Response('清单中没有 Windows 安装包', { status: 404 });
    return Response.redirect(`${new URL(request.url).origin}/api/download/${m[1]}/${m[2]}`, 302);
  }

  if (parts.length !== 2) return new Response('路径格式:/api/download/{tag}/{file}', { status: 400 });
  const [tag, file] = parts.map((s) => decodeURIComponent(s ?? ''));
  if (!/^[\w.\-]+$/.test(tag) || !/^[\w.\- ()%]+$/.test(file)) {
    return new Response('非法的 tag 或文件名', { status: 400 });
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = await fetch(
    `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`,
    { redirect: 'follow' },
  );
  if (!upstream.ok) return new Response(`上游返回 HTTP ${upstream.status}`, { status: upstream.status });

  const [body, cacheBody] = upstream.body!.tee();
  const headers = {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${file.replace(/"/g, '')}"`,
    'Cache-Control': 'public, max-age=86400',
  };
  waitUntil(cache.put(cacheKey, new Response(cacheBody, { headers })));
  return new Response(body, { headers });
};
