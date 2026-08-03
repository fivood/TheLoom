# TheLoom · Godot 4 演出示例

用 Godot 4 直接读取 TheLoom 引擎包并按编辑器语义演出对白流程。**不需要任何插件、C# 或第三方依赖**,一份 GDScript 就够了。

## 快速开始

1. 用 Godot 4.2+ 打开 `examples/godot-demo/`(选择「Import Project」→ 选目录 → Import & Edit)
2. 按 F5 运行 —— 应该看到「TheLoom Godot Demo · 雨夜示例 · 种子 42」标题,下方是滚动日志与选项按钮

## 用真实项目替换示例

`sample_package.json` 是最小演示;换成你从 TheLoom 应用「工具 → 引擎包 .zip(游戏引擎)」导出的 zip 内的 `theloom-package.json` 即可:

```
examples/godot-demo/
├─ project.godot
├─ main.tscn
├─ main.gd
├─ theloom_runtime.gd
└─ sample_package.json    ← 替换这个文件
```

要切换到别的流程,修改 `main.gd` 里 `flow_ref` 的取法,或用技术名精确指定:

```gdscript
_runtime = TheLoomRuntime.new(pkg, "第一章")     # 用中文名或技术名
```

## 运行库 API

`theloom_runtime.gd` 定义了 `class_name TheLoomRuntime`,是一个 `RefCounted`,可以在任何脚本里 `new` 出来用:

```gdscript
var run := TheLoomRuntime.new(package_dict, "flow_technical_name_or_id")
run.seed_val = 42                          # 可选:固定随机种子
run.beat_added.connect(_on_beat)           # 每条演出记录会触发信号
run.event_emitted.connect(_on_event)       # v2 节点生命周期与状态变化
run.start()                                # 开始;有多起点时会先出现选项
while not run.ended and run.choices.size() > 0:
    run.choose(0)                          # 按下标选一个;通常来自玩家 UI
```

**关键属性**

| 属性 | 类型 | 说明 |
|---|---|---|
| `protocol_version` | `int` | 当前运行时事件协议版本,固定为 `2` |
| `source_protocol_version` | `int` | 引擎包声明的协议版本;旧包缺省为 `1` |
| `choices` | `Array[Dictionary]` | 当前可选项;每项 `{label, choice_key, node_id, edge_id, effect, once}` |
| `log` | `Array[Dictionary]` | 演出记录;每条 `{kind, title, text, speaker_name, note}` |
| `events` | `Array[Dictionary]` | v2 事件记录;每个节点依次产生 `enter / display / leave` |
| `vars` | `Dictionary` | 变量实时状态 |
| `entity_props` | `Dictionary` | 实体属性(按技术名 → 字段名 → 值) |
| `ended` | `bool` | 是否终止(无出边或走到 exit 顶层) |
| `seed_val` | `int` | 当前种子;`start()` 前修改可复现掷骰 |

**信号**

- `beat_added(beat: Dictionary)`:每产生一条演出记录时触发(顺序等价于往 `log` 追加)
- `event_emitted(event: Dictionary)`:每次节点生命周期事件触发;包含流程与节点定位、子流程路径、说话人、自定义字段、附件资源、触发边 / 稳定选项键，以及变量和实体属性变化

`beat_added` 与 `log` 继续保持 v1 用法。v2 包在顶层声明 `runtimeProtocolVersion: 2`;旧包没有该字段时仍可加载，`source_protocol_version` 为 `1`，缺失的附件和自定义字段按空数组补齐。

## 支持的脚本语法

Godot runtime 的条件 / 指令求值器与 TS 端语义**完全一致**(R20-4 补齐):

- **条件**:`== != === !== > < >= <=`、`&& || !`、三元 `? :`、括号、字面量(数字 / 布尔 / 字符串)、变量名、实体`.`字段
- **`seen("节点技术名")` / `unseen(...)`**:走过判断,技术名解析成节点 id 后查已访问集合
- **指令**:分号分隔的赋值,支持 `= += -= *= /=`;右侧支持完整表达式
- **算术**:`+ - * / %`;`+` 任一侧为字符串时拼接;除零与模零回 0
- **短路求值返回操作数**:`名字 || "无名氏"` 得到的是字符串而不是布尔
- **变量**:项目里声明的全局变量按其类型(boolean / number / string)自动初始化
- **实体属性**:按技术名寻址(如 `linwan.trust`);数字型字段自动数值化

语义由三端共用夹具 `script_fixture.json` 保证,任何一端改动都要跑对拍:

```bash
godot --headless --path examples/godot-demo --script script_conformance_test.gd
```

详见 [docs/ENGINE_PARITY.md](../../docs/ENGINE_PARITY.md)。

## 与其他运行库的一致性

行进语义完全对齐 TS 端 `src/runtime/player.ts` 与应用内演出。同一份引擎包 + 同一种子,Godot 与 Node 演出的选项序列、掷骰点数、变量终值都一致:

- mulberry32 种子 RNG 位模一致
- 2d6 检定 vs 难度、白 / 红检定语义相同(红检定沿用首次结果)
- 无出边逐层回溯 + exit 命名引脚
- fragment 默认引脚 + fallback 遮蔽
- 一次性选项 once + 条件边过滤
- **数值整数归一**:无小数部分的结果一律回落为 int。TypeScript 的 JS number
  序列化后 `1` 就是 `1`,Godot 若留成 `1.0`,引擎拿到的变量终值、事件
  `changes` 与存档 JSON 都会与 TS 不一致(Godot 的 Dictionary 深比较区分
  INT / FLOAT)
- **R19-2 跨流程调用**:命名入口、jump / call / return、参数局部作用域、
  返回值回写、32 层递归保护,与 TS 逐条对应

`runtime_v2_fixture.json` 是 TS 与 GDScript **共用**的协议夹具,两端各写一份
逐条对应的断言。改任一端的行进语义,都要让两端都对着这份夹具重新跑通。

可用 Godot 的无界面模式执行 v2 契约验收:

```bash
godot --headless --path examples/godot-demo --script runtime_v2_test.gd
```

实测通过的版本:Godot 4.6.2-stable(mono)与 4.8-dev1。TS 侧对应断言在
`src/runtime/runtime.test.ts` 的「事件协议 v2」一节,`npx vitest run src/runtime/`
即可执行。

## 授权

MIT。
