/**
 * TheLoom 无界面导出 CLI(R20-3)
 *
 *   node cli-dist/theloom-cli.mjs export --project <项目目录> --out <目标>
 *
 * 供 CI 与开发期使用:读项目文件夹、按命名配置构建引擎包、跑导出前闸门、
 * 输出 zip 或同步进引擎工程目录(只写变化的文件)。
 * 退出码区分失败原因,方便流水线分流处理。
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { EngineExportConfig, Project } from '../types';
import { DEFAULT_ENGINE_EXPORT_GATE } from '../types';
import {
  buildEnginePackage, rulesFromConfig, ENGINE_SCHEMA_VERSION,
  type EnginePackage,
} from '../engine/package';
import { generateTypes } from '../engine/typegen';
import { ENGINE_PACKAGE_SCHEMA, engineReadme } from '../engine/schema';
import { buildBundleFiles } from '../engine/bundle';
import { runExportGate, type ExportGateReport } from '../engine/gate';
import { assetFileName } from '../assetFiles';
import { makeZip, type ZipInputFile } from '../interop/zip';
import { loadProjectFromDir } from './loadProject';
import { syncToDirectory, projectFingerprint, type SyncResult } from './sync';

/** 退出码:CI 据此分流,不要随意改动既有含义 */
export const EXIT = {
  ok: 0,
  usage: 2,
  /** 脚本 / 高级体检 / 路径检查有阻断项 */
  auditFailed: 3,
  /** 场景化回归测试失败 */
  testsFailed: 4,
  /** 目标目录里已有的包来自不兼容的 schema 主版本 */
  schemaMismatch: 5,
  /** 读写文件失败 */
  ioFailed: 6,
} as const;

const HELP = `TheLoom 引擎包导出 CLI

用法:
  theloom-cli export --project <项目目录> [选项]

选项:
  --project, -p <目录>   项目文件夹(含 project.json)
  --config, -c <名字>    使用项目内保存的命名导出配置;缺省用第一个配置,没有配置则用默认规则
  --out, -o <路径>       输出目标。以 .zip 结尾写压缩包,否则视为目录做同步
  --flows <a,b>          覆盖配置的流程选择(技术名或 id,逗号分隔)
  --clean                目录同步时删除上次由本工具写入、这次不再产出的文件
  --no-gate              跳过导出前检查(不推荐,CI 里请保留)
  --watch                监听项目目录变化并自动重新导出
  --json                 以 JSON 输出结果,便于流水线解析
  --quiet                只在出错时输出
  --help, -h             显示本帮助

退出码:
  0 成功   2 用法/输入错误   3 体检或脚本检查失败
  4 回归测试失败   5 Schema 主版本不兼容   6 读写失败
`;

interface Options {
  project: string;
  config?: string;
  out?: string;
  flows?: string[];
  clean: boolean;
  gate: boolean;
  watch: boolean;
  json: boolean;
  quiet: boolean;
}

export function parseArgs(argv: string[]): Options | { help: true } | { error: string } {
  const opts: Options = {
    project: '', clean: false, gate: true, watch: false, json: false, quiet: false,
  };
  const rest = [...argv];
  const command = rest.shift();
  if (command === '--help' || command === '-h' || command === undefined) return { help: true };
  if (command !== 'export') return { error: `未知命令:${command}` };

  while (rest.length > 0) {
    const arg = rest.shift()!;
    const next = () => {
      const value = rest.shift();
      if (value === undefined) throw new Error(`${arg} 缺少取值`);
      return value;
    };
    try {
      switch (arg) {
        case '--project': case '-p': opts.project = next(); break;
        case '--config': case '-c': opts.config = next(); break;
        case '--out': case '-o': opts.out = next(); break;
        case '--flows': opts.flows = next().split(',').map((s) => s.trim()).filter(Boolean); break;
        case '--clean': opts.clean = true; break;
        case '--no-gate': opts.gate = false; break;
        case '--watch': opts.watch = true; break;
        case '--json': opts.json = true; break;
        case '--quiet': opts.quiet = true; break;
        case '--help': case '-h': return { help: true };
        default: return { error: `未知参数:${arg}` };
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (!opts.project) return { error: '缺少 --project <项目目录>' };
  return opts;
}

/** 按名字挑配置;没给名字用第一个;项目里一个都没有时回落默认规则 */
export function pickConfig(project: Project, name?: string): EngineExportConfig | { error: string } {
  const configs = project.engineExportConfigs ?? [];
  if (name) {
    const found = configs.find((c) => c.name === name);
    if (!found) {
      const known = configs.map((c) => c.name).join('、') || '(项目里没有保存任何配置)';
      return { error: `找不到导出配置「${name}」。已有:${known}` };
    }
    return found;
  }
  if (configs.length > 0) return configs[0];
  return {
    id: '__cli_default__', name: '默认规则',
    gate: { ...DEFAULT_ENGINE_EXPORT_GATE },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

/** --flows 覆盖:接受技术名或 id,解析不到就报错而不是悄悄少导 */
function applyFlowOverride(project: Project, config: EngineExportConfig, refs: string[]): EngineExportConfig | { error: string } {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    const flow = project.flows.find((f) => f.technicalName === ref) ?? project.flows.find((f) => f.id === ref);
    if (flow) ids.push(flow.id);
    else missing.push(ref);
  }
  if (missing.length > 0) return { error: `--flows 里这些流程不存在:${missing.join('、')}` };
  return { ...config, flowIds: ids };
}

/** 目标目录里已有的包如果是别的 schema 主版本,拒绝覆盖 */
function checkSchemaCompat(outDir: string): string | null {
  const existing = join(outDir, 'theloom-package.json');
  try {
    if (!statSync(existing).isFile()) return null;
  } catch {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(existing, 'utf8')) as { schemaVersion?: string };
    const previous = typeof raw.schemaVersion === 'string' ? raw.schemaVersion : '';
    if (!previous) return null;
    const major = (v: string) => v.split('.')[0];
    if (major(previous) !== major(ENGINE_SCHEMA_VERSION)) {
      return `目标目录里已有的包是 schema ${previous},当前生成的是 ${ENGINE_SCHEMA_VERSION};主版本不同,引擎侧集成需要先适配。清空目标目录后再导出。`;
    }
  } catch { /* 读不动就不拦 */ }
  return null;
}

interface RunResult {
  code: number;
  message: string;
  detail?: Record<string, unknown>;
}

async function runExport(opts: Options): Promise<RunResult> {
  const projectDir = resolve(opts.project);

  let project: Project;
  try {
    project = loadProjectFromDir(projectDir).project;
  } catch (e) {
    return { code: EXIT.usage, message: `读取项目失败:${e instanceof Error ? e.message : e}` };
  }

  const picked = pickConfig(project, opts.config);
  if ('error' in picked) return { code: EXIT.usage, message: picked.error };
  let config = picked;
  if (opts.flows) {
    const overridden = applyFlowOverride(project, config, opts.flows);
    if ('error' in overridden) return { code: EXIT.usage, message: overridden.error };
    config = overridden;
  }
  if (config.flowIds && config.flowIds.length === 0) {
    return { code: EXIT.usage, message: '这个配置一个流程都没选(可能配置里的流程已被删除),没有可导出的内容。' };
  }

  let gateReport: ExportGateReport | null = null;
  if (opts.gate) {
    gateReport = runExportGate(project, config);
    if (gateReport.failedTests.length > 0) {
      return {
        code: EXIT.testsFailed,
        message: `回归测试失败 ${gateReport.failedTests.length} 项:${gateReport.failedTests.map((t) => t.name).join('、')}`,
        detail: { failedTests: gateReport.failedTests.map((t) => ({ name: t.name, error: t.error })) },
      };
    }
    if (gateReport.blocking.length > 0) {
      return {
        code: EXIT.auditFailed,
        message: `导出前检查有 ${gateReport.blocking.length} 个阻断问题:\n${gateReport.blocking.slice(0, 10).map((i) => `  · [${i.kind}] ${i.message}`).join('\n')}`,
        detail: { blocking: gateReport.blocking.map((i) => ({ kind: i.kind, message: i.message })) },
      };
    }
  }

  // 用项目 updatedAt 当导出时间:同一份项目内容反复导出得到完全相同的字节,
  // 目录同步才能真的只写变化的文件(否则时间戳每次都变,引擎每次都重新导入)
  const pkg: EnginePackage = buildEnginePackage(project, {
    ...rulesFromConfig(config),
    exportedAt: project.updatedAt,
  });
  const bundle = config.bundle ?? {};
  const baseFiles: ZipInputFile[] = [
    { name: 'theloom-package.json', content: JSON.stringify(pkg, null, 2) },
    { name: 'theloom-package.schema.json', content: JSON.stringify(ENGINE_PACKAGE_SCHEMA, null, 2) },
    { name: 'theloom-types.d.ts', content: generateTypes(pkg) },
    { name: 'README.md', content: engineReadme(project.name, bundle) },
  ];

  // 运行库:CLI 从构建产物里读(与应用内嵌的是同一个文件)
  let runtimeSource: string | null = null;
  if (bundle.runtime) {
    for (const candidate of ['runtime-dist/theloom-runtime.js', '../runtime-dist/theloom-runtime.js']) {
      try {
        runtimeSource = readFileSync(resolve(candidate), 'utf8');
        break;
      } catch { /* 换下一个候选 */ }
    }
    if (!runtimeSource) {
      return {
        code: EXIT.ioFailed,
        message: '配置要求把运行库打进包,但找不到 runtime-dist/theloom-runtime.js;先运行 npm run build:runtime。',
      };
    }
  }

  const result = await buildBundleFiles(pkg, baseFiles, {
    bundle,
    runtimeSource,
    readAssetBytes: async (asset) => {
      if (!asset.hash) return null;
      try {
        return new Uint8Array(readFileSync(join(projectDir, 'assets', assetFileName(asset.hash, asset.ext))));
      } catch {
        return null;
      }
    },
  });

  const stats = {
    flows: pkg.flows.length,
    nodes: Object.keys(pkg.index.nodes).length,
    entities: pkg.entities.length,
    assets: pkg.assets.length,
    bundledAssets: result.assetCount,
    missingAssets: result.missingAssets.length,
    warnings: gateReport?.warnings.length ?? 0,
  };

  if (!opts.out) {
    return {
      code: EXIT.ok,
      message: `检查通过,未指定 --out,没有写出文件。${stats.flows} 流程 / ${stats.nodes} 节点`,
      detail: { stats, config: config.name },
    };
  }

  const out = resolve(opts.out);
  if (out.toLowerCase().endsWith('.zip')) {
    try {
      const zip = await makeZip(result.files);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(await zip.arrayBuffer()));
    } catch (e) {
      return { code: EXIT.ioFailed, message: `写入 zip 失败:${e instanceof Error ? e.message : e}` };
    }
    return {
      code: EXIT.ok,
      message: `已写出 ${out}(${result.files.length} 个文件)`,
      detail: { stats, config: config.name, out, missingAssets: result.missingAssets },
    };
  }

  const mismatch = checkSchemaCompat(out);
  if (mismatch) return { code: EXIT.schemaMismatch, message: mismatch };

  let sync: SyncResult;
  try {
    sync = syncToDirectory(out, result.files, opts.clean);
  } catch (e) {
    return { code: EXIT.ioFailed, message: `同步到目录失败:${e instanceof Error ? e.message : e}` };
  }
  return {
    code: EXIT.ok,
    message: `已同步到 ${out}:写入 ${sync.written.length}、跳过 ${sync.skipped.length}、删除 ${sync.removed.length}`,
    detail: { stats, config: config.name, out, sync, missingAssets: result.missingAssets },
  };
}

function report(result: RunResult, opts: Options) {
  if (opts.json) {
    const payload = JSON.stringify({ ok: result.code === EXIT.ok, code: result.code, message: result.message, ...result.detail });
    if (result.code === EXIT.ok) console.log(payload);
    else console.error(payload);
    return;
  }
  if (result.code === EXIT.ok) {
    if (!opts.quiet) console.log(`✓ ${result.message}`);
  } else {
    console.error(`✗ ${result.message}`);
  }
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ('help' in parsed) {
    console.log(HELP);
    return EXIT.ok;
  }
  if ('error' in parsed) {
    console.error(`✗ ${parsed.error}\n`);
    console.error(HELP);
    return EXIT.usage;
  }
  const opts = parsed;

  if (!opts.watch) {
    const result = await runExport(opts);
    report(result, opts);
    return result.code;
  }

  // 监听模式:指纹变化才重导,避免编辑器的多次写入触发一串重复导出
  const projectDir = resolve(opts.project);
  let last = '';
  const tick = async () => {
    const fingerprint = projectFingerprint(projectDir);
    if (fingerprint === last) return;
    last = fingerprint;
    const result = await runExport(opts);
    report(result, opts);
  };
  if (!opts.quiet) console.log(`监听 ${projectDir}(Ctrl+C 退出)`);
  await tick();
  const timer = setInterval(() => { void tick(); }, 1500);
  await new Promise<void>((resolvePromise) => {
    process.on('SIGINT', () => { clearInterval(timer); resolvePromise(); });
  });
  return EXIT.ok;
}

// 作为可执行文件运行时才自动跑(被测试 import 时不执行)
if (process.argv[1] && /theloom-cli|cli[\\/]main/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
