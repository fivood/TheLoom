/**
 * CLI 侧的项目文件夹读取(R20-3)
 *
 * 用 node fs 组装出与 Rust `load_project_dir` 相同形状的 ProjectFiles,
 * 然后交给 `projectFromFolderFiles` —— 解析、迁移与规范化全部与应用共用同一套代码,
 * 不在 CLI 里另写一份 md 解析。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Project } from '../types';
import { projectFromFolderFiles, type ProjectFiles } from '../storage';

interface MdFile { name: string; content: string }

function readMdDir(dir: string): MdFile[] {
  const out: MdFile[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (!statSync(full).isFile() || !name.toLowerCase().endsWith('.md')) continue;
    out.push({ name, content: readFileSync(full, 'utf8') });
  }
  return out;
}

/** documents/ 递归读取,name 为相对路径(与 Rust 侧一致,用 / 分隔) */
function readMdDirRecursive(base: string): MdFile[] {
  const out: MdFile[] = [];
  const visit = (current: string) => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      if (!name.toLowerCase().endsWith('.md')) continue;
      out.push({
        name: relative(base, full).split(sep).join('/'),
        content: readFileSync(full, 'utf8'),
      });
    }
  };
  visit(base);
  return out;
}

/** assets/ 只取 entity-* 头像(与 Rust 侧一致:资源原文件不整读进内存) */
function readAvatarDir(dir: string): MdFile[] {
  const out: MdFile[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.startsWith('entity-')) continue;
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    const full = join(dir, name);
    if (!statSync(full).isFile()) continue;
    out.push({ name, content: readFileSync(full).toString('base64') });
  }
  return out;
}

function validProjectJson(data: string): boolean {
  try {
    const value = JSON.parse(data) as Record<string, unknown>;
    return value?.version === 1 && typeof value.name === 'string' && Array.isArray(value.flows);
  } catch {
    return false;
  }
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export interface LoadedCliProject {
  project: Project;
  /** project.json 损坏、改用 .bak 时为 true */
  recoveredFromBackup: boolean;
}

export function loadProjectFromDir(dir: string): LoadedCliProject {
  const primary = readIfExists(join(dir, 'project.json'));
  const backup = readIfExists(join(dir, 'project.json.bak'));
  const primaryValid = primary !== null && validProjectJson(primary);
  const backupValid = backup !== null && validProjectJson(backup);
  if (!primaryValid && !backupValid) {
    throw new Error(`${dir} 里没有可用的 project.json(也没有可用的 .bak)`);
  }
  const files: ProjectFiles = {
    projectJson: primaryValid ? primary : backup,
    recoveredFromBackup: !primaryValid && backupValid,
    entities: readMdDir(join(dir, 'entities')),
    research: readMdDir(join(dir, 'research')),
    documents: readMdDirRecursive(join(dir, 'documents')),
    assets: readAvatarDir(join(dir, 'assets')),
  };
  const loaded = projectFromFolderFiles(files);
  return { project: loaded.project, recoveredFromBackup: loaded.recoveredFromBackup };
}
