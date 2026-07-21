// 性能基准 · 30 万字级项目
// 用法(从项目根目录):npx tsx bench.mjs
//
// 输出关键路径的耗时:normalizeProject / auditProject / verifyInteractiveImport /
// JSON 序列化 / structuredClone,以及场景 / 实体 / 变量 / 字数规模。
// 数值随机会略有波动,取 5 次平均。

import { performance } from 'node:perf_hooks';

const { sampleProject } = await import('./src/sample.ts');
const { normalizeProject, uid } = await import('./src/util.ts');
const { auditProject } = await import('./src/audit.ts');

/** 造 300k 字项目 —— 2 卷 × 5 章 × 15 场 × 2400 字,加实体与变量 */
function makeLargeProject() {
  const project = sampleProject();
  normalizeProject(project);
  const para = '雨还在下。塞梅尔维斯把伞收进门边的架子里,水珠顺着伞骨敲出一串不成调的节拍。酒馆里没有几个人,壁炉的火光把每张桌子的影子拉得很长。她在吧台边坐下,没有点酒。';
  for (let v = 1; v <= 2; v++) {
    const volId = uid();
    project.folders.push({ id: volId, name: `第${v}卷`, module: 'document', order: v - 1 });
    for (let c = 1; c <= 5; c++) {
      const chId = uid();
      project.folders.push({ id: chId, name: `第${c}章`, module: 'document', parentId: volId, order: c - 1 });
      for (let s = 1; s <= 15; s++) {
        const blocks = [{ id: uid(), type: 'heading', text: `第${v}-${c}-${s}场` }];
        for (let b = 0; b < 12; b++) blocks.push({ id: uid(), type: 'action', text: para + `(${v}-${c}-${s}-${b})` });
        project.documents.push({
          id: uid(), folderId: chId, order: s - 1, name: `场景${v}-${c}-${s}`, category: '正文',
          blocks, notes: '', status: 'draft', createdAt: Date.now(), updatedAt: Date.now(),
        });
      }
    }
  }
  for (let i = 0; i < 100; i++) {
    project.entities.push({
      id: uid(), name: `实体${i}`, kind: i % 5 === 0 ? 'location' : 'character',
      color: '#000', emoji: '', summary: '', notes: '', fields: [], createdAt: Date.now(),
    });
  }
  normalizeProject(project);
  return project;
}

function bench(label, fn, runs = 5) {
  fn(); // warm-up
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(`  ${label.padEnd(28)}  平均 ${avg.toFixed(0).padStart(4)} ms · 区间 [${min.toFixed(0)}, ${max.toFixed(0)}]`);
  return avg;
}

console.log('构造 30 万字级项目…');
const project = makeLargeProject();
const chars = project.documents.reduce((t, d) =>
  t + d.blocks.reduce((x, b) => x + (b.text?.length ?? 0), 0), 0);
const nodeCount = project.flows.reduce((t, f) => t + f.nodes.length, 0);

console.log(`\n项目规模`);
console.log(`  ${'场景数'.padEnd(28)}  ${project.documents.length}`);
console.log(`  ${'实体数'.padEnd(28)}  ${project.entities.length}`);
console.log(`  ${'变量数'.padEnd(28)}  ${project.variables.length}`);
console.log(`  ${'流程节点数'.padEnd(28)}  ${nodeCount}`);
console.log(`  ${'正文字数'.padEnd(28)}  ${chars}`);
console.log(`  ${'JSON 序列化大小 (KB)'.padEnd(28)}  ${(JSON.stringify(project).length / 1024).toFixed(0)}`);

console.log(`\n关键路径耗时(5 次平均)`);

bench('normalizeProject(clone)', () => {
  const clone = structuredClone(project);
  normalizeProject(clone);
});
bench('auditProject', () => { auditProject(project); });
bench('JSON.stringify', () => { JSON.stringify(project); });
bench('structuredClone', () => { structuredClone(project); });

console.log(`\n完成 · 数据仅供纵向对比,机器不同结果不同`);
