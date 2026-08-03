/**
 * 自包含引擎包(R20-2)
 *
 * 默认导出只有数据(JSON + Schema + 类型 + 说明),原文件与运行库要另外拿。
 * 这里把它们按需打进同一个 zip,目标是:**把包复制到一台没有 TheLoom
 * 项目文件夹的机器上,示例工程仍能加载、显示对白并读取附件**。
 *
 * 包结构(勾了什么才有什么):
 *   theloom-package.json          数据包
 *   theloom-package.schema.json   JSON Schema
 *   theloom-types.d.ts            TypeScript 类型
 *   README.md                     使用说明
 *   assets/asset-{hash16}.{ext}   被引用资源的原文件字节
 *   theloom-runtime.js            零依赖运行库(ES Module)
 *   LICENSES.md                   资源授权与来源表
 *   checksums.json                SHA-256 校验清单(不含它自己)
 */
import type { EngineAsset, EnginePackage } from './package';
import type { ZipInputFile } from '../interop/zip';

export interface EngineBundleOptions {
  /** 把被引用资源的原文件字节打进包 */
  assetFiles?: boolean;
  /** 把独立运行库 theloom-runtime.js 打进包 */
  runtime?: boolean;
  /** 生成 SHA-256 校验清单与授权来源表 */
  checksums?: boolean;
}

/** 读取单个资源的原文件字节;读不到返回 null(由调用方决定怎么报告) */
export type AssetByteReader = (asset: EngineAsset) => Promise<Uint8Array | null>;

export interface MissingAsset {
  id: string;
  name: string;
  /** 期望的包内路径;没有 hash 的老资源为空 */
  fileName: string;
  reason: '从未保存原文件' | '原文件丢失';
}

export interface BundleResult {
  files: ZipInputFile[];
  /** 勾了「资源原文件」但取不到字节的资源;导出后如实告知,不静默 */
  missingAssets: MissingAsset[];
  /** 打进包的原文件数量与字节数 */
  assetCount: number;
  assetBytes: number;
}

export const CHECKSUMS_FILE = 'checksums.json';
export const RUNTIME_FILE = 'theloom-runtime.js';
export const LICENSES_FILE = 'LICENSES.md';

async function sha256(content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 资源授权与来源表:交付前用它核对素材权利 */
export function licensesMarkdown(pkg: EnginePackage): string {
  const lines = [
    `# 资源授权与来源 · ${pkg.meta.projectName}`,
    '',
    `导出时间:${new Date(pkg.meta.exportedAt).toISOString()}`,
    '',
  ];
  if (pkg.assets.length === 0) {
    lines.push('本包不含任何资源。');
    return `${lines.join('\n')}\n`;
  }
  lines.push('| 资源 | 类型 | 包内文件 | 授权 | 来源 |', '|---|---|---|---|---|');
  for (const a of pkg.assets) {
    const cell = (s?: string) => (s && s.trim() ? s.replace(/\|/g, '\\|').replace(/\n/g, ' ') : '—');
    lines.push(`| ${cell(a.name)} | ${a.kind} | ${cell(a.fileName)} | ${cell(a.license)} | ${cell(a.source)} |`);
  }
  const unlicensed = pkg.assets.filter((a) => !a.license?.trim());
  if (unlicensed.length > 0) {
    lines.push(
      '',
      `> 注意:${unlicensed.length} 个资源未标注授权(${unlicensed.map((a) => a.name).join('、')})。`,
      '> 对外交付前请在资源库补齐「授权 / 许可」字段。',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 组装自包含包的额外文件。
 * baseFiles 是数据包那几份;返回值里已经把它们与新增文件合在一起,
 * 顺序保证 checksums.json 最后生成(它要覆盖前面所有文件)。
 */
export async function buildBundleFiles(
  pkg: EnginePackage,
  baseFiles: ZipInputFile[],
  options: {
    bundle: EngineBundleOptions;
    readAssetBytes: AssetByteReader;
    /** 运行库源码;为空表示当前构建拿不到(界面应禁用该选项) */
    runtimeSource?: string | null;
  },
): Promise<BundleResult> {
  const { bundle, readAssetBytes, runtimeSource } = options;
  const files: ZipInputFile[] = [...baseFiles];
  const missingAssets: MissingAsset[] = [];
  let assetCount = 0;
  let assetBytes = 0;

  if (bundle.assetFiles) {
    // 同一份字节可能被多个资源共用(内容寻址),按包内路径去重
    const written = new Set<string>();
    for (const asset of pkg.assets) {
      if (!asset.fileName) {
        missingAssets.push({ id: asset.id, name: asset.name, fileName: '', reason: '从未保存原文件' });
        continue;
      }
      if (written.has(asset.fileName)) continue;
      const bytes = await readAssetBytes(asset);
      if (!bytes) {
        missingAssets.push({ id: asset.id, name: asset.name, fileName: asset.fileName, reason: '原文件丢失' });
        continue;
      }
      written.add(asset.fileName);
      files.push({ name: `assets/${asset.fileName}`, content: bytes });
      assetCount++;
      assetBytes += bytes.byteLength;
    }
  }

  if (bundle.runtime && runtimeSource) {
    files.push({ name: RUNTIME_FILE, content: runtimeSource });
  }

  if (bundle.checksums) {
    files.push({ name: LICENSES_FILE, content: licensesMarkdown(pkg) });
    const entries: Record<string, string> = {};
    for (const f of files) entries[f.name] = await sha256(f.content);
    files.push({
      name: CHECKSUMS_FILE,
      content: `${JSON.stringify({
        schema: 'theloom-checksums',
        algorithm: 'SHA-256',
        generatedAt: pkg.meta.exportedAt,
        // 清单本身不在表内 —— 校验时先移除它再逐一比对
        files: entries,
      }, null, 2)}\n`,
    });
  }

  return { files, missingAssets, assetCount, assetBytes };
}
