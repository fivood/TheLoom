/**
 * 目录同步(R20-3)
 *
 * 把引擎包铺开写进引擎工程目录(Godot / Unity 的某个子目录),
 * **只写内容真正变了的文件** —— 引擎的资源导入器盯着 mtime,
 * 每次全量重写会让它反复重新导入,大项目上很痛。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { ZipInputFile } from '../interop/zip';

export interface SyncResult {
  written: string[];
  skipped: string[];
  removed: string[];
}

/** 同步产物的清单文件:记录上次由本工具写入的文件,--clean 据此删除陈旧文件 */
export const SYNC_MANIFEST = '.theloom-sync.json';

function sha256(content: string | Uint8Array): string {
  return createHash('sha256')
    .update(typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content))
    .digest('hex');
}

function readManagedList(dir: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(join(dir, SYNC_MANIFEST), 'utf8')) as { files?: unknown };
    return Array.isArray(raw.files) ? raw.files.filter((f): f is string => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 把文件列表同步到目标目录。
 * clean = true 时,上次写过、这次不再产出的文件会被删除
 * (只删清单里记过的,目标目录里的其他文件一律不碰)。
 */
export function syncToDirectory(dir: string, files: ZipInputFile[], clean: boolean): SyncResult {
  const result: SyncResult = { written: [], skipped: [], removed: [] };
  mkdirSync(dir, { recursive: true });

  for (const file of files) {
    const target = join(dir, ...file.name.split('/'));
    const bytes = typeof file.content === 'string'
      ? Buffer.from(file.content, 'utf8')
      : Buffer.from(file.content);
    let unchanged = false;
    try {
      if (statSync(target).isFile()) {
        unchanged = sha256(readFileSync(target)) === sha256(bytes);
      }
    } catch { /* 不存在 → 要写 */ }
    if (unchanged) {
      result.skipped.push(file.name);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    result.written.push(file.name);
  }

  const produced = new Set(files.map((f) => f.name));
  if (clean) {
    for (const stale of readManagedList(dir)) {
      if (produced.has(stale)) continue;
      const target = join(dir, ...stale.split('/'));
      try {
        if (statSync(target).isFile()) {
          rmSync(target);
          result.removed.push(stale);
        }
      } catch { /* 已经不在了 */ }
    }
  }

  writeFileSync(
    join(dir, SYNC_MANIFEST),
    `${JSON.stringify({
      schema: 'theloom-sync',
      syncedAt: Date.now(),
      files: [...produced].sort(),
    }, null, 2)}\n`,
  );
  return result;
}

/** 收集项目目录里会影响导出内容的文件的指纹,用于 --watch 判断「真的变了吗」 */
export function projectFingerprint(dir: string): string {
  const parts: string[] = [];
  const visit = (current: string, depth: number) => {
    if (depth > 6) return;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (name.startsWith('.')) continue;
      const full = join(current, name);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        visit(full, depth + 1);
        continue;
      }
      parts.push(`${relative(dir, full).split(sep).join('/')}:${info.size}:${info.mtimeMs}`);
    }
  };
  visit(dir, 0);
  return sha256(parts.join('\n'));
}
