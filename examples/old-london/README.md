# 《老伦敦寻人记》· 正式示例(R22-1)

一份把 TheLoom 两条主工作流走通的完整示例项目:同一批内容既是可连续阅读的小说稿,也是可游玩的分支解谜。

> 内容说明:改编自作者本人的同名短篇,维多利亚时代老伦敦背景的寻人谜案。
>
> 作为公开示例,末章的吸血段落已略去(`build.mts` 里那一场的 `skip` 行段)。**原稿 `source.md` 始终保持完整**,不在源文件上做删改 —— 需要恢复只要去掉 skip 再重新生成。除此之外正文一字未动,示例只做结构化。

## 内容一览

| 模块 | 内容 |
|---|---|
| 卷章场景 | 1 卷 4 章 12 场景,约 1.19 万字,带状态 / POV / 地点 / 故事时间 / 情节张力 |
| 实体 | 15 个:5 角色、6 地点、4 物品,主要角色带技术名与自定义字段 |
| 伏笔 | 5 条,全部有埋设与回收(巧克力、唯一联系人、被灌酒、雾化、装死) |
| 角色弧线 | 塞梅尔维斯 5 个阶段,每阶段关联具体场景 |
| 时间线 | 1 轨道 8 个时间点,7 条事件关联到场景与人物 |
| 流程 | 25 节点 28 连线,9 个变量,含子流程、条件、检定、一次性选项 |
| 结局 | 1 个真结局 + 3 个失败结局(电量耗尽、线索不足、错过共振) |
| 回归测试 | 3 条,分别锁定真结局与两个失败分支 |

### 解谜设计

线索与电量构成真正的取舍——瓦伦缇娜的手机每次通信都在掉电:

- 问 0–1 条线索 → 电量够,但定位不到裂缝,**摸错了墙**
- 问 2 条 → 25% 电量 + 2 条线索,**通往真结局**
- 问 3 条 → 线索满但只剩 10% 电量,**她在里面等成薛定谔的血食怪**

这个平衡不是拍脑袋定的:第一版三个结局里有一个永远走不到,是导出前闸门的**路径测试**报「不可达」才发现并调整的。

## 重新生成

正文在 `source.md`,结构定义在 `build.mts`:

```bash
npx tsx examples/old-london/build.mts     # → project/(文件夹格式项目)
npx tsx examples/old-london/verify.mts    # 小说通道验收 → dist/
npx tsx examples/old-london/trace.mts     # 打印流程实际走向(核对回归测试的选择序列)
```

`project/` 是文件夹格式的项目,可以直接用桌面版「绑定项目文件夹」打开,或用 CLI 导出。

## 端到端验收

这份示例的用途是把所有交付通道跑一遍。以下命令全部实测通过:

```bash
# 1. 导出前闸门:脚本 + 高级体检 + 路径测试 + 3 条回归测试
node cli-dist/theloom-cli.mjs export -p examples/old-london/project -c 'Godot 自包含包'

# 2. 导出自包含引擎包(数据 + 运行库 + 校验清单)
node cli-dist/theloom-cli.mjs export -p examples/old-london/project -c 'Godot 自包含包' -o examples/old-london/dist --clean

# 3. 脱机验收:只凭包内文件加载、演出、校验
node examples/engine-demo/selfcontained.mjs examples/old-london/dist

# 4. 小说通道:连续稿顺序、章节编译(md/txt/fdx)、DOCX 两套预设(含重解析自检)、体检、JSON 往返
npx tsx examples/old-london/verify.mts

# 5. 三端一致性:同包同种子(seed 7),TS / Godot / C# 结果必须逐字相同
node examples/engine-demo/demo.mjs examples/old-london/dist/theloom-package.json old_london_case 7
godot --headless --path examples/godot-demo --script old_london_run.gd
dotnet run --project examples/unity-demo/conformance -- --demo examples/old-london/dist/theloom-package.json old_london_case 7
```

### 2026-08-03 实测结果

- 闸门:0 阻断、0 警告,3 条回归测试全过
- 自包含包:7 个文件 SHA-256 全部校验通过,包内运行库演出跑通
- 小说通道:12 场景树序正确、三种编译格式产出正常、两套 DOCX 预设导出后重解析自检通过(投稿稿 237 段 / 编辑审阅稿 262 段)、体检 0 问题、JSON 往返无损
- 三端一致:`battery=10 / clues=3 / beats=12`,TypeScript、Godot 4.6.2、C# 逐字相同
- 浏览器:小说工作区预设生效,连续稿按树序渲染 1.36 万字,伏笔台账 5 条全「已回收」,角色弧线 5 阶段,节奏图按树序出柱,控制台零错误

> 已知环境限制:在无头浏览器里流程画布的**连线不渲染**(节点正常)。应用自带示例在同一环境下同样如此,是该环境不合成帧所致,与项目数据无关——边的有效性由路径测试遍历到全部结局、三端运行库跑通共同保证。

## 产物

`dist/` 由上述命令生成(已 gitignore):

- `theloom-package.json` / `.schema.json` / `theloom-types.d.ts` / `README.md` —— 引擎包
- `theloom-runtime.js` —— 随包运行库
- `checksums.json` / `LICENSES.md` —— 校验清单与授权表
- `老伦敦寻人记-submission.docx` / `-editorial.docx` —— 两套成稿预设
- `老伦敦寻人记.loom.json` —— 完整项目备份
