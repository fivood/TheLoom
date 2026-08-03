# 引擎运行库一致性(R20-4)

同一个引擎包、同一个种子,在哪个运行库上跑都必须得到相同的剧情走向、变量终值和掷骰序列。否则「在编辑器里测好的剧情」到了引擎里就不算数。

## 四个实现

| 实现 | 位置 | 用途 |
|---|---|---|
| 编辑器演出 | `src/modules/flow/Player.tsx` | 应用内试跑 |
| TypeScript 运行库 | `src/runtime/player.ts` → `runtime-dist/theloom-runtime.js` | Web / Node / 自研引擎 |
| Godot 运行库 | `examples/godot-demo/theloom_runtime.gd` | Godot 4 |
| C# 运行库 | `examples/unity-demo/TheLoom/*.cs` | Unity(及任意 .NET) |

前三者语义完整对齐。C# 是最小包,当前不含 R19-2 跨流程调用栈(见下表)。

## 脚本语义

三端共用夹具 `examples/godot-demo/script_fixture.json`,逐条比对条件求值、数值表达式与指令终值:

```bash
npx vitest run src/engine/scriptConformance.test.ts                                   # TypeScript
godot --headless --path examples/godot-demo --script script_conformance_test.gd       # Godot
dotnet run --project examples/unity-demo/conformance -- examples/godot-demo/script_fixture.json  # C#
```

覆盖的语义(R20-4 把 Godot 与 C# 补齐到与 TS 相同):

- 字面量、变量、`实体.字段` 寻址
- `seen("节点技术名")` / `unseen(...)` —— 技术名先解析成节点 id 再查已访问集合,技术名不存在时恒为 `false`
- 三元 `? :`(只求值被选中的那一支)
- `&&` / `||` **返回操作数本身**而不是布尔:`名字 || "无名氏"` 要得到字符串
- 宽松相等 `==` / `!=`:同类型直接比,异类型转数值比(`5 == "5"` 为真,`true == 1` 为真)
- 严格相等 `===` / `!==`:类型不同直接 false
- 算术 `+ - * / %`;`+` 任一侧为字符串时拼接;**除零与模零回 0**,不产生 Infinity / NaN
- 一元 `!` 与 `-`
- 数值不取整:`10 / 4` 是 `2.5`。检定技能值、`call` 的 number 实参、`return` 返回值都按小数参与计算 —— 早期 Godot 版 `_eval_number` 返回 `int`,负的小数会因为向零截断而与 TS 分岔

## 行进语义

- 直通节点(汇聚点 / 指令 / 条件 / 出口 / 检定 / 事件)只有一条可用出边时自动前进
- 无出边逐层回溯父流程;`exit` 走父层片段的命名引脚,无命名则走默认引脚
- `fragment` 只走默认引脚;`fallback` 边在有其他可用选项时被遮蔽
- `once` 选项选过即隐藏;边条件求值为 `false` 时过滤
- 检定:2d6 + 技能 ≥ 难度;`checkRed` 只掷一次、结果沿用
- RNG 为 mulberry32,三端位模一致;`snapshot` / `restore` 记录已消耗次数,读档后续掷不漂移
- **数值整数归一**:无小数部分的结果一律回落为整数形态。TS 的 JS number 序列化后 `1` 就是 `1`;Godot 若留 `1.0`、C# 若留 `1.0`,变量终值与存档 JSON 就会与 TS 不一致

## 端到端一致性检查

用同一个示例包与种子把流程演到结束,三端输出应逐字相同:

```bash
# TypeScript(需先 npm run build:runtime)
node -e "…"   # 见下方脚本

# Godot
godot --headless --path examples/godot-demo --script sample_run.gd

# C#
dotnet run --project examples/unity-demo/conformance -- --demo examples/godot-demo/sample_package.json demo_rain_night 42
```

2026-08-03 实测(`sample_package.json` / `demo_rain_night` / 种子 42),三端一致:

- 演出记录 31 条
- 检定 `2d6 = 4+3,技能 3,合计 10 vs 难度 8 → 成功`、`2d6 = 6+5,技能 4,合计 15 vs 难度 12 → 成功`
- 变量终值 `battery=35`、`has_address=true`、`has_floppy=true`、`backup_ready=true`、`position_sent=true`、`delay_noticed=true`,其余保持初值

## 能力对照

| 能力 | TS | Godot | C#(最小包) |
|---|---|---|---|
| 行进语义 / 检定 / 种子 RNG | ✅ | ✅ | ✅ |
| 完整脚本语义(含 seen、三元、严格相等、取模) | ✅ | ✅ | ✅ |
| 存读档(掷骰不漂移) | ✅ | ✅ | ✅ |
| 运行时事件协议 v2(enter / display / leave) | ✅ | ✅ | ❌ 仅 beat 回调 |
| R19-2 跨流程 jump / call / return | ✅ | ✅ | ❌ 按装饰性节点 |
| R19-3 外部事件(continue / ack / value) | ✅ | ✅ | ✅ |

C# 侧的两项缺口在 README 里已明确标注;需要跨流程调用的项目用 TS 或 Godot 运行库。

## 改动纪律

改任何一端的行进或脚本语义时:

1. 先在 `script_fixture.json` 里加用例(它是三端的共同契约)
2. 三端各跑一次对拍,全绿才算改完
3. 端到端检查也要复跑一次 —— 夹具覆盖表达式,端到端覆盖它们组合起来的实际走向
