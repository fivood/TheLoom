/**
 * 自包含引擎包 · 脱机验收(R20-2)
 *
 * 证明:把导出的 zip 解压到任意目录、在一台没有 TheLoom 项目文件夹的机器上,
 * 仅凭包内文件就能加载数据、用包内运行库演出对白、并读取附件资源的原始字节。
 *
 * 用法:
 *   node examples/engine-demo/selfcontained.mjs <解压后的包目录> [流程技术名] [种子]
 *
 * 脚本只读传入的那个目录 —— 运行库、数据、资源字节全部来自包内,
 * 不 import 仓库里的 runtime-dist,也不访问任何项目文件夹。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.argv[2];
if (!dir) {
  console.error('用法:node examples/engine-demo/selfcontained.mjs <解压后的包目录> [流程技术名] [种子]');
  process.exit(2);
}
const root = resolve(dir);
const need = (name) => {
  const p = join(root, name);
  if (!existsSync(p)) {
    console.error(`✗ 包内缺少 ${name} —— 导出时请勾选对应的「打包内容」`);
    process.exit(1);
  }
  return p;
};

console.log(`=== 自包含包脱机验收 · ${root} ===\n`);
console.log('包内文件:', readdirSync(root).join('  '));

/* 1. 校验清单 */
const checksumPath = join(root, 'checksums.json');
if (existsSync(checksumPath)) {
  const { algorithm, files } = JSON.parse(readFileSync(checksumPath, 'utf8'));
  let checked = 0;
  for (const [name, expected] of Object.entries(files)) {
    const actual = createHash('sha256').update(readFileSync(join(root, name))).digest('hex');
    if (actual !== expected) {
      console.error(`✗ ${name} 校验失败`);
      process.exit(1);
    }
    checked++;
  }
  console.log(`\n[1] 校验清单:${checked} 个文件全部通过(${algorithm})`);
} else {
  console.log('\n[1] 校验清单:包内没有 checksums.json,跳过');
}

/* 2. 用包内运行库演出 */
const pkg = JSON.parse(readFileSync(need('theloom-package.json'), 'utf8'));
const { FlowRuntime } = await import(pathToFileURL(need('theloom-runtime.js')).href);

const flowRef = process.argv[3] ?? pkg.flows[0]?.technicalName ?? pkg.flows[0]?.id;
const seed = process.argv[4] ? Number(process.argv[4]) : 42;
console.log(`\n[2] 演出 · ${pkg.meta.projectName} / ${flowRef}(种子 ${seed})`);

const run = new FlowRuntime(pkg, flowRef, {
  seed,
  onBeat: (b) => {
    const head = b.kind === 'dialogue'
      ? `【${b.speakerName ?? b.title ?? '旁白'}】`
      : `〔${b.kind}〕${b.title ? ` ${b.title}` : ''}`;
    console.log(`    ${head} ${b.text ?? ''}${b.note ? `  // ${b.note}` : ''}`.trimEnd());
  },
});
run.start();
let guard = 0;
while (!run.ended && run.choices.length > 0 && guard++ < 200) {
  console.log(`    ▶ 选项:${run.choices.map((c, i) => `${i + 1}.${c.label}`).join('  ')} → 选 1`);
  run.choose(0);
}
console.log(`    演出${run.ended ? '结束' : '中断'} · 变量 ${JSON.stringify(run.vars)}`);

/* 3. 附件资源:按 fileName 读包内字节,并用 hash 验证内容 */
console.log('\n[3] 附件资源');
if (pkg.assets.length === 0) {
  console.log('    (本包不含资源)');
} else {
  let ok = 0;
  let missing = 0;
  for (const asset of pkg.assets) {
    if (!asset.fileName) {
      console.log(`    - ${asset.name}:无原文件记录`);
      missing++;
      continue;
    }
    const p = join(root, 'assets', asset.fileName);
    if (!existsSync(p)) {
      console.log(`    ✗ ${asset.name}:包内缺 assets/${asset.fileName}`);
      missing++;
      continue;
    }
    const bytes = readFileSync(p);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const match = asset.hash ? digest === asset.hash : null;
    console.log(`    ✓ ${asset.name}(${asset.kind}, ${bytes.length} 字节)${
      match === null ? '' : match ? ' · 内容哈希一致' : ' · ⚠ 哈希不一致'}`);
    if (match === false) process.exitCode = 1;
    ok++;
  }
  console.log(`    共 ${ok} 个可读,${missing} 个缺失`);
  if (missing > 0) process.exitCode = 1;
}

/* 4. 附件挂接:哪些节点挂了哪些资源 */
const owners = Object.entries(pkg.attachments ?? {});
if (owners.length > 0) {
  console.log('\n[4] 附件挂接');
  const assetById = new Map(pkg.assets.map((a) => [a.id, a]));
  for (const [ownerId, ids] of owners.slice(0, 10)) {
    const where = pkg.index.nodes[ownerId];
    const label = where ? `节点 ${ownerId}(流程 ${where.flowId})` : `对象 ${ownerId}`;
    console.log(`    ${label} → ${ids.map((id) => assetById.get(id)?.name ?? id).join('、')}`);
  }
}

console.log(`\n=== ${process.exitCode ? '验收未通过' : '验收通过:仅凭包内文件即可加载、演出并读取附件'} ===`);
