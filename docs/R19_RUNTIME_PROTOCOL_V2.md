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
