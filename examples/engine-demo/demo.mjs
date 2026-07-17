/**
 * TheLoom 引擎包 · 无 React 演出示例
 *
 * 用法:
 *   npm run build:runtime                          # 先构建独立运行库
 *   node examples/engine-demo/demo.mjs             # 跑内置示例包
 *   node examples/engine-demo/demo.mjs 包.json 流程技术名 [种子]
 *     —— 包.json 是应用「工具 → 引擎包」导出 zip 里的 theloom-package.json
 *
 * 本脚本不依赖 React / 应用代码,只用构建产物 runtime-dist/theloom-runtime.js,
 * 自动遍历:有选项时永远选第 1 项,直到演出结束。
 */
import { readFileSync } from 'node:fs';
import { FlowRuntime } from '../../runtime-dist/theloom-runtime.js';

/** 内置示例:雨夜检定小场景(等价于应用导出的 theloom-package.json 片段) */
const SAMPLE = {
  schema: 'theloom-package',
  schemaVersion: '1.0.0',
  meta: { projectName: '示例', exportedAt: 0, generator: 'demo' },
  variables: [{ name: 'courage', type: 'number', value: '1' }],
  entities: [
    { id: 'e1', name: '林晚', kind: 'character', technicalName: 'linwan', fields: [{ label: 'trust', value: '5' }] },
  ],
  flows: [{
    id: 'f1', name: '雨夜', technicalName: 'rain_night',
    nodes: [
      { id: 'n1', type: 'dialogue', data: { title: '', text: '雨下得很大。', speakerId: 'e1' } },
      { id: 'hub', type: 'hub', data: { title: '' } },
      { id: 'go', type: 'instruction', data: { title: '', text: 'courage += 2; linwan.trust += 1' } },
      { id: 'ck', type: 'check', data: { title: '推门', checkExpr: 'courage', checkDc: 8 } },
      { id: 'win', type: 'dialogue', data: { text: '门开了。', speakerId: 'e1' } },
      { id: 'lose', type: 'dialogue', data: { text: '门纹丝不动。' } },
      { id: 'wait', type: 'dialogue', data: { text: '你在屋檐下等雨停。' } },
    ],
    edges: [
      { id: 'ed0', source: 'n1', target: 'hub' },
      { id: 'ed1', source: 'hub', target: 'go', label: '鼓起勇气推门' },
      { id: 'ed2', source: 'hub', target: 'wait', label: '等雨停' },
      { id: 'ed3', source: 'go', target: 'ck' },
      { id: 'ed4', source: 'ck', target: 'win', sourceHandle: 'success' },
      { id: 'ed5', source: 'ck', target: 'lose', sourceHandle: 'fail' },
    ],
  }],
  assets: [], attachments: {},
  index: { technicalNames: {}, nodes: {}, speakers: {}, assetOwners: {} },
  manifest: {},
};

const [, , pkgPath, flowRef, seedArg] = process.argv;
const pkg = pkgPath ? JSON.parse(readFileSync(pkgPath, 'utf8')) : SAMPLE;
const flow = flowRef ?? pkg.flows[0]?.technicalName ?? pkg.flows[0]?.id;
const seed = seedArg ? Number(seedArg) : 42;

const run = new FlowRuntime(pkg, flow, {
  seed,
  onBeat: (b) => {
    const head = b.kind === 'dialogue'
      ? `【${b.speakerName ?? b.title ?? '旁白'}】`
      : `〔${b.kind}〕${b.title ? ` ${b.title}` : ''}`;
    console.log(`${head} ${b.text ?? ''}${b.note ? `  // ${b.note}` : ''}`.trim());
  },
});

console.log(`=== 演出 · ${pkg.meta.projectName} / ${flow}(种子 ${seed})===\n`);
run.start();

let guard = 0;
while (!run.ended && run.choices.length > 0 && guard++ < 100) {
  const labels = run.choices.map((c, i) => `${i + 1}.${c.label}`).join('  ');
  console.log(`   ▶ 选项:${labels} → 选 1`);
  run.choose(0);
}

console.log(`\n=== 结束 · 变量 ${JSON.stringify(run.vars)} · 实体 ${JSON.stringify(run.entityProps)} ===`);
