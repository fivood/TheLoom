import type { MapDoc } from './types';

/**
 * 地图底图的存放方式。
 *
 * 底图曾经是 base64 dataURL 直接内联在 project.json 里。一张 Inkarnate 导出
 * (2048×1152)内联后约 2.4MB,而 localStorage 告警线是 4MB、快照上限 30+20 条
 * 且每条都是整个项目的 JSON —— 一张图就能把快照区推到百 MB 量级,云端也要
 * 每次全量重传。R8 的内容寻址资源库本来就是为这件事建的,底图理应走那条路。
 */

/**
 * 小图不值得搬。示例项目的底图是几 KB 的内联 SVG,搬进资源库只是徒增一条
 * IDB 记录与一次迁移写入,省不下什么。
 */
export const MIGRATE_MIN_BYTES = 64 * 1024;

/** dataURL 的近似字节数(base64 每 4 字符表示 3 字节) */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const body = dataUrl.length - comma - 1;
  return dataUrl.slice(0, comma).includes(';base64') ? Math.floor(body * 3 / 4) : body;
}

/** 从 dataURL 头部取 mime,拿不到返回空串 */
export function dataUrlMime(dataUrl: string): string {
  const m = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return m ? m[1] : '';
}

/** 该地图是否需要把内联底图搬进资源库 */
export function needsImageMigration(map: Pick<MapDoc, 'image' | 'imageHash'>): boolean {
  if (!map.image || map.imageHash) return false;
  return dataUrlBytes(map.image) >= MIGRATE_MIN_BYTES;
}

/** 该地图有没有底图(两种存法都算) */
export function hasBaseImage(map: Pick<MapDoc, 'image' | 'imageHash'>): boolean {
  return !!(map.imageHash || map.image);
}
