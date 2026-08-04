/**
 * 走向跟踪器:按给定的选择序列跑一遍示例流程,打印每一步的选项与终态。
 * 用来核对回归测试的 choices 序列 —— 猜的序列必然对不上,得照着实际走向写。
 *
 *   npx tsx examples/old-london/trace.mts [选择序列,如 0,0,0,3,0]
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectFromDir } from '../../src/cli/loadProject';
import { FlowRuntime, type RtProject } from '../../src/runtime/player';

const here = dirname(fileURLToPath(import.meta.url));
const project = loadProjectFromDir(join(here, 'project')).project;
const picks = (process.argv[2] ?? '').split(',').filter((s) => s.trim() !== '').map(Number);

const run = new FlowRuntime(project as unknown as RtProject, 'old_london_case', { seed: 7 });
run.start();

let step = 0;
while (!run.ended && run.choices.length > 0 && step < 60) {
  const pick = step < picks.length ? picks[step] : 0;
  console.log(`[${step}] 选 ${pick} ← ${run.choices.map((c, i) => `${i}.${c.label}`).join('  |  ')}`);
  run.choose(pick);
  step++;
}

console.log('--- 终态 ---');
console.log('最后三条:', run.log.slice(-3).map((b) => b.title || b.text.slice(0, 24)).join(' → '));
console.log('变量:', JSON.stringify(run.vars));
console.log('结束:', run.ended);
