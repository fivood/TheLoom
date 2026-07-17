# 引擎包演出示例(无 React)

证明 TheLoom 引擎包可以在纯 JS 环境(Node / 任意引擎的 JS 运行时)读取并按编辑器语义演出对白流程。

```bash
npm run build:runtime          # 构建独立运行库 → runtime-dist/theloom-runtime.js
node examples/engine-demo/demo.mjs
```

跑真实项目:在应用里「工具 → 引擎包 .zip(游戏引擎)」导出,解压出 `theloom-package.json`,然后:

```bash
node examples/engine-demo/demo.mjs 路径/theloom-package.json 流程技术名 42
```

第三个参数是随机种子:同种子的检定掷骰序列完全一致。

运行库 API 摘要(详见导出 zip 里的 README 与 `theloom-types.d.ts`):

```js
import { FlowRuntime } from './theloom-runtime.js';
const run = new FlowRuntime(pkg, '流程技术名或id', { seed: 42, onBeat: console.log });
run.start();          // run.log 演出记录 / run.choices 当前选项 / run.ended
run.choose(0);        // 选第 1 项
const s = run.snapshot();  // 存档(掷骰进度一并保存)
run.restore(s);            // 读档后续掷不漂移
```
