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
const run = new FlowRuntime(pkg, '流程技术名或id', {
  seed: 42,
  onBeat: console.log,
  onEvent: (event) => console.log(event.event, event.nodeId, event.changes),
});
run.start();          // run.log 演出记录 / run.choices 当前选项 / run.ended
run.choose(0);        // 选第 1 项
const s = run.snapshot();  // 存档(掷骰进度一并保存)
run.restore(s);            // 读档后续掷不漂移
```

运行库声明 `protocolVersion = 2`。每个节点通过 `onEvent` 依次输出 `enter / display / leave`，事件包含流程与节点定位、子流程路径、自定义字段、附件资源 ID、触发边与稳定选项键，以及本步变量和实体属性变化。原有 `onBeat`、`log` 和 `choices` 保持兼容；旧包没有 `runtimeProtocolVersion` 时会按 v1 数据源确定性补齐。

## 自包含包脱机验收(R20-2)

导出时勾选「资源原文件随包」「运行库随包」「校验清单与授权来源表」，得到的 zip 不再依赖 TheLoom 项目文件夹。解压后用这个脚本验收：

```bash
node examples/engine-demo/selfcontained.mjs <解压后的包目录> [流程技术名] [种子]
```

脚本只读传入的那个目录——运行库、数据与资源字节全部取自包内，不 import 仓库里的 `runtime-dist`。它会依次：

1. 按 `checksums.json` 逐个校验文件 SHA-256；
2. 用**包内的** `theloom-runtime.js` 加载数据并把流程演到结束；
3. 按 `assets[].fileName` 读出附件原始字节，并与 `assets[].hash` 对拍；
4. 列出附件挂接关系（哪个节点挂了哪个资源）。

任何一步失败都以非零退出码结束，可直接接进 CI。
