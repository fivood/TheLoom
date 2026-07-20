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
run.start()                                # 开始;有多起点时会先出现选项
while not run.ended and run.choices.size() > 0:
    run.choose(0)                          # 按下标选一个;通常来自玩家 UI
```

**关键属性**

| 属性 | 类型 | 说明 |
|---|---|---|
| `choices` | `Array[Dictionary]` | 当前可选项;每项 `{label, node_id, edge_id, effect, once}` |
| `log` | `Array[Dictionary]` | 演出记录;每条 `{kind, title, text, speaker_name, note}` |
| `vars` | `Dictionary` | 变量实时状态 |
| `entity_props` | `Dictionary` | 实体属性(按技术名 → 字段名 → 值) |
| `ended` | `bool` | 是否终止(无出边或走到 exit 顶层) |
| `seed_val` | `int` | 当前种子;`start()` 前修改可复现掷骰 |

**信号**

- `beat_added(beat: Dictionary)`:每产生一条演出记录时触发(顺序等价于往 `log` 追加)

## 支持的脚本语法

Godot runtime 内置一个**极简条件 / 指令求值器**,覆盖 TheLoom 项目里最常用的脚本子集:

- **条件**:`== != > < >= <=`、`&& || !`、括号、字面量(数字 / 布尔 / 字符串)、变量名、实体`.`字段
- **指令**:分号分隔的赋值,支持 `= += -= *= /=`;右侧支持完整表达式
- **变量**:项目里声明的全局变量按其类型(boolean / number / string)自动初始化
- **实体属性**:按技术名寻址(如 `linwan.trust`);数字型字段自动数值化

**不支持**(TS 端 R6 AST 有,GDScript 极简版没有):

- `seen("节点技术名") / unseen(...)` 走过判断 —— 需要在导出前静态展开
- 三元运算符 `? :`
- 复杂表达式嵌套(极简 parser 尽力而为,失败时回退到"无法求值 → 保留分支")

如果需要完整脚本,可用 TS 端 `runtime-dist/theloom-runtime.js`(见 `examples/engine-demo/`)。

## 与其他运行库的一致性

行进语义完全对齐 TS 端 `src/runtime/player.ts` 与应用内演出。同一份引擎包 + 同一种子,Godot 与 Node 演出的选项序列、掷骰点数、变量终值都一致:

- mulberry32 种子 RNG 位模一致
- 2d6 检定 vs 难度、白 / 红检定语义相同(红检定沿用首次结果)
- 无出边逐层回溯 + exit 命名引脚
- fragment 默认引脚 + fallback 遮蔽
- 一次性选项 once + 条件边过滤

## 授权

MIT。
