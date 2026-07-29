# R19 运行时事件协议 v2

## 目标

v2 让宿主引擎不必从演出文本反推当前剧情位置。TypeScript 与 Godot 运行库对每个叙事节点依次产生 `enter`、`display`、`leave` 三个事件，同时继续保留 v1 的 `onBeat` / `beat_added`、`log` 和常用演出字段。

引擎包顶层声明：

```json
{
  "schema": "theloom-package",
  "schemaVersion": "1.1.0",
  "runtimeProtocolVersion": 2
}
```

## 事件结构

```ts
interface RuntimeEvent {
  protocolVersion: 2;
  sourceProtocolVersion: number;
  event: 'enter' | 'display' | 'leave';

  flowId: string;
  flowTechnicalName?: string;
  nodeId: string;
  nodeTechnicalName?: string;
  path: string[];
  nodeType: string;

  kind: string;
  title: string;
  text: string;
  speakerId?: string;
  speakerName?: string;
  note?: string;

  fields: { label: string; value: string; type?: string }[];
  assetIds: string[];
  edgeId?: string;
  choiceKey?: string;

  changes: {
    variables: { name: string; before: boolean | number | string | null; after: boolean | number | string | null }[];
    entities: {
      entityTechnicalName: string;
      field: string;
      before: boolean | number | string | null;
      after: boolean | number | string | null;
    }[];
  };
}
```

`path` 是从流程根到当前容器的剧情片段节点 ID 栈。根层节点为 `[]`，片段中的节点为 `["片段节点 id", ...]`。

## 生命周期与变化归属

- `enter`：节点开始处理。经入边执行的 `effect` 变化归入目标节点的 `enter.changes`。
- `display`：节点本身执行完成。指令节点造成的变量和实体属性变化归入 `display.changes`。
- `leave`：节点已完成求值并把控制权交还给选择或下一节点。首批不在此阶段修改状态，因此变化数组为空。

对白等需要宿主展示的节点仍会产生旧版 beat。没有可见 beat 的空汇聚点也会产生完整的 v2 生命周期事件。

## 稳定选项键

- 边关联文档选项时：`choiceKey = FlowEdge.choiceId`。
- 其他边：`choiceKey = "edge:" + edgeId`。
- 多起点或片段内入口：`choiceKey = "start:" + nodeId`。

`edgeId` 保留实际经过的流程边；多起点没有边，因此只提供 `choiceKey`。

## 兼容策略

- v2 包：`sourceProtocolVersion = 2`，附件、自定义字段和稳定选项键按包内容输出。
- v1 包：顶层没有 `runtimeProtocolVersion` 时按 `sourceProtocolVersion = 1` 加载；缺失附件与字段补为空数组，边选项键退化为 `edge:<edgeId>`。
- v1 宿主：继续只监听 `onBeat` / `beat_added` 并读取 `log`，无需消费新事件。
- 旧存档：缺少 `choiceKey` 时，TypeScript 运行库按边 ID 或目标节点 ID 确定性补齐。

## API

TypeScript：

```ts
const run = new FlowRuntime(pkg, 'flow_technical_name', {
  onBeat: renderBeat,
  onEvent: handleRuntimeEvent,
});
```

Godot：

```gdscript
var run := TheLoomRuntime.new(pkg, "flow_technical_name")
run.beat_added.connect(_on_beat)
run.event_emitted.connect(_on_event)
```

Godot 契约测试：

```bash
godot --headless --path examples/godot-demo --script runtime_v2_test.gd
```

## R19-2 跨流程调用

### 数据

流程可声明命名入口:

```json
{
  "id": "callee", "name": "被调方", "technicalName": "callee",
  "entries": [{
    "key": "front",
    "nodeId": "k1",
    "label": "正门",
    "params": [{ "name": "who", "type": "string" }, { "name": "bonus", "type": "number" }]
  }]
}
```

`jump` / `call` 节点的 `data`:

| 字段 | 含义 |
|---|---|
| `targetFlow` | 目标流程技术名或 id;空 = 装饰性节点,照常走出边 |
| `targetEntry` | 目标入口 key;空 = 目标流程默认起点(唯一无入边节点) |
| `args` | `[{ name, expr }]`,按目标入口的 `params` 逐个绑定 |
| `returnVar` | 仅 `call`:接收返回值的变量名 |

`return` 节点的 `data.returnExpr` 是返回值表达式,留空 = 只返回不带值。

### 语义

- `call` 压栈并绑定实参;`return` 或走到无出边处弹栈,回到调用点继续走出边。
- `jump` 切流程但**不压栈**,目标流程走完即结束。
- **参数是真局部作用域**:进入时保存被覆盖变量的原值,弹栈时还原;原本不存在的参数变量在返回后删除。
- 返回值写入调用方 `returnVar`。与参数同名时返回值胜出(先还原参数,再写返回值)。
- 实参求值:`boolean` 走条件求值、`number` 走数值表达式、`string` 取字面量(避免把普通文案当标识符)。未传实参用入口声明的 `default`,再空则取类型零值。
- 目标流程或入口不存在时**降级为装饰性节点**并在 `note` 里说明,不抛错、不中断演出。
- 调用深度上限 32 层,超过就地停下,避免无限递归爆栈。

### 存档

快照增加 `flowId`(当前所在流程)与 `callStack`。旧存档缺失这两个字段时,按入口流程 + 空栈恢复。

调用帧结构:

```ts
interface RuntimeFrame {
  flowId: string;     // 返回点所在流程
  path: string[];     // 返回点的容器 path
  nodeId: string;     // 调用节点自身,弹栈后从它的出边继续
  returnVar?: string;
  savedParams: { name: string; value: VarValue | null }[];  // null = 原本不存在
}
```

### 四处实现的一致性

| 实现 | 跨流程处理 |
|---|---|
| `src/runtime/player.ts`(TS 运行库) | 完整调用栈 |
| `src/modules/flow/Player.tsx`(编辑器演出) | 完整调用栈,标题显示当前所在流程 |
| `examples/godot-demo/theloom_runtime.gd`(Godot) | 完整调用栈,与 TS 共用 `runtime_v2_fixture.json` 对拍 |
| `src/simulate.ts`(路径遍历) | **局部建模**:带目标的 jump 与 return 终止本地路径,call 假设会返回。因为 auditProject 会对每个流程各跑一次,跟进会重复计数并让成本随调用图爆炸 |

前三者必须逐条同步;`simulate.ts` 的差异是有意为之,代价(检测不到"被调流程永不返回")留给 R19-4 场景化回归测试。
