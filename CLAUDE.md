# CLAUDE.md

本文件供 AI 助手(Claude Code / opencode 等)快速进入项目上下文。详细文档见 [README.md](./README.md) 与 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。

## 项目定位

**TheLoom 叙事织机** —— 本地优先的叙事设计工具,面向小说写作与游戏剧本。结构化叙事方法参考 articy:draft,叠加自有模块(头脑风暴、罗琳式表格大纲、故事时间线、资料卡片)。

- 网页版(Cloudflare Pages)+ Windows 桌面版(Tauri 2),黑白灰 UI(浅色 / 深色切换列入 R5-B)
- 数据默认存本地:网页版 localStorage,桌面版可绑定本地文件夹(Obsidian 兼容)
- 多项目槽位、撤销/重做(50 步)、端到端加密的接力式云协作

## 当前工作计划(通往 v1.0 的 R0-R16 路线图,更新于 2026-07-17)

### 命名约定(重要)

- **R0-R16 = 面向 v1.0 的发布批次**,每批对应一个 minor 版本(v0.x.0 或 v1.0.0),是本表的主索引
- 之前 CLAUDE.md 里使用过的「R1-1/R1-2/R1-3/R1-4」是**已归档的批次内小迭代命名**,与新表 R-编号无关,不要混用
- AI/知识库集成分阶段插入:轻量抽取(R3-A)已完成;完整小说项目生成(R5-A)在规划与修订模型稳定后做;互动脚本深度能力(R10-A)在脚本 AST 与体检系统就绪后做

### 当前基线

- 已发布版本:网页 / 桌面 `v0.55.0`(地图 NavigatorTree 树、风暴便签快捷键与实体表格交互升级)
- 当前基线:网页 / 桌面 `v0.55.0`;**路线图 R17→R22 除 R21 外全部完成**,R21(本地化与配音)经用户决定暂缓;Unreal 可选;v1.0.0 留待多轮真实项目测试后
- 后续路线以 `docs/PRODUCT_OPTIMIZATION_ROADMAP.md` 为准(R17→R19 收束为小说 / 游戏两条主工作流),下方 R0-R16 表是历史记录
- 已交付的能力(截至 v0.41.0):
  - **v0.41.0 R22 《老伦敦寻人记》正式示例** ✅ — `examples/old-london/`:原稿 `source.md` + `build.mts` 生成器 → 文件夹格式项目(1 卷 4 章 12 场景 1.2 万字 / 15 实体 / 5 伏笔 / 5 弧线 / 7 时间线事件 / 25 节点解谜流程 / 4 结局 / 3 回归测试);`verify.mts` 跑小说通道验收,`trace.mts` 核对流程走向;端到端串起闸门 → 自包含包 → 脱机验收 → 编译 / DOCX → 三端一致
  - **v0.40.0 R20-4 官方引擎适配** ✅ — Godot 求值器补齐 `seen()/unseen()` / 三元 / `===`/`!==` / `%`,`&&`/`||` 返回操作数,宽松相等同 TS 口径;修掉 `_eval_number` 取整导致的两端分岔;新增 Unity 最小运行库(3 个 .cs,不依赖 UnityEngine / Newtonsoft,纯 .NET 可测);三端共用 `script_fixture.json`(49 条)+ 端到端同包同种子一致性;约定见 `docs/ENGINE_PARITY.md`
  - **v0.39.0 R20-3 CLI 与目录同步** ✅ — `npm run build:cli` → `cli-dist/theloom-cli.mjs`(单文件 ES Module,零第三方运行时依赖);项目读取复用 `projectFromFolderFiles` 不另写解析;目录同步逐文件比 SHA-256 只写变化的,**包内 exportedAt 取项目 updatedAt** 保证输出确定;`--clean` 按 `.theloom-sync.json` 删陈旧文件;退出码 2/3/4/5/6 分流;`--json` / `--watch`;文档见 `docs/CLI.md`
  - **v0.38.0 R20-2 自包含引擎包** ✅ — 打包内容三项(资源原文件 / 运行库 / 校验清单+授权表)随命名配置保存;原文件按内容寻址写入包内 `assets/` 且同字节只写一次,取不到时逐个列出不静默;运行库经 vite 虚拟模块内嵌(`npm run build` 已串 `build:runtime`),产物缺失时禁用选项;`checksums.json` 覆盖除自身外全部文件;`examples/engine-demo/selfcontained.mjs` 脱机验收(校验 → 包内运行库演出 → 附件字节哈希对拍),非零退出码可接 CI
  - **v0.37.0 R20-1 导出配置与基线** ✅ — `EngineExportConfig` 命名配置进项目(流程选择 + 四项规则 + 闸门开关,normalizeProject 清洗);`flowIds` 缺省=全部 / 显式数组=精确(空数组不回落为全部);增量基线按 configId 绑定,桌面写 `engine/baseline-{configId}.json`(Rust 三命令 + 名称白名单)、网页回落 localStorage,支持基线 JSON 导入导出与 R9 旧键升级;`src/engine/gate.ts` 导出前闸门统一跑脚本 / 高级体检 / 路径 / 回归测试,**判定范围取自构建出的包**(范围外流程与文档脚本不阻断),阻断拒绝导出、仅警告需确认、关掉的项列为「未检查」
  - **v0.36.0 R19 引擎运行时闭环** ✅ — **R19-2 跨流程调用**(命名入口 + jump / call / return,参数是真局部作用域进入绑定返回还原,返回值写入调用方变量,32 层递归保护,调用栈进快照);**R19-3 外部事件**(项目级声明 + event 节点,三种等待模式,同步运行库靠「先置 pendingExternal 再通知宿主 + walking 重入保护」实现挂起/恢复,挂起态进快照,演出可填模拟响应);**R19-4 场景化回归测试**(`src/flowTest.ts` 纯逻辑运行器,演出录制成「入口+种子+选择序列+事件响应」,断言结局/变量/节点访问/事件触发,节点与连线覆盖率,流程内容哈希标「受影响」);**R19-5 编辑效率**(安全重命名跟上 targetFlow 与 eventName、复制粘贴跨流程、六向对齐与等距分布、选区封装为片段);**R19-P 体检性能**(路径缓存 + 懒加载)。R19-1 运行时事件协议 v2 — 引擎包 schema `1.1.0` + 顶层 `runtimeProtocolVersion: 2`;TS 与 Godot 运行库对每个叙事节点依次产生 `enter / display / leave`,带流程 / 节点定位、子流程 path 栈、自定义字段、附件 assetIds、说话人、触发边与稳定 `choiceKey`;入边 effect 归目标节点 `enter.changes`、指令节点归 `display.changes`,变量与实体属性都给前后值;v1 beat / log / onBeat 全保留,旧包旧存档缺字段确定性补齐;两端共用 `examples/godot-demo/runtime_v2_fixture.json` 对拍。协议见 `docs/R19_RUNTIME_PROTOCOL_V2.md`
  - **v0.35.0 R18 小说生产闭环** ✅ — 场景按正文块拆分 / 同章合并(迁移批注 / 快照 / 流程 / 大纲 / 时间线 / 弧线 / 伏笔 / 附件 / 修订任务引用);DOCX 成稿导出(投稿稿 + 编辑审阅稿两套预设,正式 OOXML 样式,下载前重解析自检);写作进度工作台(全书 / 卷 / 章 / 场景四级目标 + 今日新增 + 七日趋势,删字不倒扣、撤销与导入不制造虚假新增);修订任务(快照差异冻结 + 逐项接受 / 保留 / 待议,只存结论不覆盖正文)+ 本地中文校对
  - **v0.34.0 R17 场景权威主轴与创作工作区** ✅ — 文档文件夹显式标记卷 / 章 / 小节(不再靠名字猜),错误嵌套进体检;场景成为大纲行与时间线事件共同引用的权威对象,改名移动自动同步,删除前展示跨模块影响;顶栏「返回上一位置」+「最近访问」;小说 / 互动叙事 / 通用三套工作区排序
  - 以下为 R0-R9 历史交付(R10-R16 的细节见下方路线图表与各「最近变更」小节):
  - **v0.23.0 R9 通用游戏引擎导出** ✅ — 带版本 JSON Schema 的引擎包(zip:数据 + Schema + .d.ts 类型 + README);导出规则(选流程 / 剥布局注释 / 仅引用实体资源);技术名与节点定位等四类索引;内容哈希清单 + 增量包;独立运行库 theloom-runtime(零依赖 ES Module,语义与 Player 一致);examples/engine-demo 无 React 演出示例
  - **v0.22.0 R8 资源原文件闭环** ✅ — 原文件按 SHA-256 内容寻址存储(桌面 `assets/asset-{hash16}.{ext}` / 网页 IndexedDB);播放与下载;视频首帧缩略图;哈希去重;替换保引用;缺失徽标 + 重新定位;删除不吞字节 + 显式孤儿清理;授权字段;绑定文件夹时 IndexedDB 原文件自动落盘
  - **v0.21.0 R7 演出与路径测试** ✅ — 种子化 RNG(mulberry32,同种子掷骰可复现);演出存档/读档(全部运行态 + RNG 快进,本机);节点断点(自动前进暂停,本机);变量监视高亮 + 实体属性;`simulateFlow` 批量路径遍历(确定性枚举 + 合流剪枝,报告覆盖率/不可达/死循环/卡死,可点击跳节点)
  - **v0.20.0 R6 脚本语言重构** ✅ — 自有 lexer/parser/AST/类型检查/解释器(`src/script/`),不再动态执行字符串;错误精确到字符区间;指令支持实体属性读写;ScriptInput 高亮+诊断+补全;变量/实体技术名/字段名/节点技术名重命名联动
  - **v0.19.0 R5-B 深色主题切换** ✅ — 浅色 / 深色 / 跟随系统三态(`theloom-theme-v1` 本机持久化,不入项目);语义色令牌全收敛 + 深色变量表;React Flow colorMode 响应式;内容色不改写、渲染层按亮度反色;防白闪 head 脚本;Tauri 标题栏同步;深色下侧栏加深为 #161413 + logo 反白
  - **v0.18.0 R5-A 完整项目导入(小说版)** ✅ — 多材料(类型+可信度标注)→ 项目生成计划(用户审阅)→ 分模块候选数据 → 完整差异预检 → 单次事务导入;覆盖卷章树/场景文档/实体/关系/弧线/伏笔/大纲/时间线/资料备份/待定设定/风暴板/地图占位;不生成游戏机制
  - **v0.17.0 R5 正文修订系统** ✅ — 批注(块级锚定 + 解决状态)、场景快照(每篇 20 个上限 + 恢复可撤销)、版本差异(行级 LCS 对比)、修订轮次(元数据 + 列表筛选)、全局查找替换(跨文档、勾选精确替换、单步撤销)
  - **v0.16.0 R4 小说规划增强** ✅ — 规划模块六视图:关系图(React Flow 浮动边)、角色弧线、伏笔台账(状态推导)、登场统计矩阵、场景卡片墙(章内拖拽排序)、节奏图(字数 + 张力);`Document.tension` 场景元数据
  - **v0.15.0 R3-A 外部知识库 + AI 抽取(轻量)** ✅ — 可切换 LLM 层(OpenAI 兼容/Anthropic/Ollama,Key 仅本机);长文抽取实体/场景/时间线走预检通道;实体 AI 补字段(只填空白)
  - **v0.14.0 R3 文档—流程双视图** ✅ — 选项结构双向同步(doc choices ↔ hub 出边,连线自动绑定);`flowToDocument` 剧本视图;条件/指令双向映射
  - **v0.13.0 R2 长篇正文工作台** ✅ — 卷/章 = 文档文件夹树;场景元数据(状态/字数目标/POV/地点/故事时间);连续稿模式(树序连读 + 就地编辑);30 万字实测流畅
  - **v0.12.0 R1 统一叙事数据模型** ✅ — `NarrativeUnit` 权威内容对象 + `syncNarrativeUnits` 迁移/同步器;文档块与流程节点经 `unitId` 共享同一份内容,双向同步
  - **v0.9.0 R0 工程安全基线** ✅ — 测试框架、恢复面板、损坏隔离、诊断导出、大项目性能兜底、桌面项目文件原子替换
  - **v0.10.0 附加批** ✅ — 全模块 Navigator(五模块统一)+ 文件夹归档 + 对话框统一 + 拖拽 / 多选 / 批量
  - **v0.11.0 附加批** ✅ — 长篇写作块(subheading / quote / list,无损往返)+ Excel .xlsx 与 Final Draft .fdx 双向互通(带 ImportPreview 预检)+ 配色表系统(zimg JSON 集成)+ 实体宽版编辑窗 + 文件夹 md 往返修复
- 最近验证(2026-07-29,v0.36.0 发版全门禁):`npx tsc -b` 通过、`npx vitest run` **63 文件 443 项通过**、`npm run build` 与 `npm run build:runtime` 通过、`cargo test --lib` 3 项通过、`node examples/engine-demo/demo.mjs` 演出输出正确、Godot 4.6.2-stable 与 4.8-dev1 用同一份协议夹具对拍通过
- **性能基线**(`npx tsx bench.mjs`,151 场景 / 109 实体 / 15.9 万字 / JSON 743 KB):normalizeProject(clone) 13 ms · **auditProject 冷 990 ms / 热 1 ms / 仅结构 2 ms** · JSON.stringify 3 ms · structuredClone 6 ms
  - R19-P 起 `simulateFlow` 有内容哈希缓存(`src/pathCache.ts`),基准必须冷热分开看,否则量到的是缓存命中
  - auditProject 的成本 99% 来自全项目 `simulateFlow`;体检面板已改为 `includePaths:false` 秒开 + 异步补齐
  - 缓存键只含真正参与遍历的输入(流程 / 变量 / 实体 id、技术名、字段 label+value+type)。**新增会影响遍历的输入时必须同步扩键**,否则会错误命中 —— `src/pathCache.test.ts` 有 9 项守这条

### R10 执行顺序(已完成,历史记录)

1. **v0.23.1 文件夹模式稳定性小批**:✅ 已随 v0.24.0 发布
2. **R10-1 · 统一问题模型**:✅ audit、脚本诊断和路径测试已收敛为稳定 ID + 来源 + 严重级别 + 范围 + 导航目标;体检支持按严重级别筛选
3. **R10-2 · 高级体检**:✅ 覆盖跨模块无效引用、悬挂附件所有者、全项目路径结构、角色 / POV / 地点类型一致性与同时间点角色冲突;支持严重级别和问题范围筛选
4. **R10-3 · 组合查询**:✅ 支持对象类型、全文、文件夹、属性名 / 值、标签、文档状态和结构化引用状态组合筛选;结果显示引用计数并可跨模块跳转
5. **R10-4 · 保存查询与回归**:✅ 查询可命名保存、更新、套用、重命名和删除;旧项目迁移、文件夹 project.json 保留、5000 对象性能基线、浏览器交互与完整回归均通过

R10-A 详细设计见 `docs/R10A_AI_ASSISTANT.md`:模型只拥有白名单只读工具,修改必须形成带基线指纹的结构化提案,在项目副本上经过脚本 / 引用 / audit / path 验证与用户预览后单次 `commit`。

### R10-A 执行顺序(已完成,历史记录)

1. **R10-A1 · 安全内核**:Provider 能力、JSON Schema 结构化输出、取消 / usage / 错误分类;显式上下文与字符预算;结构化提案、dry-run 和过期保护
2. **R10-A2 · 只读助手与自然语言查询**:✅ 统一面板、本机会话、带对象引用问答、自然语言 → `ProjectQuery` → 本地执行 → 可选保存
3. **R10-A3 · 脚本与问题修复**:✅ `ProjectIssue` → 白名单修复提案(`generateFixProposal`:模型只产出 summary + 操作,信封 / 指纹本地构建);体检行「AI 修复」一键进入助手「修复提案」任务;差异预览 + 逐项勾选重验 + 警告需显式确认 + 单次 commit 一步撤销;dry-run 的 audit 差异已覆盖脚本类型检查与全项目路径测试,新增脚本错误 / 卡死 / 死循环 / 不可达一律 blocked 不显示应用按钮
4. **R10-A4 · 叙事分析**:✅ 五类分析(路径覆盖 / 人物声音 / 设定一致性 / 伏笔台账 / 节奏与登场);统计先由本地算好(`src/ai/analysis.ts` 复用 simulateFlow / auditProject / planning 层),模型只负责解读;结论分事实 / 推断 / 创意建议三栏,事实必须引用来源(analysis_data 块或项目上下文,可点击跳转),模型标事实但无有效依据时本地降级为推断并打「未给依据」标
5. **R10-A5 · 完整互动项目生成**:✅ 项目导入向导新增「互动游戏剧本」类型(分支密度 / 目标结局数 / 检定开关 / 失败回路配置);计划阶段产出变量与结局清单供审阅;生成阶段在 R5-A 内容结构上叠加流程(hub 选择 / 条件 / 指令 / 检定 / fallback,BFS 分层自动布局,id 重映射 + 技术名消歧);`verifyInteractiveImport` 在克隆项目上 audit 前后对比(issueKey 与 A3 dry-run 同口径,覆盖脚本 error / 悬挂引用 / 卡死 / 死循环 / 不可达)+ 每个结局 simulateFlow 可达断言;blocked 不显示导入按钮,只能调整后重新生成
6. **R10-A6 · 收尾**:大项目性能与成本基线、隐私、取消 / 离线恢复、浏览器 / Tauri、主题 / 键盘与发布回归

R11 完整模板与数据库(已完成,v0.26.0 发布)。R11-1 ✅ 命名模板对象(`src/templates.ts`):`ObjectTemplate`(module entity/node + entityKind/nodeType 默认类别 + parentId 继承,子覆盖父同名字段、环安全);`Entity.templateId` / 节点 `data.templateId` 分配;`migrateTemplateInstances` 实例安全迁移(模板新增字段自动补齐、绝不改写已有值,normalizeProject 与模板编辑 commit 双触发);旧 `entityTemplates`/`nodeTemplates` 加载时自动迁移为命名模板并分配到既有对象后删除旧键;audit 必填 / AI 提案只读与枚举约束改走 `specsForEntity`;实体 inspector 增模板分配下拉;实体 md frontmatter 往返 `templateId`。R11-2 ✅ 模板扩展与管理器:`TemplateModule` 增 asset/document/map,三类对象增 `templateId?`/`fields?`(迁移 / 清理 / specs 全覆盖);inspector 共用 `ObjectTemplateSection`(资源 / 文档 / 地图);文档 `templateId`+`fields` 经 md frontmatter 无损往返;新增 `TemplateManager`(工具菜单)。R11-3 ✅ 收藏夹(NavigatorTree 的 `favoriteMode`)+ 批量编辑(`src/batch.ts` + `BatchEditDialog.tsx`,149 项测试)+ 写作 / 结构 / 连续稿三视图(BlocksEditor 大改)+ 文件夹模式改为可读 Markdown 正文为权威内容。已发版 v0.26.0(补丁 v0.26.2)。

R10-A 全六批已发布为 v0.25.0。R10-A6 收尾要点:AI 抽取模态与完整项目导入向导补取消按钮(AbortSignal 传入 chatComplete,`已取消 / cancelled / aborted` 归类为 cancel 提示);README 补 AI 隐私说明(凭据、发送范围、绝不擅自修改、可切换服务商、可取消);30 万字级 auditProject ~1.3s、verifyInteractiveImport ~3.3s,深色主题下 AI 助手、导入向导与所有面板正确渲染。R10-A5 实现要点:`src/ai/interactiveImport.ts`(计划 / 生成扩展、normalize 宽容修复 condition/check 缺失引脚、`buildInteractiveImportPreview` 复用 R5-A 预检并叠加流程 / 变量 / 结局、验收闭环);向导 `interactive` 分流;新项目槽位默认流程与生成流程可能重名,按 technicalName 定位。R10-A3 实现要点:`src/ai/fixAssistant.ts`(提案生成)、`src/ai/panelBus.ts`(体检 → 助手的任务通道)、`AiAssistantPanel` 修复任务 UI、`AI_FIX_OPERATION_SCHEMAS` 从提案 schema 拆出复用;路径安全依赖 auditProject 内置的全项目 simulateFlow(不要另加重复的路径校验层)。

### 路线图 · 通往 v1.0(按顺序开发,一批一 minor)

| # | 版本 | 主题 | 主要工作 | 完成标准 | 规模 |
|---|---|---|---|---|---|
| ~~R0~~ | ~~v0.9.0~~ | ~~工程安全基线~~ | ~~测试 / 迁移器 / 大项目性能 / 完整性检查~~ | ✅ 已完成(实际交付于 v0.9.0,内容对齐) | M |
| ~~R1~~ | ~~v0.12.0~~ | ~~统一叙事数据模型~~ | ~~叙事单元对象 / unitId 引用 / 迁移器~~ | ✅ 已完成(NarrativeUnit + syncNarrativeUnits,详见「最近变更」) | L |
| ~~R2~~ | ~~v0.13.0~~ | ~~长篇正文工作台~~ | ~~卷/章/场景树 / 连续稿 / 场景元数据~~ | ✅ 已完成(详见「最近变更」;30 万字实测通过) | L |
| ~~R3~~ | ~~v0.14.0~~ | ~~文档—流程双视图~~ | ~~选项/条件/指令双向映射 / 剧本视图~~ | ✅ 已完成(详见「最近变更」) | L |
| ~~R3-A~~ | ~~v0.15.0~~ | ~~外部知识库 + AI 抽取(轻量)~~ | ~~LLM 层 / 长文抽取预检 / AI 补字段~~ | ✅ 已完成(详见「最近变更」) | M |
| ~~R4~~ | ~~v0.16.0~~ | ~~小说规划增强~~ | ~~人物关系图;角色弧线;伏笔台账;章节登场统计;场景卡片墙;节奏图~~ | ✅ 已完成(详见「最近变更」) | M |
| ~~R5~~ | ~~v0.17.0~~ | ~~正文修订系统~~ | ~~批注 / 修订轮次 / 文档快照 / 版本差异 / 全局查找替换~~ | ✅ 已完成(详见「最近变更」) | M |
| ~~R5-A~~ | ~~v0.18.0~~ | ~~完整项目导入(小说版)~~ | ~~多材料 / 生成计划 / 完整预检 / 事务式导入~~ | ✅ 已完成(详见「最近变更」) | L |
| ~~R5-B~~ | ~~v0.19.0~~ | ~~深色主题切换~~ | ~~三态切换 / 本机持久化 / 语义色令牌 / 全模块适配~~ | ✅ 已完成(详见「最近变更」) | M |
| ~~R6~~ | ~~v0.20.0~~ | ~~脚本语言重构~~ | ~~解析器 / AST / 类型检查 / 属性读写 / 高亮 / 补全 / 重命名联动~~ | ✅ 已完成(详见「最近变更」) | L |
| ~~R7~~ | ~~v0.21.0~~ | ~~演出与路径测试~~ | ~~存档 / 种子 / 断点 / 监视 / 路径遍历~~ | ✅ 已完成(详见「最近变更」) | M |
| ~~R8~~ | ~~v0.22.0~~ | ~~资源原文件闭环~~ | ~~落盘 / 播放 / 缩略图 / 哈希去重 / 替换 / 缺失重定位 / 授权字段~~ | ✅ 已完成(详见「最近变更」) | M |
| ~~R9~~ | ~~v0.23.0~~ | ~~通用游戏引擎导出~~ | ~~JSON Schema / 导出规则 / 引用索引 / 增量导出 / 类型生成 / 独立运行库~~ | ✅ 已完成(详见「最近变更」) | L |
| ~~R10~~ | ~~v0.24.0~~ | ~~高级体检与查询~~ | ~~脚本类型错误;无效引用;孤立节点 / 循环 / 时间冲突 / 角色一致性;保存查询~~ | ✅ 已完成(统一问题模型 + 高级体检 + 组合查询 + 保存查询) | M |
| **R10-A** | **v0.25.0** | **🆕 AI 智能助手(深度)** | 消费 R6 AST → AI 生成 / 改写脚本即时校验;消费 R10 体检结果 → AI 修复方案一键 apply;自然语言 → 保存查询;演出路径分析建议;人物一致性诊断;完整互动剧本生成配置 | AI 建议全部通过类型 / 结构检查后才允许 apply;互动项目生成的变量、条件、指令与分支通过脚本和路径检查,不产生"跑不通"的输出 | L |
| ~~R11~~ | ~~v0.26.0~~ | ~~完整模板与数据库 + 写作工作台~~ | ~~模块化模板 / 分配 / 继承 / 迁移;资源 / 文档 / 地图套模板;收藏夹 (NavigatorTree.favoriteMode);批量编辑 (BatchEditDialog);写作 / 结构 / 连续稿三视图~~ | ✅ 已完成(v0.26.0 首发,v0.26.2 补丁) | L |
| ~~R12~~ | ~~v0.27.0~~ | **暂缓(2026-07-17)** — 用户决定 Localization 与 VO 往后放,后续需要时再重新排入路线图 | — | — | — |
| ~~R13~~ | ~~v0.28.0 / v0.29.0~~ | ~~专业导入导出~~ | ~~TXT / MD / EPUB / DOCX / MOBI / AZW3 导入 + 章节编译 + Excel / FDX 往返~~ | ✅ 已完成(PDF 明确跳过) | L |
| ~~R14~~ | ~~v0.30.0~~ | ~~地图与工作区增强~~ | ~~地图图层 / 四种形状 / 跨模块总览 / 网页分屏~~ | ✅ 已完成 | M |
| ~~R15~~ | ~~v0.31.0~~ | ~~引擎接入 · Godot~~ | ~~Godot 4 GDScript runtime + 示例工程~~ | ✅ Godot 已完成;Unity / Unreal 可选,未排期 | M |
| R16 | v0.32.0 / v0.33.0 | **稳定性** | 存储管理、使用指南、自动快照、应急恢复、无障碍首批、性能基线、升级迁移测试 | 🔶 R16-1~R16-5 已交付;**v1.0.0 尚未发布**,留待多轮真实项目测试后 | L |
| R17-R20 | v0.34.0+ | **两条主工作流收束** | 详见 `docs/PRODUCT_OPTIMIZATION_ROADMAP.md` | ✅ R17→R20 全部完成;下一批 R21 本地化与配音 | L |

### 关于 AI / 知识库集成的设计准则

- **不建议单独一批做完** — AI 集成的天花板取决于项目基础设施,按能力成熟度分阶段插入:
  - **R3-A(v0.15.0,轻量)** 只写"内容"不改"结构":AI 抽实体 / 场景 / 时间点后走已有的 ImportPreview 通道,用户确认才 apply。放在 R3 双视图之后,因为需要稳定叙事单元
  - **R5-A(v0.18.0,完整小说项目)** 消费 R2-R5 的正文、规划与修订模型:多份材料先形成可审阅的项目生成计划,再完整预检并事务式导入;小说配置以文档为权威,流程只表达线性情节结构,不得无依据生成变量 / 条件 / 分支
  - **R10-A(v0.25.0,深度 / 互动剧本)** 消费 R6 AST + R10 体检系统:AI 生成 / 改写脚本要能被类型检查即时校验;AI 修复方案基于结构化的体检结果,一键 apply;完整互动项目的变量 / 条件 / 指令 / 分支还必须通过路径检查。放在 R10 之后,否则 AI 建议要么无法验证要么无从触发
  - **R12 / R13 · 内嵌不单独成批** — 翻译辅助属于 L10n 工作流一部分;DOCX / PDF 反向解析属于导入器一部分
- **R13 进度**:已随 v0.28.0 发布首批。R13-6 ✅ MOBI / AZW3 导入 —— `src/interop/mobiImport.ts` 零第三方依赖(浏览器 / 桌面通用),解析算法同步自 autopage(BSD-3)最新 Rust 实现:PalmDB 容器、按 extra_record_data_flags 剥记录尾部(Calibre 口径反向 varint)、PalmDoc LZ77 与 HUFF/CDIC 双解压(HuffCdic 位流用 BigInt 读 u64 窗口)、MOBI6+KF8 合订(BOUNDARY 取 MOBI6 段)与纯 KF8 检测、EXTH 503/100 书名作者、声明 cp1252 用映射表 / 其余走 decodeTextFile 启发式;正文按 `<mbp:pagebreak>` 切章 → 复用 `xhtmlToChapter`(epubImport 已导出),无结构大部头(≤2 章且 >3 万字)退回纯文本走 TXT「第X章」正则二次切分;5 本真实 mobi 实测(73 万字 246 章 ~0.6s、马伯庸 41 章、英文小说 25 章、EXTH 元数据全对);测试 7 项(合成 MOBI6 夹具:无压缩 / 多记录 / PalmDoc / EXTH / 坏文件报错 / BOUNDARY / 文本兜底)。R13-5 ✅ 章节编译 —— `src/interop/chapterCompile.ts`(纯逻辑,`compileDocuments(project, {format, documentIds, includeFolderPath})` 返回 `{content, mime, extension, docCount, totalWords, documents}`;按 `linearizeByFolders` 顺序拼接;md/txt/fdx 三种格式,md/txt 用 `# 卷 · 章 / ## 场景` 标注路径,fdx 每篇前插 `Scene Heading = 卷 · 章 · 场景`)+ `src/components/ChapterCompileDialog.tsx`(工具菜单入口:按卷/章分组勾选,整组半勾三态、实时统计选中文档数/字符数/输出大小、下载文件名 `${项目名}-编译.${扩展名}`)。测试 6 项(顺序 + 过滤 + 三种格式输出 + 空选择兜底)。R13-4 PDF 已明确跳过。R13-3 ✅ DOCX 导入 —— `src/interop/docxImport.ts` 复用 zip.ts + xmlLite.ts,遍历 `word/document.xml` 的 `<w:p>`(段落)/`<w:pStyle>`(样式)/`<w:r>`/`<w:t>`(文本 run)/`<w:br>`/`<w:tab>`;层级映射 Title→projectName、Heading1→卷、Heading2→章、Heading3+→场景,Subtitle 作场景内子标题;`docProps/core.xml` 可选提取 title/creator 补充 projectName/author;走 `ParsedManuscript` 出口,ImportPreview 复用同一预检 UI(测试 5 项覆盖三级标题拆分 / Title 单卷 / br+tab 合并 / 无 heading 兜底 / 缺失 document.xml 报错)。R13-2 ✅ EPUB 导入 —— `src/interop/xmlLite.ts`(极简 XML/XHTML SAX 扫描器,零第三方依赖,浏览器/Node 同源;支持命名空间前缀、HTML 实体、数字实体、CDATA)+ `src/interop/epubImport.ts`(container.xml → OPF → spine → 按 XHTML 抽段落;h1 作章标题,h2..h6 切场景;跳过 script/style/nav;linear=no 跳过);走 R13-1 的 `ParsedManuscript` 出口,`ImportPreview` mode='manuscript' 复用整套预检 UI(测试 6 项覆盖两章 EPUB / h2 切场景 / spine 顺序 / OPF 子目录 / 嵌套 section / 缺 container.xml 报错)。R13-1 ✅ 长稿导入(TXT / Markdown)—— `src/interop/textEncoding.ts`(BOM / 严格 UTF-8 / CJK 得分启发式,支持 GBK/GB18030/Big5/Shift-JIS,GBK 回退用于 Windows 中文 md;编码检测算法移植自 autopage BSD-3-Clause)+ `src/interop/manuscriptImport.ts`(MD 按 `#/##/###` 三级 + `---` 分隔线;TXT 按中文「第X卷/章/节」正则和 `Part/Chapter N` 拆卷/章/场景;frontmatter 提取标题作者;代码围栏内 `#` 不当标题;normalizeVolumes 兜底空场景);`applyManuscript` 写入卷/章两级文件夹树 + 场景独立文档(status=outline, 分类=导入稿件),只新增不覆盖,Ctrl+Z 一步撤销;`ImportPreview` 新增 `mode='manuscript'`(卷章场景数 + 目录预览 + 警告),App 工具菜单新入口。测试 292 项通过。

- **R13 参照实现:autopage 项目**(`G:/ebook reader/autopage`),它已有完整的 EPUB / PDF / MD / TXT / HTMLZ / MOBI 加载器,可作为 R13 的起点:
  - `src/lib/functions/file-loaders/{epub,pdf,md,txt,htmlz,mobi}/` 各含 `extract-*` + `generate-*-html` + `load-*` 三段式(约 60–620 行/格式)
  - EPUB / HTMLZ 是 zip 打包的 XHTML,可复用本项目 `src/interop/zip.ts`(无第三方 zip)+ 浏览器原生 `DOMParser`,预计要引入 `fast-xml-parser` 或用 DOMParser 替代
  - PDF 依赖 `pdfjs-dist`(含可选 OCR),按需动态 import;autopage 的 `load-pdf.ts` 已含 618 行完整实现和 OCR 挂钩
  - MOBI 是二进制 PalmDB,~263 行手写解析,无第三方依赖
  - 迁移时保持"零第三方 zip / xlsx / fdx 解析"约束(除 PDF/EPUB XML 解析器外);解析结果走 `ImportPreview` 预检通道,不绕过既有合并管线
- **LLM 服务应可切换**(OpenAI 兼容 API / Anthropic / Ollama 本地):本地优先的项目不能强制走某家云;API Key 存 localStorage 或桌面 keychain,不同步到云端
- **AI 输出必须走已有的合并通道**(ImportPreview、体检修复 apply、脚本校验),不建立独立的"AI 直接写项目"路径
- **提示词模板与调用记录**留在项目内可导出,便于用户自建 prompt 库

### 完整项目导入分型(R5-A / R10-A)

- 共用管线:多来源采集 → 来源类型与可信度标注 → 证据片段索引 → 项目生成计划 → 分模块候选数据 → 引用 / ID / 顺序一致性校验 → 完整差异预检 → 单次事务 apply;不允许单次提示词直接生成并覆盖整个 Project JSON
- **小说 / 非游戏剧本(R5-A)**:正文和场景文档是权威内容;优先生成卷章目录、资料原文备份、实体、关系、角色弧线、伏笔、大纲、时间线、场景元数据、地图和风暴板;候选设定、互相冲突的方案与 AI 建议必须显式标为待定并保留来源
- **互动游戏剧本(R10-A)**:在共用内容结构上增加流程节点、选择、技术名、变量、条件、指令、实体属性读写与 fallback;生成结果必须经过 R6 类型检查、R7 路径遍历和 R10 高级体检才能落库
- 项目类型由用户明确选择,默认根据来源给出建议但不得静默切换;允许“小说为主,附带互动实验”这类混合配置,各模块仍按对应规则校验

### 深色主题实施注意事项(R5-B)

- 先把背景、表面、边框、正文、次要文字、选中、危险、阴影等硬编码颜色收敛为语义 CSS 变量,再做主题切换;不得逐组件复制一套深色样式
- 提供“浅色 / 深色 / 跟随系统”三态;主题偏好属于本机界面设置,不写入 Project、不参与云同步,首次使用默认跟随系统
- 项目配色表是内容数据,切换主题不得改写颜色值;仅在渲染层为低对比颜色提供描边、文字反色或可读性提示
- 覆盖 React Flow、规划关系图、节奏图、地图、风暴板、富文本编辑器、弹窗、菜单、滚动条、表单控件与桌面标题栏;网页版和 Tauri 共用前端令牌,桌面窗口背景同步主题避免启动白闪
- 增加主题偏好单元测试与关键界面浅 / 深色浏览器巡检;完成标准包含刷新、重启和系统主题变化后的状态验证

### 后续增强(独立小批,不阻塞主线)

- 矢量地点编辑
- ~~演出 / 流程节点内直接播放挂接的音视频资源~~ —— **明确不做**(2026-08-15 决定)。产品专注文本流程(写作 / 游戏剧本 / 剧本导入引擎),音视频在 TheLoom 里只是「挂接物」:记录节点与资源的对应关系并交给引擎,播放由引擎负责。据此已删除 `fileToVideoThumb`(视频首帧封面,39 行);资源库里的 `<audio>` / `<video>` 预览保留,那是确认「挂对了文件」的手段,不是播放集成
- Localization UI 文案层(与 R12 项目内容本地化解耦,可先做)

### UX 评估待办(2026-08-20 全量走查,A / B / C 全部修复)

A 级四项已修复(v0.54.1,见「最近变更」);B 级七项与 C 级五项已修复(v0.54.2):

- ~~B1~~ MOBI/Excel 功能在 v0.51.0 已刻意移除,采「删文案」:拖拽遮罩 / HelpPanel / 导入长稿 tooltip / README 的 MOBI · Excel 字样全部清除
- ~~B2~~ HelpPanel 快捷键表改为「Alt+↑↓ 文档编辑器里上下移动当前块」
- ~~B3~~ BlocksEditor 斜杠菜单放宽到全部文本块(`SLASH_MENU_TYPES`:paragraph/action/dialogue/subheading/heading/quote/note;choice/condition/instruction/list 编辑器不走 handleTextKey 故排除)
- ~~B4~~ `immersive.ts` 选项块渲染 ▸ 选项行(不再只显示提示语),回写按序沿用 choice id,纯文本可按「提示语 + ▸ 行」新建选项块;删光 ▸ 行只改提示语、选项静默保留
- ~~B5~~ `StaticBlock` 增 `compact` prop:连续稿(StaticScene)里条件 / 指令收成「◇ 条件 / ⚡ 指令」小签,完整表达式进 title 悬停;结构视图仍显示全文
- ~~B6~~ DocumentView 写作模式去掉工具栏右侧快捷键提示,只留底部栏一条(信息更全)
- ~~B7~~ 地图 inspector 空态的地图级字段上加「地图属性」标题

**C 级 · 体验摩擦(v0.54.2)**
- ~~C1~~ 新增轻量 toast(`src/toast.ts` + `ToastHost`,右下角,3.5s / 带操作 6.5s 自动消失):JSON 备份 / 章节编译 / 引擎包与增量 / 长稿与 fdx 导入 / 存储清理的成功反馈全部改 toast;大纲删行与时间线删事件从 confirmDialog 改为「执行 + toast 带撤销」(接全局 undo)
- ~~C2~~ FlowEditor 画布变化只在 position / remove / add / replace 时标 dirty;select / dimensions 不再回写,fitView 与缩放控件不再触发全项目保存(实机探针确认:视图操作 0 次写盘,拖节点仍保存)
- ~~C3~~ 流程工具栏「导出剧本 / 查看为剧本 / 路径测试」与文档工具栏「导入长稿 / 成稿导出」各收进一个 ⋯ 溢出菜单(复用 tools-menu 样式,Esc / 点外关闭)
- ~~C4~~ 顶栏工具菜单加 `tools-menu-main` 类,≥700px 视口两列 grid(分组标签整行),高度从贴底降到约 545px
- ~~C5~~ 新增 `FdxExportDialog`:导出 Final Draft 前按流程 / 文档分组勾选(组级半勾三态 + 全选 / 清空),替换原先的全项目一把梭直导

暂不扩展多人同时协作;当前已有的接力式云协作维持现状,优先完成单人小说 / 游戏剧本工作流。

### 小说项目资料

- `.codex-import/`、`imports/`、`scripts/` 当前是用户长篇《未归档报告》的导入产物与整理脚本,属于用户资料,保持未跟踪状态
- 不得把上述目录加入产品代码提交,不得删除、覆盖或批量改名;产品提交必须显式列出文件,不要使用笼统的 `git add .`
- 已生成 `imports/未归档报告-TheLoom.json` 与文件夹项目 `imports/未归档报告-TheLoom/`;后续导入前先运行现有校验脚本并阅读 `VALIDATION.md`
- 原始 Obsidian 目录位于 `C:\Users\fukki\OneDrive\Documents\Obsidian Vault\1999\长篇-未归档报告`;只有在用户要求继续整理小说时才读取或更新,不要把原始资料当作测试夹具

### 实施注意事项

- `folderId?` 与 `order?` 已存在于 `Flow` / `Entity` / `Asset` / `Document` / `ResearchCard` / `Folder`;新增可归档对象时同步更新类型、`normalizeProject`、`removeFolder`、存储往返和 `NavigatorTree` 的 `onMove` / `onReorder`
- 实体 / 资料 / 文档的 `folderId` 与 `order` 写入 Markdown frontmatter;资源 / 流程保留在 `project.json`;文件夹树本身保存在 `Project.folders`
- 删除文件夹只删除目录结构,所有受影响对象必须回到"未分组",不得级联删除正文或资源
- `normalizeProject` 已清理失效、跨模块、自引用和循环文件夹关系,并剔除非法 `order` 值;不要取消这层旧项目 / 损坏项目保护
- `NavigatorTree` 当前接收筛选后的对象列表,因此目录计数反映当前类型 / 分类 / 标签 / 搜索条件;修改时保持这个语义一致
- 跨模块搜索跳转到实体、资源、资料或文档时,先清空会隐藏目标的筛选和搜索词,再选中目标
- 所有原生 `prompt` / `confirm` / `alert` 已替换为 `src/dialog.ts` 的应用内弹窗;新增交互需要输入 / 确认时一律用 `promptText` / `confirmDialog` / `alertDialog`,不要再引入原生对话框
- `NavigatorTree` 支持拖拽(对象 → 文件夹移动、文件夹重父 / 重排、对象在同级重排)、Ctrl/Shift 多选与批量归档;五个模块(流程 / 实体 / 资源 / 文档 / 资料)共用同一组件,FlowEditor 已不再自带树
- 所有项目数据修改必须经过 store 的 `commit`,保证撤销栈、恢复点与持久化正常;不要直接修改 zustand state
- **zustand selector 必须返回稳定引用** —— 这是本项目反复踩中的头号陷阱,后果是无限重渲染并触发崩溃边界:
  ```ts
  // ✗ 每次都是新数组 / 新对象 → zustand 判定状态变化 → 无限循环
  const events = useLoom((s) => s.project.externalEvents ?? []);
  const done  = useLoom((s) => s.project.documents.filter((d) => d.status === 'done'));
  // ✓ selector 只选原值,派生放到外面(必要时用模块级常量兜底 + useMemo 派生)
  const NO_EVENTS: ExternalEvent[] = [];            // 模块级,引用恒定
  const events = useLoom((s) => s.project.externalEvents) ?? NO_EVENTS;
  const docs   = useLoom((s) => s.project.documents);
  const done   = useMemo(() => docs.filter((d) => d.status === 'done'), [docs]);
  ```
  `?? []`、`.filter()`、`.map()`、对象字面量在 selector 里一律禁止。**类型检查与单元测试都发现不了这类问题**(R19-3b 时 406 项测试全绿但流程编辑器一打开就崩),只有浏览器实测能挡住 —— 改动 selector 后务必到浏览器点一遍受影响模块
- 每批至少运行:`npm test`、`npm run build`;涉及桌面文件夹存储时再运行 `cd src-tauri && cargo test --lib`;界面改动需实际检查受影响模块
- 未经用户明确要求,不要推送 tag、移动版本标签或发布安装包;发布前更新版本号(package.json / tauri.conf.json / Cargo.toml 三处 + `cargo check --lib` 刷新 Cargo.lock)、`RELEASE_NOTES.md` 并确认桌面更新清单
- 新增外部依赖(尤其是运行时依赖)前请先评估能否用浏览器原生 API 手写;当前项目坚持零第三方 zip / xlsx / fdx 解析(见 `src/interop/`),接入 LLM 时也应保留可切换后端(OpenAI 兼容 / Anthropic / Ollama)以维持本地优先

## 最近变更(v0.62.1 转场块与预设感知块名)

补上 v0.62.0 列的两个缺口:

- **新增 `DocBlockType` 的 `'transition'`**。加一个块类型要动的地方比想象多,清单在此(漏一个就是静默丢内容):`types.ts` 三处(联合 / `DOC_BLOCK_LABEL` / `DOC_WRITING_TYPES`)、`BlocksEditor`(编辑器 + MORE_TYPES)、`StaticBlock`、`export.ts`、`immersive.ts` **双向**、`storage.ts` **双向**、`chapterCompile.ts`、`docxExport.ts`(顺带加了右对齐的 Transition 样式)、`fdx.ts` **双向**、`revision.ts`
- **`revision.ts` 与 `storage.ts` 的 switch 是穷尽的**,漏了会编译报错;其余带 default 的地方不会报错,只会静默把转场块渲染成空 —— 靠 `'quote'` 全局 grep 逐个核对
- Markdown 表示 `*→ CUT TO:*`(文件夹模式靠 `loom:block` 注释恢复类型,可读性优先);沉浸模式是 `→ CUT TO:` 单行
- **FDX 的 Transition 此前导入成 `note` 块**(`[转场] …`),现在双向对应,`.fdx` 往返不再降级
- **`docBlockLabel(preset, type)`**(`workspace.ts`):剧本 / TRPG 下 heading 显示「场景标题」。`BlocksEditor` 里 11 处 `DOC_BLOCK_LABEL[...]` 全换成局部 `blockLabel(...)`
- 测试:storage 往返(断言 md 里确实是 `*→ …*`)+ immersive 往返(断言块 id 不变);合计 675 项
- 未做:`writingProgress` 的 `BODY_TYPES` 不含转场(「淡出」不该算进正文字数)

## 最近变更(v0.62.0 四套新预设:剧本 / 设定集 / 纪实 / TRPG)

预设 3 → 7。**关键是没有让 `isNovel` 判断继续增殖**:

- **`WORKSPACE_PRESETS` 常量 + `typeof [number]` 派生联合类型**(`types.ts`),`normalizeProject` 的白名单改为读这个常量 —— 以后加预设不会漏掉校验
- **`PRESET_TRAITS: Record<WorkspacePreset, { prose, game }>`**(`workspace.ts`):`prose` 决定收起块结构按钮 / 隐藏游戏块类型 / 提供写-改-理阶段;`game` 决定落点是流程。原先散在 BlocksEditor / DocumentView / Planning / App 的四处 `workspacePreset === 'novel'` 全部换成 `isProsePreset(...)`,新增预设只填这张表
- **`presetHomeTab(preset)`**:打开项目的落点与首层顺序解耦(小说首层是风暴但落点是正文;设定集落设定集,纪实落资料)。**注意 `theloom-last-tab` 记忆优先**,落点只在首次进入生效
- **「理」阶段重排改为通用规则**(`PLAN_FIRST` 提到最前 + 其余保序),删掉 `NOVEL_PLAN_TABS` 硬表 —— 四套散文型预设自动都有
- **剧本预设的常用块换成 `heading / action / dialogue`**。`slashTypes` 必须取**并集**(`[...new Set([...commonTypes, ...COMMON_TYPES, ...moreTypes])]`)—— 第一版按预设替换后,正文段落在剧本预设里彻底选不到了(导入的稿子里有 paragraph 块就没法改类型),浏览器实测才发现
- 剧本预设的正文 ⋯ 菜单加「导出 Final Draft」(`toolBus` 新增 `'fdxExport'`)
- `workspace.test.ts` 加一条:**每个预设的 `presetHomeTab` 必须在自己的首层导航里**,且首层无重复 —— 防止以后改 tab 数组把落点改到「其他」区里
- 已知缺口(未做):剧本没有「转场」块类型,`DOC_BLOCK_LABEL` 也不随预设改名(剧本作者看到的仍是「场景锚点」)。要补的话是块类型层的改动,单独一批

## 最近变更(v0.61.0 写 / 改 / 理 三档写作阶段)

预设此前只有一条「题材」轴(小说 / 互动 / 通用),而同一部小说在初稿 / 修订 / 构思三个阶段要的界面并不同。新增**与题材正交的阶段轴**,能力全部复用现成的:

- **`src/stage.ts`**:`WritingStage = 'write' | 'revise' | 'plan'`,zustand 小 store(同 `toolBus` 惯例)+ localStorage `theloom-stage-v1`。**不进 Project** —— 台式机改稿、笔记本写初稿是合理状态,存进作品反而要处理迁移与同步冲突
- **`workspace.ts` `primaryTabsFor(preset, stage)`**:只有 `novel + plan` 换顺序(大纲 / 时间线 / 规划优先),其余原样返回。`workspacePrimaryTabs` 加可选 stage 参数保持旧调用
- **改**:`DocumentView` 工具栏出现 查找替换 / 存快照 / 版本差异,属性栏自动展开。查找替换经 `toolBus` 新增的 `'findReplace'` 请求交给 App(FindReplace 是 App 级状态)
- **理**:`setMode('structure')`
- **删掉 v0.60.0 的 `theloom-doc-inspector-v1`** —— 属性栏开合改由阶段决定,两处偏好并存必然打架
- `workspace.test.ts` 加一条:**plan 的模块集合 = write 的集合 + timeline**,守住「阶段只重排、不增删模块」这条(预设 / 阶段一旦开始 gate 数据,用户会以为自己丢了内容)
- 实测三档的导航顺序 / 工具栏 / 属性栏 / 正文视图逐项对上,阶段刷新后保持,通用预设下开关消失

## 最近变更(v0.60.0 写作界面减负)

用户反馈:「作为纯小说写作的工具还是不太顺手,多余的按钮在写小说时会影响输入」。四层干扰逐层收掉,**全部按 `workspacePreset === 'novel'` 分流**,互动 / 通用预设一行不动:

- **块侧栏**:`BlocksEditor` 容器加 `doc-blocks-novel` 类;小说下段落块不渲染类型标签(99% 的块是段落,标签是恒定重复),侧栏 `opacity: 0` 直到 hover 或 active。**44px 宽度保留** —— 收掉宽度会让正文在打字时左右跳
- **插入栏**:小说下收成一个 `＋` 折叠菜单(展开是 COMMON_TYPES + moreTypes 全部八种)。去掉 ＋正文 是因为 `handleTextKey` 的 Enter 分支本来就插段落
- **工具栏**:长篇工具与新建分类进 ⋯ 溢出菜单;**分类下拉改为 `categories.length > 0 || catFilter !== 'all'` 才渲染**(这条对所有预设生效 —— 零分类时那个「全部分类」对谁都是噪音)。新增「属性」开关
- **属性栏**:`inspectorOpen` 控制 `<Inspector>` 渲染,存 `theloom-doc-inspector-v1`(本机界面偏好,不入项目);**默认值按预设决定但记住的选择优先**(`saved ? saved === 'on' : !isNovel`)
- **专注模式**:`{(!focusMode || focusNavOpen) && <NavigatorTree`,专注下保留场景列表 + 收起开关。此前专注模式把导航一起藏了,切场景必须先退出,导致它没法当日常写作面用
- **移动端**:`.doc-focus-bar` 的 `COMMON_TYPES` 插入按钮在小说下不渲染(10 → 7 个按钮);`MobileWrite` 顶栏去掉 ThemeToggle(「我的」页仍有)
- 实测(1440×900 与 375×812 各跑一遍):侧栏透明度 激活 1 / 其余 0、工具栏 5 项、属性开关往返持久化、专注模式内切场景正文跟随、Enter 仍插段落、切回 interactive 预设逐项复原、控制台零错误

## 最近变更(v0.54.4 PWA / 移动端走查修复 · 仅网页端)

**A 级:移动壳云同步面板不可用**:RemotePanel 内联宽 560px 超出手机视口、`.palette` 无 `max-width` 兜底且 60vh + `overflow:hidden` 裁掉底部操作区,「我」页唯一跨端入口在手机上完全够不着。修复:`styles.css` `.palette` 加 `max-width: calc(100vw - 24px)`(兜住全部内联固定宽 520–780px 面板)、`.sync-body` 内部可滚(`flex:1; min-height:0; overflow-y:auto`)、`.app-mobile .palette-backdrop/.palette` 改近全屏工作表(padding-top 12px + safe-area、`max-height` 跟随 `--vvh` 键盘变量)。

**联动与体验**:
- `RemotePanel`:拉取确认后先 `createSnapshot('拉取前自动 …')` 再替换 —— 移动端无版本历史入口也无 Ctrl+Z,快照是唯一后悔药;确认文案同步更新;提示区明示远端只有**一个**项目对象(对应当前槽位,换作品覆盖);远端状态附本机上次同步时间
- `MobileMe`「快记」统计改灵感库可见卡片数(原误数风暴板便签;桌面风暴板移动端本不展示)
- `inbox.ts` `saveInbox` 镜像写 IDB(启动 hydration 的 `theloom-*` 缺失补齐逻辑天然覆盖 `theloom-inbox-v1`,localStorage 被清后可从 IDB 恢复)
- `assetSync.ts` `probeRemote` 改 8 路分批并发(原逐条 HEAD 串行,弱网下资源多时探测慢);`assetSync.test.ts` 补跨批次回归
- `App.tsx`:Onboarding 加 `!mobileShell` 门控 —— 桌面引导按钮 `setTab` 在移动壳无可见效果,空弹一次徒增困惑
- `MobileWrite` last-doc 键改 `theloom-mobile-last-doc:{slotId}`,多项目切换不再把场景位置记串;「归位」effect 依赖补 `currentSlotId`
- 云房间时代残留文案清理:PwaBanner iOS 提示、`pwa.ts` 头注释、`vite.config.ts` NetworkOnly 注释、AiPanel 密钥说明统一改外链网盘口径
- 验证:`npm test` 587 项通过,`npm run build` 通过(PWA 产物正常);browser-use 实机点验:移动壳激活 / Onboarding 不弹 / 面板几何(`maxHeight = vvh − 24px`)与底部按钮在视口内 / IDB 镜像生效 / 快记计数正确 / last-doc 槽位键格式正确

## 最近变更(v0.54.3 品牌图标全新替换 + 发版复查修复)

**图标替换**:`logo_theloom.svg`(512×512 全彩织机 + 白色圆角底)成为唯一图标源 → `public/logo.svg`(favicon / 顶栏);`scripts/gen-icons.mjs` 重写(去掉单色重着色与 `#eceae6` 铺底,直接按 density 栅格化;maskable 缩到 78% 安全区四周填白);重新生成 PWA 192/512/maskable + apple-touch-icon + 根目录 `app-icon.png`(1024);`npx tauri icon` 重新生成 `src-tauri/icons/` 全套 57 个文件(ico / icns / PNG / StoreLogo / iOS / Android)。

**发版复查(v0.54.1/0.54.2 回归风险审计)发现并修复**:
- 沉浸写作**空提示语选项块往返丢选项**(v0.54.2 B4 引入):渲染成纯 ▸ 行后 `parseMarkdown` 把第一个选项误吞为提示语,2 选项变 1。修复:全 ▸ 行按「无提示语选项块」解析(`immersive.ts`),补 3 条回归测试;触发条件是空提示语选项块 + 沉浸模式任意敲键(每次输入全量回写)
- `useEscape` 栈序隐患:effect 依赖含 `onEscape` 闭包,下层弹层重渲染会把回调重新 push 到栈顶抢 Esc。修复:回调存 ref、栈条目稳定化、依赖收窄为 `[active]`
- toast 撤销隐患:原走全局 `undo()`,删除后 6.5s 内又做别的操作会撤错对象,且 800ms 合并窗口可能连前一步一起回滚。修复:删除前 `structuredClone` 快照 + 记位置,「撤销」经 `update` 插回原位(id 去重);Ctrl+Z 兜底仍在
- `sharp` 在 v0.51.0 被移除但 `scripts/gen-icons.mjs` 仍在用(靠 node_modules 残留才能跑):加回 devDependencies
- 审计确认无问题项:FlowEditor dirty 过滤(position/remove/add/replace)、字数口径改 `\S` 计是有意的四处统一
- 验证:`npm test` 586 项通过,`npm run build` 通过;大纲 / 时间线删除 + 撤销 toast 经浏览器实机点验(browser-use)

## 最近变更(v0.54.2 UX 走查收尾)

B / C 级共 12 项一次修完(见 RELEASE_NOTES):删 MOBI / Excel 虚假文案、Alt+↑↓ 快捷键文案修正、斜杠菜单放宽到全部文本块;专注模式选项块渲染 ▸ 行 + 对称回写(B4,后在 v0.54.3 补空提示语边界)、连续稿条件 / 指令收小签、地图 inspector 空态标题;轻量 toast 系统(`src/toast.ts` + `ToastHost`)、大纲删行 / 时间线删事件改「执行 + toast 撤销」、FlowEditor dirty 只在内容变化时标、工具栏溢出菜单、顶栏工具菜单两列、FDX 导出按流程 / 文档勾选范围。`npm test` 583 项通过。

## 最近变更(v0.54.1 UX 评估 A 级修复)

2026-08-20 全量 UX 走查(29 张截图实机点验)确认的 4 个 A 级问题已全部修复,B / C 级见「UX 评估待办」:

- **A1 分屏布局崩坏**:`App.tsx` 分屏两 pane 内容统一包 `.pane-module` wrapper;`styles.css` 在 `.content-pane` 上加 `container-type: inline-size`(沿用 `.side-list` 容器查询先例),新增 `@container (max-width: 1100px)`(侧栏收窄 + 工具栏单行横滚)与 `@container (max-width: 768px)`(三栏纵向堆叠);≤768px 媒体查询选择器改为 `.content-pane > .pane-module > ...`。修复右 pane React Flow 画布空白(容器无尺寸)与文档工具栏竖排挤压
- **A2 字数口径统一**:`util.ts` `documentWordCount` 从原始 `.length` 改为非空白字符(`\S`)计数,与规划默认「含标点字符」口径一致;`audit.ts` 文档行改用同一函数(不再计入 name/notes)。导航 / inspector / 专注模式 / 体检四处同场景同数字(示例场景 257 字);`countWords` 保留给流程 / 大纲 / 资料行与导入预检
- **A3 Esc 行为一致**:`useEscape.ts` 重写为共享栈(window 单监听,多层叠加只关最顶层,修复 Dialog 叠在面板上时一次 Esc 关两层的隐患);`Dialog.tsx` Escape 迁入栈(Enter 逻辑保留);20 余个 palette 面板 + 顶栏工具 / 最近下拉 + ProjectMenu + 专注模式(新增 `onExit` prop)+ 演出模式 + FlowEditor 入口弹窗全部接入
- **A4 流程画布初始视口**:`FlowEditor.tsx` 默认 `fitViewOptions={ minZoom: 0.6, maxZoom: 1, padding: 0.12 }`(只约束 fit 操作,不影响用户手动缩放到 0.15),打开流程即可读
- 顺手修复 Ctrl+\ 副面板 stale closure(`App.tsx` 加 `tabRef`,副面板默认模块跟随当前 tab)
- 验证:全部经 Playwright 实机点验(临时 Chrome profile,不污染真实数据);`npm test` 579 项通过,`npm run build` 通过

## 最近变更(v0.54.0 灵感库 + 开篇动线 + 云房间下线)

**新增 `src/inbox.ts`(跨项目灵感库)**。动机是一个此前没看清的矛盾:捕获(手机快记,
时间序)与梳理(桌面风暴板,空间画布 + 连线)被塞进同一个容器 `project.brainstormNotes`
—— 之前修的「便签堆成一摞」就是这个矛盾的症状。

- 灵感库是**扁平列表**,只有文字与时间,独立存 `theloom-inbox-v1`。不给坐标与连线,
  那是风暴板的职责
- **合并按 id 取并集,不需要冲突判定** —— 收件箱以追加为主。但**删除必须留墓碑**,
  否则会被对端同步回来;测试专门守这条,还有「删除后又在别处编辑则复活」
- `visibleIdeas` 排序对同毫秒写入做了兜底(createdAt 相同会退化成插入序)
- 取用只记 `usedIn` 不删卡片;随外链网盘同步 `inbox.enc`

**风暴板补上出口**:选中便签可转场景 / 大纲行(便签保留)。此前便签是死胡同,而大纲行
↔ 场景的绑定早就有(`OutlineGrid`),所以断的只有第一步。小说预设首层加入 brainstorm。

**下线云房间**(-691 行 + 一个 D1 库):两条通道能力已分叉(灵感库只跟外链网盘走),
单人下原始动机不再成立。

- 删 `sync.ts` / `SyncPanel.tsx` / `functions/api/room` / D1 绑定 / 离线队列
  (`pendingPush` / `refreshSyncState`)/ `online` / `setOnline`
- **`syncError` 不能删** —— 它名字像云房间,实际是**文件夹模式**的保存错误,
  `ProjectMenu` 与 `RecoveryPanel` 都在用。差点误删,逐处 grep 才分清
- 下线前把库中仅有的一条记录导出到 `personal/`(已 gitignore);内容端到端加密
  无法确认是否为联调残留,故留档而非直接丢弃

## 最近变更(v0.53.1 密钥字段可查看 + 手机端接入)

- **`components/SecretInput.tsx`**(输入框 + 眼睛)用于全部密钥字段:外链网盘加密口令与
  Secret Key、云房间口令、AI API Key。**理由是后果不对称**:密钥填错点测试连接立刻 403,
  口令填错毫无反应 —— 照样上传,换台设备才发现解不开且无找回通道。全项目已无裸
  `type="password"`
- `MobileMe` 接入 `RemotePanel`。手机上外链网盘比云房间更有用:无 20MB 上限,
  资源原文件能跟着走(网页端 IndexedDB 附件换设备就没了)
- **`.field-row2` 窄屏堆单列** —— 两列时口令框在 375px 下只剩 122px,再减去眼睛按钮
  等于白加,正好抵消这次改动的意义。桌面 1440px 仍为两列,已实测未受影响

## 最近变更(v0.53.0 外链网盘同步 · S3 兼容)

新增 `src/remote/`,把项目同步到用户自己的 S3 兼容存储。**选 S3 而不是 OAuth 网盘**:
一套代码覆盖 R2 / B2 / MinIO / OSS,网页与 Tauri 共用,无需应用注册与审核;
OAuth 每家要单独接(数百行 + PKCE + 令牌刷新 + 回调协议),三家就是一千多行。

- **`sigv4.ts`**:手写 AWS SigV4(WebCrypto HMAC,零依赖)。**必须有官方向量测试** ——
  签名差一个字节服务端只回 403 且不说原因,没有向量根本无从反推。用了 AWS 文档的
  GET / PUT / LIST 三组示例
- **`s3.ts`**:PUT/GET/HEAD/DELETE + 自检。载荷 ≤5MB 实算 SHA-256,超过走
  `UNSIGNED-PAYLOAD` 省一次全量读取;**404 返回 null 而非抛错**(首次同步时对象本就
  不存在);自检把 403 / 404 / CORS 分开报 —— 浏览器只会抛笼统的 TypeError
- **`src/crypto.ts`**:gzip / base64 / PBKDF2 / AES-GCM 从 `sync.ts` 抽出共用。
  两处各写一份 AES 是最不该出现的重复:实现分岔后同一份稿子在两条通道上解不开,
  且只在真需要恢复数据时才暴露
- **冲突用 ETag 不用时间戳**:对象存储 Last-Modified 只精确到秒,多设备同秒写入
  分不出先后;ETag 是内容指纹。**已知边界**:HEAD 与 PUT 之间有秒级窗口,同时推送
  仍可能后覆盖前;彻底杜绝要 `If-Match` 条件写入,R2/MinIO 支持但非所有实现都支持
- **`assetSync.ts`**:资源按内容寻址存 `assets/{hash}.{ext}`,天然幂等去重、无冲突;
  **不需要清单文件**,要拉哪些由解密后的 `project.assets` 直接得出
- 测试 27 项(签名向量 6 / S3 客户端 7 / 同步 9 / 资源计划 5)。**写测试时踩的坑**:
  vitest 是 node 环境没有 `localStorage`(afterEach 里调 clear 会把整个文件带崩);
  HTTP 头值只能是 latin1,拿中文当 ETag 造数据无效;换桶会改 URL 路径导致 404,
  测不出密钥作用域,要直接测派生函数

**尚未做**:自动同步(现有 `sync.ts` 的 pendingPush 机制可复用)。先等真实桶跑通再接。

## 最近变更(v0.52.0 沉浸写作 + 实体改名设定集)

- **新增 `src/immersive.ts`**:块 ↔ 纯 Markdown 文本。难点不是渲染而是**身份** —— 批注锚在 `blockId`、流程节点靠 `unitId` 与块共享内容,纯文本里没有这些标记(文件夹模式靠 `<!-- loom:block -->` 注释解决,但那不能给用户看见)。方案是**按段落次序重建身份**:第 n 段沿用原第 n 块的 id / type / unitId / speakerId,只换文字;写成块级 Markdown(`#` `>` `-` `1.`)才改类型;多出来的段落建新块
- 对白渲染成「名字：台词」,回写时名字仍对得上就保留 `speakerId` 并剥掉前缀;`action` 不降级为 `paragraph`;`condition` / `instruction` 的表达式原样往返
- **`ImmersiveEditor` 的文本不从 blocks 反推** —— 只在换场景时播种,之后以本地 state 为准。否则每次回写都会重算 value,光标会跳
- `.doc-focus-editor` 原有 `align-items: center`(给分块编辑器居中用),纯文本要 `align-items: stretch` 才能撑满高度
- `immersive.test.ts` 8 项守往返与身份保持;浏览器实测改一段文字后 8 个块的 id/type/unitId/speakerId 与编辑前逐字节一致
- **实体模块改名「设定集」+ 新 `cards` 图标**:模块装五类对象,而小说预设叫「人物」、`entity` 图标画的是人形轮廓(与角色专用的 `user` 同形)。通用 / 互动仍叫「实体」。`navigation.test.ts` 与 `workspace.test.ts` 原本断言「人物」,正确挡住了改名;`OverviewPanel.tsx` 把图标名存在 Record 类型里,grep `name="entity"` 漏掉了,靠 tsc 报出来

## 最近变更(v0.51.0 收窄到文本流程 + 界面修整)

按 `ponytail-audit` 的结论做减法,**净 -3846 行 -1 依赖**(源码 44230 → 41334):

- **AI 完整项目生成**(`ai/projectImport.ts` + `ai/interactiveImport.ts` + `ProjectImportWizard.tsx` + 两份测试 = 2085 行)移出仓库,保留为 **`personal/ai-project-import.patch`**(已 gitignore)。`git apply` 启用 / `git apply -R` 撤掉,用法见 `personal/README.md`。**冻结前验证过 tsc + src/ai 90 项测试 + build 都通过**,并在干净树上走过完整的 apply → 撤销往返
- **全项目 Excel 往返**(`projectXlsx.ts` + 手写 OOXML `xlsx.ts` = 1013 行)、**MOBI 导入**(584 行)、**`sharp`** 依赖(仅 `scripts/gen-icons.mjs` 用,图标已提交)一并删除
- **保留**(用户明确要求):地图模块、DOCX 成稿导出。后者顺带省事 —— `examples/old-london/verify.mts` 依赖它做验收
- **未做**:`Player.tsx` 复用 `FlowRuntime`(-400 行)。这是重构不是删除,「三处行进语义必须手工同步」的隐患仍在

界面部分:

- **`.inspector input/textarea` 的 `width:100%` 只覆盖 `.inspector`**,弹窗的 `.field` 不在其中,textarea 退回默认 cols 宽(约 20 字符)。规则扩到 `.field >` 直接子元素(用子选择器避开内部自带布局的组件)
- **`.toolbar > button`(0,1,1)压过了 `.primary`(0,1,0)**,把所有模块的主按钮染灰 —— 上一批只看了流程页。规则改挂 `.flow-toolbar`
- **侧栏头部改容器查询**:`--pane-nav` 可拖到 170px 而视口仍宽,按视口写的媒体查询不生效。`.side-list` 加 `container-type: inline-size`,`@container (max-width:300px)` 收成纯图标
- **流程节点边框 / 选中描边抵消画布缩放**:`calc(1px / var(--rf-zoom))`,`--rf-zoom` 由 `onInit`/`onMove` 写入。**`box-shadow` 的 spread 不被设备像素吸附,`border-width` 与 `outline-width` 会** —— 所以选中环用 box-shadow 能精确到 1.000px,普通边框只能收敛到 0.81–1.33
- **封装 / 对齐改用 React Flow 的 `<Panel position="top-right">`**:这簇宽度随选中数从 1 个按钮涨到 404px,留在工具栏必然换行导致高度跳动(128→167)

## 最近变更(v0.50.1 深色可读性:快记 + readableInk)

- **`readableInk` 从亮度阈值改为「两种墨色各算一次 WCAG 对比度取高者」**。旧实现 `lum > 145` 在中灰附近选错方向:`#8e8d86`(线性亮度 140.7)判为深底配浅字,实测仅 3.02;改后选深字得 5.18。**亮度必须做 sRGB gamma 展开**(`c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4`),线性加权算出来的数不是对比度
- 新增 `inkContrast(bg)` 供测试与将来体检使用;`INK_DARK` / `INK_LIGHT` 导出为常量
- **测试做了负向验证**:临时把实现退回旧阈值,3 项断言全部失败(含独立实现一遍 WCAG 的「取高者」断言),确认测试真能挡住这个 bug
- **手机快记深色**:便签色是内容数据(四档浅灰白),深色下整块填充是四张惨白的纸。按 R5-B「不改写内容颜色,只在渲染层处理」改为**深色 = 面板底 + 左侧 4px 色条,浅色 = 整块填充 + readableInk**,由 `noteStyle()` 按 `getThemeMode()` 分流。`.m-note-item` 的 CSS 不能再写死 `color: var(--text)`
- 桌面风暴板**保持整块填充**未动 —— 空间画布上颜色即分组,且实测深色下对比度 11.87–17.25 正常

## 最近变更(v0.50.0 界面图形化:emoji 全部改 SVG)

- 全量扫描后共 30 处 UI emoji + 3 处文本产物。`Icon.tsx` 新增 16 个图标(lock/unlock/eye/folderOpen/comment/warn/ban/bolt/gear/star/starFilled/pencil/sparkle/flagCheck/close),JSX 位置一律换成 `<Icon>`
- **三类位置放不了 SVG,只能改文字**:① 字符串字面量(对话框 message、React Flow 的 string 边标签、演出日志 note、选项 label);② `<option>` 内容(HTML 不允许元素);③ 纯文本产物(`export.ts` 剧本导出、`interop/fdx.ts`、`cli/main.ts`)。这些改为文本标注:边标签效果符 `⚡ → ↯`(几何符号是文本呈现,不会被渲染成彩色 emoji)、`⛔ x` → `[断点] x`、`🎲 检定` → `检定 ·`、图层 `🔒/👁` → `(锁定)/(隐藏)`
- **注意 `runtime/player.ts` 也有一处** —— 独立运行库输出的日志不该带 emoji,与 `Player.tsx` 同步改
- Navigator 头部四个按钮(收藏 / 文件夹 / 新建卷 / 新建场景)改 `<Icon> + <span class="btn-label">`,窄屏隐藏 label。**这不只是美化**:原先 `.side-head` 内容宽 339px 而侧栏只有 199px,溢出压住右侧内容;改图标后总宽 140px,`fitsNow` 为真,根本不再溢出
- 验收脚本:`scratchpad/emoji_scan.py` 按码位区间扫源码并区分 UI / 文本产物;浏览器端再用 TextNode 遍历确认渲染后 DOM 里 0 个 emoji

## 最近变更(v0.49.0 手机端大纲 / 时间线可编辑 + 载入示例)

- `MobileBrowse` 从只读改为可编辑:大纲支持建章 / 建剧情线 / 就地改全部字段与各列单元格 / 删章;时间线支持建时间点 / 建轨道 / 在指定时刻加事件 / 改标题描述与所属轨道 / 改时间点名 / 删事件与删时间点(连带其下事件)
- **编辑即时提交**(`updateOutlineRow` / `setOutlineCell` / `update((p)=>…)`),不做「保存」按钮 —— 与 `BlocksEditor` 同惯例,靠 store commit 的 800ms 合并;手机上少一次点击,切走也不丢
- **`TimelineEvent.trackId` 是必填**,项目里一条轨道都没有时新建事件会挂空。`ensureTrack` 在 commit 回调内按需建一条「主线」再返回 id,避免产生孤儿事件
- 时间线没有专用 store action,沿用 `update((p) => …)`,与桌面 Timeline 模块一致
- **`MobileMe` 补「载入示例项目」** —— 载入示例原本只在首次引导页出现,跳过后手机上再无入口,空项目里查阅 / 设定等页只剩空状态文案,用户反馈「没有样例能看」。非空项目走 `newSlot('sample')` 开新槽位,绝不覆盖当前内容(`newSlot` 本就接受 `'blank' | 'sample'`,不必自己拼)

## 最近变更(v0.48.0 手机端查阅:大纲 / 时间线竖排)

v0.47.0 把手机挡在桌面布局之外,代价是流程 / 大纲 / 时间线全都够不着。这一批把其中**查得最多的两个**以竖排只读形态补回来:

- 新增 `src/mobile/MobileBrowse.tsx` + tab「查阅」(移动壳 4 → 5 个 tab,375px 下每个 74px 仍宽裕)
- **大纲**:桌面是 `outlineRows × outlineColumns` 宽表,手机改为一章一卡,`cells` 里**只渲染非空列** —— 否则满屏空标签
- **时间线**:桌面是 `timelineTracks × timelinePoints` 矩阵,手机改为按 `timelinePoints` 顺序竖排(时间点顺序就是作者排好的故事顺序),事件折在时间点下,`trackId` 降为色标,`entityIds` 解析成人名列出
- 色标用 `readableInk(color)` 取反色,与实体点 / 便签同惯例

**发现但未修**:`readableInk` 的阈值 `lum > 145` 对中灰(`#8e8d86`,lum 140.7)判错方向 —— 选了浅字得 WCAG 3.02,而深字本可得 5.25。正确做法是**两种字色都算一遍取对比度高的**,而不是用亮度阈值。这是全应用共用的辅助函数(实体点 / 便签 / 节点色 / 登场矩阵都在用),改动面超出本批,单独排。

**验证提醒**:算对比度必须做 sRGB gamma 展开(`v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)^2.4`)。我第一版用了线性 `(0.2126R+0.7152G+0.0722B)/255`,把 6.78 算成 2.63、把正常的报成不合格,差点去改不该改的东西。

## 最近变更(v0.47.0 手机不进桌面布局)

- **`useIsMobile` 改为按设备短边判定**(`Math.min(screen.width, screen.height) < 820`),不再用 `max-width: 768px` 媒体查询。原因:手机横屏视口宽 852,按宽度判定会掉进桌面三栏布局,而那个布局在 393px 高度里根本没法用。**短边与朝向无关**,横竖屏结论一致。阈值 820 对着 11 寸 iPad 的短边 834;iPad mini(744)归手机
- **副作用(有意为之)**:桌面浏览器拖窄窗口不再变手机壳 —— 屏幕够大就是桌面。窄窗口仍由 ≤768 的 CSS 媒体查询兜底
- **`forceDesktop` / `useMobilePref` 整个删掉**,连同 MobileMe 的「切换到完整版」与顶栏「手机版」按钮。手机上桌面布局不可用,留着入口就是陷阱。**代价:手机上无法访问流程 / 大纲 / 时间线等模块**,这是用户明确的取舍
- **`getSnapshot` 不要缓存** —— 第一版用模块级 `cached` 只在 resize/orientationchange 时更新,结果在不派发 resize 的环境里把过时判定永久锁住(浏览器实测:`computeIsMobile()` 返回 false 而界面仍是手机壳)。返回的是布尔基元,`useSyncExternalStore` 按值比较,本来就不需要缓存 —— **「selector 必须返回稳定引用」那条只针对对象/数组,基元不适用**
- `src/mobile/useIsMobile.test.ts` 8 项守住阈值与朝向语义(含「横屏手机仍走手机壳」这条真实回归)

## 最近变更(v0.46.0 软键盘 / 设定可编辑 / 横屏收口)

第二轮 iPhone 真机回归:

- **新增 `src/mobile/useKeyboardInset.ts`** —— iOS 弹键盘不缩布局视口(`innerHeight` 与 CSS 100% 都不变),吸底元素原地不动被键盘盖住。改为跟随 `visualViewport`:把可见高度写进 `--vvh`(`.app-mobile { height: var(--vvh, 100%) }`),并在 `<html>` 打 `data-kb`,键盘打开时隐藏 tab 栏。`covered > 80` 的阈值用来躲开 Safari 上下工具栏收放的抖动
- **⚠ 首次写入绝对不能放进 `requestAnimationFrame`** —— 页面在后台或无头环境时 rAF 根本不触发,`--vvh` 永远不会被设置。第一版就是这么写的,查了很久:探针显示 `hookCalled/effectRan` 都为 true 而 `rafFired` 为 0。visualViewport 的事件频率本来就不高,直接同步写
- **内容短时 sticky 只把操作条停在最后一个块下面**(屏幕中间悬着一条)。`.app-mobile .m-write-editor` 改 flex column + `> .doc-blocks { flex: 1 0 auto }` 撑满剩余高度把它顶到底;同时去掉之前补的 `padding-bottom: 24px`,否则与 tab 栏之间空一条缝
- **`MobileRef` 从只读改为可增删改** —— 原来必须先在桌面建好实体手机端才有内容,等于废的。现在五类实体可就地新建,点条目改名称 / 简介,带删除确认。字段 / 关系 / 头像仍留在桌面端
- **横屏错位的第二批**:`.side-head` 是 `flex-wrap:nowrap + overflow:visible`,侧栏 200px 而按钮排到 x=314,直接压在右侧内容区上;顶栏 `.saved-hint` 被压成竖排。小屏下侧栏头部与顶栏统一改横向滚动 + `flex-shrink:0`,`.side-list` 加 `overflow:hidden`,`.sidebar` 在矮视口可纵向滚动

**验证方法上的坑**:用 `getBoundingClientRect` 判重叠会把「已被祖先 overflow 裁掉」的部分算成重叠,必须先沿父链求交集算出真实可见矩形再比,否则修好了也显示一堆假阳性。模拟键盘可用 `Object.defineProperty(visualViewport,'height',...)` 再派发 resize。

## 最近变更(v0.45.1 真机回归)

v0.45.0 发布后在 iPhone 真机上实测发现的四处,**都是无头浏览器里没暴露出来的**:

- **`.side-list`(260)与 `.inspector`(320)都是 `flex-shrink: 0`**,中间 `.pane-col` 是唯一的收缩项 —— 852×393(横屏手机)下工具栏只剩 176px,而按钮要 68–116px,`flex-wrap` 把它们摞成一根竖条,CJK 无处不可断行于是逐字竖排。新增 `@media (min-width:769px) and (max-width:1100px), (min-width:769px) and (max-height:520px)`:两侧收窄到 200/240 并允许收缩,`.pane-col` 给 `min-width: 300px`
- **工具栏换行在竖屏上同样致命**(不竖排但高 271px = 32% 屏幕,画布只剩 94px)。所以工具栏的 `flex-wrap: nowrap + overflow-x: auto` 单独用 `@media (max-width:1100px), (max-height:520px)` 覆盖到 768 以下;`.toolbar > *` 必须同时给 `flex-shrink: 0`,否则照样被压扁
- **`.doc-focus-bar` 整条一起横向滚动会把删除按钮推出屏幕**。拆成 `.doc-focus-scroll`(类型+插入,可滚)+ `.doc-focus-actions`(块操作,`flex-shrink:0` 贴右固定)
- **`.doc-slash-menu` 在移动壳内被滚动容器裁剪**(块内 `position:absolute` 向下弹,块靠底时上下两头都被切)。改为 `position: fixed` 吸底面板,`bottom: calc(146px + safe-area)` 让开 tab 栏(57)+ 操作条(80)

**经验**:这四条在 375/393 宽的无头浏览器里全都测不出来 —— 前两条要「宽而矮」的横屏尺寸(852×393)才触发,后两条要真的把菜单打开并量位置。**下次改移动端,尺寸矩阵至少要覆盖竖屏(393×852)、横屏(852×393)与小平板(1024×768)三档**,只测竖屏会漏掉一整类挤压问题。

## 最近变更(v0.45.0 移动端可用性大修)

网页版手机适配的一轮系统性修整。两条会直接卡死写作:

- **MobileWrite 的 `selectedId` 只在挂载时初始化** —— 载入示例 / 切换项目 / 删掉当前场景后 documents 才到位,永远停在「未选择场景」。改为 `doc` 失效时用 `pickFallbackId` 重新归位。场景列表同时从「按 updatedAt 排」改成 `linearizeByFolders` 树序 —— 前者会让当前场景在打字时不断跳到列表顶
- **`variant="focus"` 把插入栏和逐块侧栏一起隐藏了**(`BlocksEditor` 两处 `variant !== 'focus'`),手机上只能改已有块的文字。补 `.doc-focus-bar` 吸底操作条(换类型 / ＋三种常用块 / 上下移 / 删除),复用已有的 `typeMenuBlockId` 菜单
- **iOS 聚焦缩放**:全站输入框 12–15px,iOS Safari 对 <16px 的字段聚焦时强制放大页面且不还原。修在 `@media (pointer: coarse), (max-width: 768px)` 里,**必须用 `!important`** —— `.doc-speaker-row input { font-size: 12px }` 这类组件规则特异性(0,1,1)高于裸 `input`(0,0,1)。双条件是因为粗指针覆盖横屏平板、窄屏覆盖上报 fine 指针的安卓浏览器;桌面鼠标端(>768px 且 fine)完全不受影响
- **「切换到完整版」是单向门**:`toggle()` 只在 `MobileMe` 里调用,而 `MobileMe` 只在移动壳内渲染,切走后开关随之消失,唯一出路是清 localStorage = 删掉网页版的稿子。顶栏补 `.mobile-back-btn`(仅 `isMobile && !isTauri && forceDesktop` 时渲染)
- **新增 `src/brainstormLayout.ts`**:`nextNotePosition` 按网格找空位。**比对的是各便签的真实坐标而不是把它们吸附到格上** —— 示例便签(120,80 等)本就不在格点上,只按格记占用会算出一个离它 190px 的位置,而便签宽 210px,照样叠。桌面 `Brainstorm.addNote` 一并换掉(那里传的是 React Flow 的 `ns`,不是 project,所以入参放宽为 `PlacedNote`)
- **`writingProgress` 接出到移动端**:写作页与「我的」显示今日新增 / 连续天数。新增纯函数 `writingStreak` —— **今天没动笔不算断,从昨天接着数**,否则每天零点后打开都显示 0 天
- 快记补编辑 / 删除 / 搜索(原来是纯 `<div>`,只能新增);写作页加灵感抽屉(点一条插入当前场景末尾)、上下场切换、卷章路径;设定速查加搜索(覆盖名称 / 简介 / 字段值);移动端补云同步与项目切换入口(云房间是手机取稿的唯一通道)
- 触摸目标统一抬到 40px(原顶栏图标 33×25、块内工具 22×19)
- 测试 561 项(新增 `brainstormLayout.test.ts` 7 项 + `writingStreak` 4 项)

**验证环境的两个坑**(下次别再踩):
- 这个无头浏览器的 CDP 视口改写**不派发 `resize` 与 matchMedia `change` 事件** —— 挂探针实测视口 375→1100、媒体查询翻转,探针一条没收到。CSS 会重新求值,JS 监听不会触发,所以 `useIsMobile` 的实时响应(横屏旋转)在这里验不了
- `(pointer: coarse)` 在无头环境为真、`innerWidth` 在面板收起时为 0,单看媒体查询会误判;测移动规则要显式 `resize_window` 到具体宽高再 reload
- store 持久化是防抖的,改完立刻读 localStorage 会拿到旧值;且**多槽位时 `Object.keys().find()` 可能命中的不是当前槽**,要用 `theloom-current-v1` 定位

**仍未修 / 需真机**:软键盘弹出时吸底操作条是否被遮挡(0 处 `visualViewport` 处理);NavigatorTree 的 HTML5 拖放在触摸设备上完全不工作(平板走桌面布局时无法拖动排序)。

## 最近变更(v0.44.1 · v0.44.0 审计修复)

对 `bf951cc..HEAD` 做代码审计,修 7 个问题。核心是 v0.44.0 的缩略图瘦身「剥离无条件、回填有条件」造成的两处永久数据丢失:

- **`stripAssetThumbs` 改为「确认可恢复才剥」** —— `assetFiles.ts` 加会话级 `thumbsInDb: Set<string>`,只有 `storeAssetThumb` 写成功或 `loadAssetThumb` 读到过的哈希才进集合,剥离只动集合内的。无 hash 的旧资源(R8 之前)、写 IDB 失败的、回填未落盘的一律保持内联。**剥离没有回头路** —— 代码里没有任何路径会从原文件重建缩略图(`fileThumb` 只在导入 / 替换 / 重定位三处调用),`storeAssetThumb` 那句「下次从原文件重建」的注释是错的,已改
- **协作密文不再剥缩略图**(`sync.ts`)—— 对端没有本机 IDB 缩略图库,桌面端 `hydrateAssetThumbs` 因 `webdbAvailable() = !isTauri && …` 直接 return,连回填逻辑都不执行。**「个人多设备」不等于安全**:B 设备的 IDB 同样是空的。代价实测可忽略(正文密文 ~30KB vs 缩略图 ~60KB,服务端上限 20MB)
- 新增 `src/sync.test.ts` 守这条。**注意**:测试必须先 `storeAssetThumb` 复现推送方「缩略图已落 IDB」的状态,否则新的 `stripAssetThumbs` 会因「未确认可恢复」直接放行,把剥离加回去测试照样绿 —— 第一版就是这么写的,守不住
- 分屏 `--pane-split` 改 `flex: 0 1` + `max-width: calc(100% - 280px)`;原 `flex: 0 0` 在更窄窗口里会把副面板挤成 0 并把拖拽柄推出视口(实测 1280 视口灌 1500px:副面板 1px、柄右缘 1585)
- `nextAiPrompts` 纯函数:提示词回到内置默认时**必须 `delete extract`**,只是「不写」的话旧值仍随对象展开保留,会反过来遮蔽类型选择且界面上清不掉
- 清理工具接上 `deleteAssetThumbs` + 新增 `listAssetThumbKeys`,缩略图独立参与孤儿扫描(它和原文件字节各自成孤儿)
- 拖入多文件改队列(`importQueue`),原来只取 `files[0]` 静默丢弃其余
- `NODE_GROUPS` / `VIEW_GROUPS` 加 `as const satisfies` + `Exclude` 编译期穷尽断言 —— 手写分组漏掉一个类型原本只会让按钮静默消失;Planning 那处还会因 `VIEWS.find(...)!` 拿到 undefined 崩掉整页
- **多设备同步定位**:桌面之间走文件夹模式 + OneDrive(实测 800 次原子替换零失败、5MB 资源字节一致、文件属性为 `Archive` 非占位符);云房间降级为「只传文本 + 缩略图」给手机 / 网页,SyncPanel 与 README 已写明
### 收尾(v0.44.1 之后)

上面列的两条「已知未修」已完成:

- **离线推送队列改存 IndexedDB**(`sync.ts`)—— 拆成「重负载进 IDB + 轻量标记留 localStorage」。
  拆的原因:`store.ts` 的初始状态与 `refreshSyncState`、`SyncPanel` 的 useState 初始化都是**同步**读取,
  全改 async 会连锁;标记只含 `queuedAt`,同步判断够用。新增 `hasPendingPush()`(同步)与
  `loadPendingPush()`(异步取全量),`queuePendingPush` / `clearPendingPush` 改 async。
  **这里的 IDB 不走 `webdb.ts`** —— 那边 `webdbAvailable()` 对 Tauri 恒假,而桌面版 localStorage 一样有配额,
  队列同样该进 IDB;自带 `theloom-sync` 库,IDB 不可用(隐私模式)时退回旧格式保功能不消失。
  旧格式 `theloom-sync-pending-v1` 作为 legacy 源读取并在下次入队时清除
- **`isIosSafari` 补 iPadOS 13+**(`PwaBanner.tsx`)—— iPad Safari 默认「请求桌面网站」,UA 报 `Macintosh`,
  原来的 `/iPad|iPhone|iPod/` 匹配不到任何现代 iPad,而「7 天不活跃清存储」对 iPad 一样生效。
  改用 `/Macintosh/ && maxTouchPoints > 1` 与真 Mac(触点 0)区分;函数导出成纯函数便于测试
- 合计 vitest 550 项。浏览器实测:localStorage 只剩 27 字节标记、IDB 取回完整项目、顶栏与面板状态联动、
  旧格式队列可迁移、补发后新旧键一起清空

## 最近变更(R22 · v0.41.0)

《老伦敦寻人记》正式示例:

- `examples/old-london/`:`source.md`(作者原稿,一字未改)+ `build.mts`(按行号场景表切分正文、叠加实体 / 伏笔 / 弧线 / 时间线 / 解谜流程)→ `project/` 文件夹格式项目;`verify.mts` 小说通道验收;`trace.mts` 打印流程实际走向
- **生成器不硬编码正文**:场景表用 `{ chapter, title, from, to, skip?, pov, location, time, tension }` 描述,正文按行号从 source.md 取。段落自动分类:`〔发件人…〕` → subheading、`*短信*` → quote、引号段按特征归说话人 → dialogue、其余 → action
- **`skip` 行段**:作为公开示例略去的段落(末章吸血描写)写在场景表里,**source.md 原稿始终完整**,不在源文件上删改;要恢复只需去掉 skip 重新生成
- 解谜数值的取舍(问 2 条线索恰好通关)**是被路径测试逼出来的** —— 第一版 battery 初值 100、最多消耗 50,`battery > 20` 恒真,「电量耗尽」结局不可达,闸门直接报了出来。改成初值 60 后三个结局都可达且互相制衡
- 回归测试的 choices 序列必须照 `trace.mts` 的实际输出写:**hub 的选项随 once 消耗会重新编号**,凭空猜下标必然对不上(第一次写就错了两条)
- 端到端全通:闸门 0 阻断 / 自包含包 7 文件校验 + 脱机演出 / 编译三格式 / DOCX 两预设重解析自检 / 体检 0 问题 / JSON 往返无损 / 三端(TS + Godot 4.6.2 + C#)同种子逐字一致 / 浏览器连续稿 1.36 万字树序与规划各视图正常
- **无头浏览器环境限制**:流程画布的连线不渲染(节点正常),应用自带示例同样如此 —— 该环境不合成帧(截图也一直超时),不是产品缺陷。边的有效性靠路径测试与三端运行库保证
- 注意:`examples/old-london/dist/` 与 `examples/godot-demo/old_london_package.json` 是生成产物,已 gitignore

## 最近变更(R20-4 · v0.40.0)

官方引擎适配(R20 收官):

- **Godot 求值器补齐**(`examples/godot-demo/theloom_runtime.gd`):`seen()/unseen()`(经 `_seen_tech` 走 `_tech_to_id` → `_seen`,技术名不存在恒 false)、三元 `? :`(右结合、只求值选中支)、`===`/`!==`、`%`;tokenizer 加三字符运算符与 `? : %`;`&&`/`||` 改为**返回操作数**;`_loose_eq` 重写为「同类型直接比、异类型转数值比」对齐 TS `looseEq`(`true == 1` 现在为真)
- **修掉真实分岔**:`_eval_number` 原本 `-> int`,`10 / 4` 得 2 而 TS 得 2.5;负小数向零截断更会改变检定成败。现在不截断,`_norm_num` 只把无小数部分的值归一为 int。检定处 `var skill` 也去掉了 int 标注,note 用 `%s` 格式化
- **新增 `src/engine/scriptConformance.test.ts` + `examples/godot-demo/script_conformance_test.gd` + C# 运行器**,三端跑同一份 `examples/godot-demo/script_fixture.json`(49 条:条件 / 数值 / 指令)
- **新增 Unity 最小运行库** `examples/unity-demo/TheLoom/`(`TheLoomJson.cs` 极简 JSON、`TheLoomScript.cs` 求值器、`TheLoomRuntime.cs` 运行库)。**刻意不依赖 UnityEngine** —— 既能拖进 Assets,也能用 `examples/unity-demo/conformance` 这个 net8.0 项目在纯 .NET 下编译测试(本机没装 Unity 也验证得了)。缺口:R19-2 跨流程调用栈、协议 v2 事件,README 与 `docs/ENGINE_PARITY.md` 已标注
- **新增 `docs/ENGINE_PARITY.md`**:四个实现的能力对照、语义清单、三端复跑命令、改动纪律(改语义先加夹具用例,三端全绿才算完)
- 已实测:三端脚本对拍各 49 条通过;**负向验证**(故意改错两条期望)三端都能报不一致;端到端 `sample_package.json` / `demo_rain_night` / 种子 42 在 TS / Godot / C# 产出完全相同的 31 条 beats、两条检定记录与全部变量终值;Godot 4.6.2-stable 与 4.8-dev1 都通过;vitest 519 项
- 注意:GDScript 里 **`var x := rt.method()` 会因 rt 无类型而推断失败,导致整个脚本编译不过**(连带 preload 它的测试都挂);涉及 Variant 返回值一律用 `var x =`。SceneTree 脚本入口是 `_initialize()` 不是 `_init()`

## 最近变更(R20-3 · v0.39.0)

CLI 与目录同步:

- 新增 `src/cli/`:`main.ts`(参数解析 / 命令分发 / 退出码)、`loadProject.ts`(node fs 读项目)、`sync.ts`(目录同步 + 指纹)
- **项目读取不另写一份**:CLI 用 node fs 组装出与 Rust `load_project_dir` 相同形状的 `ProjectFiles`,再交给已有的 `projectFromFolderFiles`;documents/ 递归、name 用 `/` 分隔、assets/ 只取 `entity-*` 头像,三条都与 Rust 侧对齐
- `vite.cli.config.ts` + `npm run build:cli` → `cli-dist/theloom-cli.mjs`(target node18,external `^node:`,yaml 等打进单文件;gitignore)。新增 devDependency `@types/node`(纯类型)
- **`EngineExportRules.exportedAt`**:缺省当前时间,CLI 传 `project.updatedAt`。这是目录同步能真正「只写变化文件」的前提 —— 否则包内时间戳每次都变,4 个文件每次都被判定为变化,引擎的资源导入器反复触发
- `syncToDirectory` 逐文件比 SHA-256;`.theloom-sync.json` 记录本次产出,`--clean` 只删这个清单里有、本次没产出的文件(引擎工程自己的文件绝不碰);`projectFingerprint` 给 `--watch` 判断是否真的变了
- 退出码 `EXIT`:0 ok / 2 usage / 3 auditFailed / 4 testsFailed / 5 schemaMismatch / 6 ioFailed。**5 的触发点**是目标目录已有 `theloom-package.json` 且 schema 主版本不同 —— 引擎侧集成的是旧结构,直接覆盖会崩
- 测试:`cli/cli.test.ts` 13 项(参数解析含短选项与错误分支 / 配置选取与回落 / 同步写-跳-删三态 + 二进制按字节比 / `--clean` 不碰外部文件 / 项目读取含 .bak 回落 / 退出码互不相同);合计 vitest 471 项
- 已端到端实测:真实项目文件夹 → 检查通过 → 同步 8 文件 → 重跑 0 写 8 跳 → 切配置 `--clean` 删 4 → 五种失败退出码逐一命中 → `--watch` 改项目后自动重导 → CLI 产物直接过 `selfcontained.mjs` 脱机验收
- CI(verify.yml)增加 `npm run build:cli`
- 注意:`build` 脚本已串 `build:runtime`(自包含包需要),但**没串 `build:cli`** —— CLI 是可选工具,单独构建

## 最近变更(R20-2 · v0.38.0)

自包含引擎包:

- `types.ts` 增 `EngineBundle`(`assetFiles` / `runtime` / `checksums`)挂在 `EngineExportConfig.bundle`;`normalizeProject` 同步清洗布尔非法值
- 新增 `src/engine/bundle.ts`(纯逻辑):`buildBundleFiles(pkg, baseFiles, { bundle, readAssetBytes, runtimeSource })` → `{ files, missingAssets, assetCount, assetBytes }`。**读字节是注入的 `AssetByteReader`**,所以核心逻辑在 node 环境可测(vitest 没有 IndexedDB);UI 层传基于 `loadAssetBlob` 的实现
  - 原文件按 `fileName` 去重(内容寻址天然同字节同名),取不到时记 `missingAssets` 并区分「从未保存原文件」/「原文件丢失」
  - `checksums.json` 最后生成,覆盖此前所有文件但**不含自身**;`licensesMarkdown` 汇总授权来源并点名未标注的
- 运行库内嵌:`vite.config.ts` 加 `runtimeSourcePlugin` 提供虚拟模块 `virtual:theloom-runtime-source`(读 `runtime-dist/theloom-runtime.js`),`src/engine/runtimeSource.ts` 导出 `RUNTIME_SOURCE` / `RUNTIME_AVAILABLE`,类型声明在 `src/virtual-modules.d.ts`。**`npm run build` 已改为先 `build:runtime`**;产物缺失时插件 warn + 界面禁用「运行库随包」
- `engineReadme(projectName, bundle)` 按实际打包内容生成说明,自包含时加显著标注并附校验命令
- `examples/engine-demo/selfcontained.mjs` 脱机验收:只读传入目录 → 按 `checksums.json` 逐文件校验 → 用**包内**运行库演到结束 → 按 `fileName` 读附件字节与 `hash` 对拍 → 列挂接关系;失败非零退出码
- 测试:`engine/bundle.test.ts` 6 项(全关只有数据包 / 同字节只写一次+无 hash 老资源报告 / 读不到报丢失 / 运行库空不写空文件 / 校验清单不含自身且用 "abc" 标准向量验证真 SHA-256 / 授权表点名未标注);合计 vitest 458 项 + cargo 4 项通过
- 已实测:界面导出的 zip 解压后 7 文件校验全过、对白演出跑通、16044 字节音频附件读出且哈希一致;生产构建产物里确认内嵌了运行库源码
- 注意:`buildBundleFiles` 不碰 IO,新增打包内容时保持这个边界;`checksums.json` 必须最后 push(它要哈希前面所有文件)

## 最近变更(R20-1 · v0.37.0)

导出配置与基线:

- `types.ts` 新增 `EngineExportConfig`(命名配置:`flowIds` / 四项规则 / `gate`)与 `EngineExportGate` + `DEFAULT_ENGINE_EXPORT_GATE`;`Project.engineExportConfigs` 随项目走(撤销栈 / 文件夹往返 / 云协作)。CRUD 直接走 `update((p) => …)`,与 flowTests / externalEvents 同惯例,不加 store action
- `normalizeProject` 清洗:重复 id / 空名剔除、枚举与布尔非法值删除、`flowIds` 只剔失效流程。**选中的流程全被删时保留空数组**,不回落为「全部」——否则导出范围会静默变大
- `EngineExportRules.flowIds` 语义随之收紧:缺省 = 全部;给定数组 = 精确这些(空数组即不导)。`buildEnginePackage` 里判断改为 `rules.flowIds ? new Set(...) : null`
- 新增 `src/engine/baseline.ts`:基线按 configId 绑定,双后端 —— 桌面 `engine/baseline-{configId}.json`(Rust `read_engine_file` / `write_engine_file` / `delete_engine_file`,名称白名单 `baseline-*.json`),网页 localStorage `theloom-engine-baseline-{slotId}-{configId}`;绑定文件夹时两边都写。`parseBaseline` 防御外部 JSON;R9 旧键 `theloom-engine-manifest-{slotId}` 作为 legacy 源读一次,首次保存后删除
- **`engine/` 不进 `MANAGED_DIRS`** —— 基线由独立命令读写,不参与 `save_project_dir` 的差量删除(Rust 测试守这条)。与资源原文件不同,基线同名必须覆盖
- 新增 `src/engine/gate.ts`:`runExportGate(project, config)` 统一跑脚本 / 高级体检 / 路径 / 回归测试。**判定范围取自 `buildEnginePackage` 的产物**(`packageScope` 收集包内 flow / node / entity / asset id),范围外对象与 `tab === 'documents'` 的问题一律不算 —— 保证「闸门查的」与「导出的」是同一批对象;`gate.paths` 关时 `includePaths: false`,省掉 auditProject 的主要开销
- `EngineExportModal` 重写:配置下拉(套用 / 保存 / 另存 / 重命名 / 删除,dirty 提示)、闸门面板(阻断可点击 nav 跳转、未检查项列出)、基线来源与时间、基线 JSON 导入导出;导出流程为「闸门 → 阻断拒绝 / 仅警告确认 → 打包 → 写基线」
- 测试:`engine/exportConfig.test.ts` 9 项(配置规范化 / 流程被删不回落 / flowIds 语义 / 基线文件名白名单 / 基线 JSON 往返与拒收 / 范围外脚本错误不阻断 / 关检查项 / 回归测试范围过滤 / 警告升级阻断)+ Rust `engine_baseline_commands_roundtrip_and_guard`;合计 vitest 452 项 + cargo 4 项通过
- 已实测(浏览器):闸门抓到 2 个阻断(脚本错误 + 分支缺口)并拦住导出;取消勾选坏流程后放行;改规则清空旧闸门结果;配置存入项目并跨会话恢复;导出建立基线 → 改流程内容 → 差异显示 ~1 变更;深色主题下闸门行可读;控制台零错误
- 注意:闸门是**显式动作**不是实时计算(auditProject 冷 ~990ms),不要放进 useMemo;新增会影响导出内容的规则时,同步 `rulesFromConfig`、normalize 清洗与 `packageScope`

## 最近变更(R9 · v0.23.0)

通用游戏引擎导出:

- 新增 `src/engine/`(纯逻辑):
  - `package.ts`:`buildEnginePackage(project, rules)` → `EnginePackage`(schema `theloom-package` + `schemaVersion 1.0.0`);规则 = 选流程 / `includeLayout` / `includeAnnotations`(默认剥除,连带剥指向注释的边)/ 实体 `referenced`(说话人 + entity/entities 字段传递闭包)/ 资源 `referenced`(仅被挂接);附件 owner 限定在导出范围;资源带 `hash/ext/license/fileName`(接 R8,字节不入包);四类索引(technicalNames / nodes 定位 / speakers / assetOwners);`contentHash`(FNV-1a 双 32 位)per 对象清单;`diffManifests` + `buildEngineDelta`(变更带全量对象、删除只带键)
  - `typegen.ts`:`generateTypes(pkg)` → 自包含 .d.ts,变量名 / 流程 / 实体 / 资源 / 节点技术名全部字面量联合,变量表接口带描述注释
  - `schema.ts`:draft-07 JSON Schema(节点 / 边 / 子流程递归 $defs)+ zip 内 README 文本
- 新增 `src/runtime/`(纯逻辑,零框架依赖):`FlowRuntime` 类复刻 Player 全部行进语义(直通自动前进 / 无出边逐层回溯 / exit 命名引脚 / fragment 默认引脚 / fallback 遮蔽 / once / 条件边过滤 / 2d6 检定红白 / 实体属性读写);输入是结构最小类型(应用内 Flow 与引擎包 JSON 都满足);`seed` 种子演出可复现;`snapshot()/restore()` 存读档(resumeRng 快进,续掷不漂移);`onBeat` 回调
- **Player / simulate / runtime 三处行进语义必须同步**(各文件头有互指注释)
- `script.ts` `buildEntityProps` 参数放宽为结构类型 `EntityPropsSource`(运行库与引擎包实体共用)
- 新增 `vite.runtime.config.ts` + `npm run build:runtime` → `runtime-dist/theloom-runtime.js`(ES Module,~30KB 未压缩,gitignore);`examples/engine-demo/demo.mjs` 纯 Node 读包自动演出(内置示例包,也可传导出的 theloom-package.json + 流程技术名 + 种子)
- 新增 `components/EngineExportModal.tsx`(工具菜单「引擎包 .zip(游戏引擎)」):流程勾选 + 四项规则 + 实时统计;导出 zip(theloom-package.json / schema.json / types.d.ts / README.md,走 interop/zip);manifest 存 `theloom-engine-manifest-{slotId}`,界面显示与上次导出的 +新增/~变更/−删除;「导出增量 .json」无变化时提示拦截
- 测试:`engine/engine.test.ts` 8 项(默认规则剥离 / 规则组合 / JSON 往返自洽 / 哈希稳定 / diff+delta / 类型生成 / never 分支 / Schema 对齐)+ `runtime/runtime.test.ts` 8 项(线性 / 选项与 once / 条件与 fallback / 子流程 exit / 实体属性 / 同种子复现 / snapshot-restore / onBeat),运行库测试全部经 JSON 序列化往返消费(即无 React 环境证明);合计 164 项通过
- 已实测:`node examples/engine-demo/demo.mjs` 全程演出(说话人 / 选项 / 指令改实体属性 / 种子检定)输出正确;浏览器中导出模态规则切换实时改统计、导出 zip 后 manifest 落 localStorage、差异行出现、增量按钮解锁、无变化拦截提示;控制台零错误
- 注意:引擎包 schemaVersion 独立于应用版本,破坏性改动才升 major;新增节点字段时同步 `cloneNode`、typegen 静态块与 JSON Schema

## 最近变更(R8 · v0.22.0)

资源原文件闭环:

- `types.ts` `Asset` 增 `hash?`(SHA-256 hex,原文件存储键)/ `ext?`(小写扩展名)/ `license?`(授权字段);`fileRef?` 降为兼容保留,文件名一律由 `hash + ext` 推导;`normalizeProject` 剔除非法 hash / ext / license
- 新增 `src/assetFiles.ts` 原文件存储层,按 `folder` 参数二选一:
  - 桌面文件夹模式 → 项目文件夹 `assets/asset-{hash前16}.{ext}`,随文件夹迁移仍可用
  - 网页 / 未绑定 → IndexedDB `theloom-assets`(按完整 hash 全局键,跨槽位共享去重)
  - API:`hashBlob` / `assetExt` / `assetFileName` / `storeAssetFile` / `loadAssetBlob` / `getAssetUrl`(对象 URL 缓存)/ `listStoredFiles` / `isAssetStored` / `deleteStoredFiles` / `computeOrphans`(纯函数)/ `collectReferencedTexts` / `exportBlobsToFolder`
- Rust 新增 4 个命令:`list_asset_files`(名称 + 字节数,不读内容)/ `read_asset_file` / `write_asset_file`(同名 = 同内容,已存在直接跳过)/ `delete_asset_files`;名称白名单仅 `asset-` 前缀 + 字母数字 `._-`,杜绝穿越
- `read_asset_dir` 收窄为只读 `entity-*` 头像:资源原文件不整读进内存,也不进 `knownManaged` 差量删除集合(顺带修复外部放入 `assets/` 的图片被保存流程误删的旧 bug)
- `Assets.tsx`:导入哈希去重(重复文件跳过并提示);视频导入截首帧缩略图(`util.ts` `fileToVideoThumb`,**已于 2026-08-15 删除**,见「后续增强」);任意文件类型可导入;inspector 原图预览 / 音视频播放 / 下载原文件;「替换文件」保 asset id 引用不断;「重新定位」哈希一致才关联、不一致询问转替换,旧资源(无 hash)可补挂原文件;卡片「缺失」徽标;「清理未引用原文件」是唯一删字节入口(扫描全部 theloom-* localStorage + 当前项目,子串匹配哈希,宁可漏删)
- **删除 / 替换资源永不自动删字节**:保证撤销安全(删除 → Ctrl+Z 资源连原文件完整回来);孤儿由清理工具显式确认后回收
- `App.tsx` 绑定新文件夹时 `exportBlobsToFolder` 把 IndexedDB 原文件落盘;xlsx 资源表增「授权」列往返
- 测试:`assetFiles.test.ts` 6 项(哈希稳定 / 扩展名推导 / 文件名与非法输入 / 两模式存在性 / 孤儿计算与引用命中)+ util normalize 1 项 + Rust `asset_file_commands_roundtrip_and_guard`;合计 vitest 148 项 + cargo 2 项通过
- 已实测(浏览器,IndexedDB 模式):导入图 / 音频(真实 WAV)/ 文本 → IDB 三条 blob 键=哈希;重复导入被跳过并弹提示;音频 blob URL 实际播放成功;替换文件后同 id 换哈希;删 IDB 字节 → 缺失徽标 + 重新定位同内容文件恢复播放;注入无引用 blob → 清理工具列 2 个孤儿(含替换遗留)删除、在用 3 个保留;删资源 → 撤销 → 原文件状态「已保留」;控制台零错误
- 注意:桌面模式文件名只含 hash 前 16 位,`computeOrphans` 用该片段做子串匹配;`storeAssetFile` 同 hash 幂等;演出 / 流程内媒体播放尚未接入(后续批次)

## 最近变更(R7 · v0.21.0)

演出与路径测试:

- 新增 `src/rng.ts`:mulberry32 种子化 RNG + `rollD6` + `resumeRng(seed, consumed)`(读档快进,续掷不漂移)
- 新增 `src/playSaves.ts`:演出存档与断点的本机存储(`theloom-plays-{slotId}` / `theloom-breakpoints-{slotId}`,**不入项目、不参与云同步**);`PlaySave` 含 seed/rolls/vars/seen/taken/checks/entityProps/curPath/choices/ended/log(Beat.speaker 序列化为 speakerId)
- `Player.tsx`:检定掷骰改种子 RNG(头部显示种子,「同种子重开」可复现 /「重新开始」换种子);存档 / 读档 / 删档;`commitVars` 记录变量差异 → 监视面板高亮上一步变化 + 实体属性运行值展示;自动前进目标带断点时暂停并把选项标 ⛔ 交还手动
- 新增 `src/simulate.ts`:`simulateFlow(flow, variables, entities, {maxPaths, maxSteps})` 批量路径遍历 —— 复刻 Player 行进语义(exit 回溯 / fragment 默认引脚 / fallback 遮蔽 / once / 条件边过滤 / 红检定沿用);condition 无法求值与 check 均双分支枚举;**状态指纹**(节点+层级+vars+taken+checks)做单路径死循环检测与跨路径合流剪枝(无状态差异的选择组合不爆炸);报告覆盖率 / 不可达(有入边但走不到)/ 卡死(第一层出边被过滤光)/ 死循环 / 截断,`SimNodeRef` 带容器 path 供跳转
- 新增 `components/PathTestPanel.tsx`:流程工具栏「路径测试」→ 覆盖率 + 路径终态统计 + 三类问题列表(点击 `nav {tab:'flow', flowId, path, nodeId}` 直达,含子流程);FlowEditor inspector 增断点 checkbox
- 测试:`simulate.test.ts` 14 项(线性 / 分支 / 条件不可达 / 指令改变走向 / 死循环 / 计数环不误报 / 卡死 / fallback 拯救 / 检定双支 / 子流程出口 / once 环 / 可复现 / 合流剪枝 / 状态发散截断)+ `rng.test.ts` 5 项;合计 141 项通过
- 已实测(浏览器):注入含检定 / 卡死 hub / 死循环 / 永假条件的测试流程 —— 路径测试报 80% 覆盖 + 三类问题全部命中,点击问题跳转选中节点;演出同种子重开掷骰 1+5 完全复现;存档 → 重开清空 → 读档完整恢复(含掷骰进度);断点开关与变量监视高亮正常;控制台无错误
- 注意:断点与演出存档是**调试运行态**,永远只存本机;`simulateFlow` 语义若与 Player 行进规则不一致会导致误报,两处改动需同步

## 最近变更(R6 · v0.20.0)

脚本语言重构 —— 不再动态执行字符串:

- 新增 `src/script/` 纯逻辑层:
  - `ast.ts` 带 `Span`(字符区间)的 Token / Expr / Stmt / Diagnostic 类型 + `ScriptError`
  - `lexer.ts` 词法:标识符支持 Unicode 字母(中文字段名),字符串转义,error token 不抛出
  - `parser.ts` 递归下降:优先级爬升(`|| && 比较 加减 乘除模`)+ 三元 + 一元 + `seen()/unseen()` 调用 + 单层 `实体.字段`;`parseExpression`(条件 / 数字)与 `parseInstructions`(`目标 (=|+=|-=|*=|/=) 表达式`,分号 / 换行分隔,单条失败不拖累其余);所有错误带精确 Span
  - `check.ts` 类型检查:`ScriptScope`(变量类型表 / 实体字段类型表 / 节点技术名集);`checkCondition`(根应为布尔)/ `checkNumberExpr` / `checkInstructions`(目标存在性、复合赋值须数字、`=` 类型不匹配警告);text 字段类型为 unknown(内容动态),与一切兼容
  - `eval.ts` AST 解释器:`==` 宽松(数字文本互比按数值)、`===` 严格、`&&/||` 短路返回操作数、除零回 0;`runStmt` 支持**实体属性写入**(`实体.字段 = 值`)
  - `rename.ts` 基于 token 的联动重写:`renameIdentifier`(跳过 `.` 后字段位与字符串)/ `renameEntityField`(只改指定实体的字段)/ `renameSeenTarget`(只改 seen/unseen 字符串参数)
- `src/script.ts` 变为门面,旧 API 签名不变(`evalCondition`/`evalNumber`/`applyInstructions`,错误仍回 null/0/警告数组);新增 `buildEntityProps`(从 Player 抽出)、`buildScriptScope`、`mapProjectScripts`(遍历改写全部脚本表面:各层流程节点 text / checkExpr、各层边 condition / effect、文档条件 / 指令块、叙事单元镜像)
- `Player.tsx`:entityProps 改为演出运行态副本(`entityPropsRef`,重新开始时还原);`applyInstructions` 传入 evalCtx → 指令可改实体属性
- **重命名联动**(blur 时触发,避免逐键误伤):store 新增 `renameScriptIdentifier` / `renameScriptEntityField` / `renameScriptSeenTarget`;`TechNameField` 新增 `onRenamed`(聚焦值 vs blur 值,格式非法不触发;实体两处 → identifier,流程节点 → seen 目标);`FieldListEditor` 新增 `onFieldRenamed`(实体有技术名才挂);变量名输入 focus/blur 同模式
- 新增 `src/components/ScriptInput.tsx`:叠层语法高亮(透明 textarea + 底层 pre,token 分类上色,诊断红 / 黄波浪线)+ 诊断列表(带「第 N–M 字符」)+ 自动补全(前缀出变量 / 实体 / 关键字,`实体.` 后出字段,↑↓ Enter/Tab Esc,seen 插入后光标进引号);替换 FlowEditor 三处 ScriptHints(条件 / 指令节点 text、检定 checkExpr、边条件 / 效果)与 BlocksEditor 文档条件 / 指令块,ScriptHints 已删除
- `audit.ts`:正则标识符检查替换为类型检查器,新增「脚本错误 / 脚本警告」类目,消息带精确字符区间;新覆盖文档条件 / 指令块(nav 直达块)
- 测试:`script/script.test.ts` 18 项(词法位置 / 优先级 / 错误定位 / 指令解析 / 类型规则 / seen 校验 / 解释器语义 / 属性读写 / 门面兼容 / 三种重命名);旧 `script.test.ts` 断言更新为新警告文案;合计 122 项通过
- 已实测(浏览器):高亮分色与未定义标识符红波浪、诊断列表精确到字符、自动补全菜单 + Enter 接受、变量改名后条件节点脚本自动重写并持久化、演出中条件求值走 AST 解释器、体检面板显示带位置的脚本警告
- 注意:`ScriptInput` 的高亮层与 textarea 必须字体 / 内边距 / 行高完全一致;新增脚本表面(节点字段 / 块类型)时同步扩 `mapProjectScripts` 与 audit

## 最近变更(R5-B · v0.19.0)

深色主题切换:

- 新增 `src/theme.ts`:`ThemePref`(light/dark/system)存 `theloom-theme-v1` localStorage,**不入 Project、不参与云同步**;`applyPref` 在 `<html>` 上打 `data-theme`(system 时清除,让 `@media (prefers-color-scheme: dark)` 兜底)+ `data-theme-mode`(实际生效模式,始终有值);`initTheme` 恢复偏好并监听系统主题变化;`getThemeMode` / `subscribeThemeMode`(applyPref 派发 `theloom-theme` 事件,供 `useSyncExternalStore` 消费);`readableInk(hex)` 按亮度返回深/浅文字色(非 hex 返回 undefined);Tauri 环境动态 import `getCurrentWindow().setTheme` 同步标题栏
- `index.html`:`<head>` 内联脚本在 CSS/JS 加载前同步应用主题并写 html 背景,消除深色白闪;`meta[name=theme-color]` 跟随
- `src/main.tsx`:样式加载后、React 挂载前 `initTheme()`
- `styles.css`:硬编码颜色全部收敛为语义令牌(`--chip-border` / `--checker-a/b` / `--flow-canvas` / `--node-*` 十种节点头 / `--pace-*` 节奏图灰阶 / `--overlay` / `--danger-bg` / `--note-*` 等);深色变量表两份(`@media` + `:root[data-theme=dark]` 显式锁定,`[data-theme=light]` 可在系统深色下反锁浅色);半透明浅底(演出遮罩 / 地图标签 / 分区)改 `color-mix`;**深色主题下侧栏加深为 `#161413`**(`[data-theme-mode=dark]` 覆盖,浅色不变),logo `filter: invert(1)` 反白
- 深色下节点头灰阶整体反转(浅底配 `--focus-fg` 深字);`.check-kind.red` 固定反白;用户自定义节点色 / 便签色是内容数据不改写,由 `readableInk` 内联反色文字
- 三处 React Flow(FlowEditor / Brainstorm / RelationGraph)`colorMode` 改响应式(`useSyncExternalStore(subscribeThemeMode, getThemeMode)`);`--xy-background-color` 走 `--flow-canvas` 令牌
- 登场统计格子 `color-mix(var(--text) N%, transparent)` + 深格文字 `var(--bg)`,两套主题同一段代码
- 新增 `src/components/ThemeToggle.tsx` 顶栏三态切换菜单(☀/☾/◐)
- 测试:`theme.test.ts` 10 项(偏好读写 / 非法回退 / resolveMode 锁定与跟随 / applyPref 打属性与 meta / readableInk 反色与非法输入;vitest node 环境用 `vi.stubGlobal` 轻量 stub,未引入 jsdom);合计 104 项通过
- 已实测(浏览器):四态切换即时生效;刷新持久化且无白闪;模拟系统深浅切换时「跟随系统」下 CSS 与 React Flow 同步跟随;深色下节点头 / 便签 / 工具菜单 / 规划页可读;无控制台错误
- 注意:vitest 是 node 环境,涉及 DOM 的测试用 `vi.stubGlobal` 造最小假件,不要引入 jsdom;`.rf-light` 类名保留(令牌已主题化,含义为「应用自绘 RF 变量」)

## 最近变更(R5-A · v0.18.0)

完整项目导入(小说版):

- 新增 `src/ai/projectImport.ts` 管线纯逻辑:
  - `SourceMaterial`(kind: manuscript/setting/note/ai + trust: canon/normal/draft);`materialsToText` 带来源标注拼接、总量 20 万字截断
  - **阶段一** `buildPlanPrompt` / `normalizePlan`:产出 `ImportPlan`(projectName / volumes→chapters→scenes / entities / timelineTracks / pending);prompt 明确「正文权威、草案与 AI 记录的冲突方案一律进 pending 不采纳」
  - **阶段二** `buildGeneratePrompt`(计划 JSON 内嵌,要求 structure 与计划一致、名称引用与 entities 一致)/ `normalizeGenerated`:场景块(heading/action/dialogue)、实体(source+evidence)、relations / arcs / foreshadows / outline / timeline / brainstorm / pending
  - `buildProjectImportPreview`:卷→章两级 document 文件夹 + 场景文档(order / status=outline / povId / locationId / timeLabel,说话人按名匹配);实体同名只补空白、evidence 写入 notes;关系 / 弧线名称解析失败丢弃并告警;伏笔 plants/payoffs 场景名→docId;每份材料→「原始材料」资料卡备份原文;plan+generated 的 pending 去重合并→置顶「待定设定」卡(含出处引文)+ 风暴板便签;无轨道建轨(名取计划第一轨);有地点实体且无地图时建空地图占位(MapEditor 需底图才能放标记)
  - `applyProjectImport` 单事务:全部 push structuredClone;空白项目名以计划名命名;分类注册;**不写 flows / variables**
- 新增 `src/components/ProjectImportWizard.tsx` 四步向导(材料→配置→计划审阅→预检导入);项目类型 `suggestProjectKind` 只建议不静默切换;两阶段各记一条 aiLog(purpose: plan / generate,union 已扩)
- `App.tsx` 工具菜单 AI 区新增「完整项目导入(小说)」
- 测试:`ai/projectImport.test.ts` 7 项(标注拼接与截断 / 计划校验 / 生成校验+全模块预检 / 事务 apply 后 normalize 单元齐全 / 类型建议);合计 94 项通过
- 已实测(浏览器,双阶段 stub fetch 按 system 内容分流):向导四步 → 计划审阅(卷章树/实体/待定)→ 预检 12 模块计数 → 事务导入后 localStorage 中文件夹树、场景元数据、关系/弧线/伏笔、大纲、时间线、备份卡、待定卡(置顶)、便签、地图占位全部正确;flows 数量不变(未生成游戏机制);应用后跳转首个场景

## 最近变更(R5 · v0.17.0)

正文修订系统:

- `types.ts`:`Annotation`(docId / blockId? / text / resolved,块删除后退化为整篇批注)、`DocSnapshot`(docId / label / revision / blocks 深拷贝)+ `DOC_SNAPSHOT_LIMIT = 20`;`Document.revision?`(第几稿,≥1 整数);`Project` 增 `annotations?` / `docSnapshots?`
- `util.ts` `normalizeProject`:批注 / 快照指向缺失文档剔除;批注 blockId 失效置空(退化整篇);revision 非法剔除、取整
- `store.ts`:annotation CRUD、`createDocSnapshot`(blocks structuredClone + 每篇上限丢最旧)/ `removeDocSnapshot` / `restoreDocSnapshot`(commit 内替换 blocks,可撤销);`removeDocument` 级联清批注与快照
- 新增 `src/revision.ts` 纯计算层:`blockLines` / `docLines`(块 → 可读行:对白带说话人、列表带序号、引用带 `>` 前缀);`diffLines` 行级 LCS(先裁剪公共首尾,中段 DP,超 1e6 规模退化为整段删加)+ `diffStats`;`findDocMatches` / `replaceInDocs`(跨 text / items / choices / condition / instruction 五类字段,正则转义 + 大小写开关 + 替换文本 `$` 字面写入,按 key 精确替换,须在 commit 回调里调用故单步可撤销)
- `RevisionDiff.tsx`:两版本选择(含「当前正文」)+ 行级差异渲染(+绿底 / −删除线)。**注意 zustand selector 不要在 selector 里 filter 返回新数组**(会无限重渲染),先取原始引用再 useMemo
- `FindReplace.tsx` + App 工具菜单「查找替换」:查找 → 按文档分组勾选 → 替换选中(单 commit),完成提示可 Ctrl+Z;点击结果跳转文档块
- `DocumentView`:inspector 增「修订轮次」「批注」「场景快照」三区;工具栏增轮次筛选(全部 / 第 N 稿 / 未设轮次,作用于列表与连续稿);`BlocksEditor` 增可选 props `annotationCounts`(块上 💬 徽标)与 `onActiveChange`(批注锚定当前块)
- `storage.ts`:`revision` frontmatter 无损往返(非法值丢弃);`.sync-body input { width:100% }` 会波及模态里的 checkbox,需 `width:auto` 覆盖
- 测试:`revision.test.ts` 8 项(行渲染 / diff 增删改 / 跨字段查找 / 全量与按 key 替换 / 大小写 / `$` 字面 / normalize 清理)+ storage revision 往返断言,合计 88 项通过
- 已实测(浏览器,Playwright):批注徽标与锚点跳转 / 新增块级批注 / 标记解决;存快照 → 改稿 → 差异 +1/−1 → 恢复;轮次筛选只显示对应稿;查找替换 2 处 + Ctrl+Z 撤销;localStorage 中 annotations / docSnapshots 持久化正确

## 最近变更(R4 · v0.16.0)

小说规划增强 —— 新增「规划」tab(`src/modules/planning/`,懒加载),六个子视图:

- `types.ts`:`EntityRelation`(fromId / toId / label / bidirectional / color / note)、`ArcStage`(entityId / title / note / docId? / order?)、`Foreshadow` + `ForeshadowRef`(plants / payoffs 指向文档,abandoned 手动标记)、`ForeshadowStatus` + 标签;`Document.tension?`(1-5);`Project` 增 `relations?` / `arcs?` / `foreshadows?` / `relationLayout?`(关系图节点位置)
- `util.ts` `normalizeProject`:三数组兜底;剔除指向缺失实体 / 文档的关系(含自环)、弧线(docId 缺失置空)、伏笔引用;relationLayout 清理非法项;tension 非 1-5 剔除、取整
- `store.ts`:relation / arcStage / foreshadow 三组 CRUD 动作 + `setRelationLayout`;`removeEntity` 级联清关系 / 弧线 / 布局,`removeDocument` 级联清弧线 docId 与伏笔引用
- 新增 `src/planning.ts` 纯计算层:`foreshadowStatus` 推导(abandoned > resolved > planted > idea);`groupDocsByChapter`(linearizeByFolders 树序 + 按文件夹分组,未分组殿后);`appearanceMatrix`(角色 × 章节:说话块数 / 提及块数 / POV 场数 / 登场场景列表 / 落点弧线阶段,按总登场排序);`pacingPoints`(树序字数 + 张力 + 章节起点标记);`arcStagesOf`
- `src/modules/planning/`:`Planning.tsx` 子视图切换 + nav 消费;`RelationGraph.tsx`(React Flow,**浮动边** FloatingEdge 沿节点矩形边框直连避免反向绕线,连线时 promptText 输入关系名,inspector 编辑 + 全部关系列表,拖拽位置 commit 到 relationLayout);`ArcBoard.tsx`(角色列表 + 阶段卡,场景下拉按章节 optgroup,移动时物化 order);`ForeshadowLedger.tsx`(状态筛选 chips + 埋设 / 回收场景 chips 点击跳转);`AppearanceGrid.tsx`(灰阶深浅格子,● POV / ★ 弧线,点击下钻);`SceneWall.tsx`(章节分组卡片,同章 HTML5 拖拽重排物化 order);`PacingChart.tsx`(手写 SVG:字数柱灰阶编码状态、张力独立轨道 1-5、章节分隔线 + 按可用宽度截断的章节标签、点击柱子设张力)
- `search.ts`:NavTab 增 `planning`,NavTarget 增 `foreshadowId` / `planningView`;全文搜索覆盖伏笔与弧线;`findEntityRefs` 列出关系与弧线阶段
- `storage.ts`:`tension` frontmatter 无损往返(非法值丢弃);DocumentView inspector 场景元数据增「情节张力」下拉
- 测试:`planning.test.ts` 6 项(章节分组树序 / 登场统计口径与排序 / 弧线落章 / 节奏数据 / 伏笔状态推导 / normalize 清理)+ storage tension 往返断言,合计 80 项通过
- 已实测(浏览器,Playwright):关系图节点 / 双向与单向边 / inspector 编辑;弧线阶段与章节标签;伏笔加回收状态即时变 + 新建;登场矩阵格子与下钻;卡片墙分组与跳转;节奏图点柱设张力;localStorage 中 relations / arcs / foreshadows / tension 持久化正确

## 最近变更(R3-A · v0.15.0)

外部知识库 + AI 抽取(轻量):

- 新增 `src/ai/llm.ts`:零依赖 LLM 服务层 —— `LlmConfig`(provider/baseUrl/apiKey/model)存 `theloom-llm-v1` localStorage,**永不入项目**;`chatComplete` 三后端(OpenAI 兼容 `/chat/completions` Bearer、Anthropic `/v1/messages` 带 `anthropic-dangerous-direct-browser-access` 头、Ollama `/api/chat`);`testLlmConnection`;`parseModelJson`(剥围栏 / 截取大括号)。Anthropic 默认模型 `claude-opus-4-8`;请求不带 temperature / thinking,兼容全系模型
- 新增 `src/ai/extract.ts`:`DEFAULT_EXTRACT_PROMPT`(严格 JSON 模式,kind 白名单);`normalizeExtracted` 防御性校验(非法 kind 降级 concept、空条目丢弃进 warnings、实体去重);`buildAiImportPreview` 稳定 ID 匹配 —— 同名实体(大小写宽容)只补空简介 + 缺失字段、新实体 uid 新建、场景 → `AI 初稿` 分类文档(status=outline,说话人按名匹配角色)、时间点按 label 去重、无轨道时建「AI 导入」轨道;`applyAiImportPreview`(在 commit 回调里 push structuredClone);`pushAiLog`(仅元信息,50 条封顶);`buildFieldFillPrompt` / `normalizeFieldFill`(只保留请求过的空字段)
- `types.ts`:`AiLogEntry` + `Project.aiPrompts?`(extract 提示词随项目保存可导出)+ `Project.aiLog?`
- 新增 `src/components/AiPanel.tsx`:`AiSettingsModal`(服务商切换重置默认、Key 密码框带「仅本机」提示、测试连接显示耗时);`AiExtractModal`(粘贴 + .md/.txt 多选读入、可编辑提示词模板、20 万字截断、差异表 + 警告 + 未识别说话人、应用后跳转首个文档);`AiFillFieldsButton`(实体 inspector,confirmDialog 逐项列出、只填空白文本字段)
- `App.tsx` 工具菜单新增「AI」区:AI 抽取 / AI 设置;`EntityLibrary` 字段编辑器下挂补字段按钮
- **设计准则落实**:AI 输出必须过 `normalizeExtracted` → `buildAiImportPreview` → 用户确认 → `applyAiImportPreview`,无直接写项目路径;新块经 `normalizeProject` 自动获得叙事单元(与 R1/R3 体系无缝)
- 测试:`ai/extract.test.ts` 7 项(JSON 宽容解析 / 校验降级 / 匹配更新与新增 / 说话人映射 / 自动轨道 / 补字段过滤 / 日志封顶);合计 74 项通过
- 已实测(浏览器,stub fetch):配置 mock 网关 → AI 抽取 → 预检表(+2 实体 / +1 场景 / +1 时间点 / +1 事件)→ 应用 → localStorage 中实体字段、AI 初稿文档、speakerId 关联、全部块带 unitId、aiLog 记录均正确;项目 JSON 中不含 API Key

## 最近变更(R3 · v0.14.0)

文档—流程双视图:

- `types.ts`:`FlowEdge.choiceId?` —— hub 出边与文档「选项」块选项的绑定关系
- `util.ts` `syncNarrativeUnits` 增加**选项结构同步**(内容传播之后、镜像刷新之前):
  - 收集 hub 引用时携带所在容器的 edges(子流程逐层);仅 unit.kind === 'choice' 参与
  - 绑定边标签双向:边侧本次编辑(prev 边索引懒构建判定)且文档未动 → 边胜写入选项;否则单元胜写回边
  - 文档删选项 → 对应边解绑 + 清标签(结构保留);曾绑定过的边不再自动升级,避免复活已删除选项
  - 本次给未绑定出边新写标签(非 fallback)→ 追加为新选项并绑定(演出中边标签本就是玩家选项)
  - `docChangedUnits` 记录文档侧变更来源,用于冲突仲裁
- `FlowEditor`:`EdgeData.choiceId` 画布往返;`onConnect` 从共享选项单元的 hub 引出连线时自动绑定第一个未连线选项(label + choiceId 即时填入);边 inspector 显示 ⇄ 绑定提示;工具栏新增「查看为剧本」(已有共享文档则跳转,否则 `flowToDocument` 生成并跳转)
- `convert.ts`:移除 hub 项目符号文本 hack(选项由单元承载、节点直接渲染);新增 `flowToDocument(flow, units)` —— 无入边节点起 DFS、每节点一次,fragment 先出场景块再递归子流程,dialogue 带说话人→对白块 / 无→动作块,hub→选项块(选项从单元克隆),condition / instruction→对应块,jump / check→注释块,画布注释与分区跳过
- `nodes.tsx` `HubNode`:渲染单元选项列表,`useEdges` 判定 ●已连线 / ○未连线
- 测试:R3 选项结构同步 3 项(未绑定边标签升级 / 标签双向 / 删除解绑不复活)+ 反向剧本视图 1 项(线性化 + 共享单元 + 编辑回流),合计 67 项通过
- 已实测(浏览器):选项块转流程 hub 显示 ○ 选项、文档改标签 hub 即时变、「查看为剧本」生成共享文档、剧本视图编辑动作文本后 localStorage 中节点镜像与单元一致

## 最近变更(R2 · v0.13.0)

长篇正文工作台:

- **建模决策**:场景 = `Document`,卷 / 章 = 文档模块的 `Folder` 树 —— 复用 NavigatorTree 的多级目录、拖拽、order 排序,不新建平行结构
- `types.ts`:`DocStatus`('outline'/'draft'/'revising'/'done')+ `DOC_STATUS_LABEL` / `DOC_STATUS_ORDER`;`Document` 增 `status?` / `wordTarget?` / `povId?` / `locationId?` / `timeLabel?`
- `util.ts`:`documentWordCount`(正文+表达式+选项+列表项口径)、`linearizeByFolders`(按 Navigator 树序线性化:每层子文件夹递归优先、order 稳定排序,循环防护)、`folderPath`(「第一卷 · 第三章」);`normalizeProject` 剔除非法 status / wordTarget
- 拆分 `DocumentView.tsx` → `BlocksEditor.tsx`(块编辑器 + 插入栏,自带激活块状态,单文档与连续稿共用)+ `Manuscript.tsx`(连续稿)
- **连续稿模式**:工具栏「连续稿」切换;`linearizeByFolders(filtered)` 顺序渲染全部场景;非活动场景 `StaticScene` 轻量静态 DOM(memo 按 `doc.id + doc.updatedAt + 实体名 key` 比较,不随 commit 引用更替重渲染)+ CSS `content-visibility: auto` 跳过屏外绘制;点击场景就地换成 BlocksEditor;场景头显示路径 / 状态 / 时间 / POV / 字数目标
- inspector 增「场景元数据」区(状态 / 字数目标带进度条 / POV 角色 / 地点 / 故事时间);Navigator `renderItemMeta` 显示状态徽标 + 字数
- `storage.ts`:五个元数据字段 frontmatter 无损往返,非法值丢弃
- **性能**(30 万字 / 150 场 / 2252 单元实测):加载 395ms;连续稿滚动即时;按键 136ms → ~55ms。两处优化:① `syncNarrativeUnits` 的 prev 投影索引懒构建(无差异的 commit 零成本);② 同步器在镜像被共享单元变更波及时 touch 所属 `doc.updatedAt`(兼顾排序语义与 StaticScene 记忆化失效)。剩余 ~50ms 主要在 NavigatorTree 全量 re-render,可接受,深度优化留给 R16
- 测试:util(normalize 元数据 / documentWordCount / linearizeByFolders / folderPath)+ storage(元数据往返 / 非法值丢弃),合计 63 项通过
- 已实测(浏览器):脚本生成 2 卷 × 10 章 × 150 场 30.6 万字项目;连续稿树序正确、就地编辑、状态徽标三处联动、场景跨章移动内容与字数不丢、R1 迁移器同场景压测通过(2252 单元)

## 最近变更(R1 · v0.12.0)

统一叙事数据模型(叙事单元):

- `types.ts`:新增 `NarrativeUnit`(kind: scene / line / choice / condition / instruction;字段 title / text / speakerId / choices)+ `Project.units?`;`DocBlock.unitId?` 与 `FlowNodeData.unitId?` 引用单元
- `util.ts` `syncNarrativeUnits(project, prev?)`:单一同步器承担四件事 —— ① 迁移:无 unitId 的剧本块 / 叙事节点(dialogue / fragment / condition / instruction,hub 仅在转换时链接)自动建单元,含所有层级子流程;② 断裂修复:unitId 指向丢失单元时按原 id 从当前内容重建;③ 变更传播:传 prev(commit 前项目)时按前后内容投影差异判定哪侧被编辑写入单元,同 commit 双侧冲突时文档胜;不传 prev(加载 / 导入)时以与单元不一致者为准、文档优先(覆盖 Obsidian 外部编辑场景);④ 镜像刷新 + GC:所有引用者字段统一从单元刷新,无人引用的单元回收。已接入 `normalizeProject` 末尾(旧项目自动迁移)
- **架构**:单元是权威数据,块 / 节点上的 text / title / speakerId 等是同步镜像 —— 所有 UI / 导出 / 搜索 / 体检 / 演出读路径不需要改,写路径照旧 mutate 镜像,由 `commit` 里的 `syncNarrativeUnits(next, prev)` 统一收敛;镜像与单元不可能发散
- 字段映射:heading.text ↔ unit.title;action / dialogue.text ↔ unit.text(dialogue 另 speakerId);choice.text ↔ unit.text + choices;condition.condition / instruction.instruction ↔ unit.text;fragment.title/text ↔ unit.title/text;条件 / 指令节点 data.text ↔ unit.text;hub.title ↔ unit.text
- `convert.ts` `documentToFlow`:生成节点携带块的 unitId → 转换后的流程与文档共享内容;`uid` 改从 `util` 导入(避免测试环境拉起 store 副作用)
- `storage.ts`:documentToMd / mdToDocument 往返 `unitId`(loom-blocks yaml)
- UI:文档块侧栏与流程节点 inspector 显示 ⇄ 标识(`.doc-block-linked` / `.unit-linked-hint`),提示内容已共享、双向同步
- 测试:`units.test.ts` 12 项(迁移 / 幂等 / 断裂重建 / GC / 转换共享 / 双向同步 / 说话人 / 条件表达式 / 无 prev 文档优先 / md 往返 / walkFlowNodes);合计 57 项通过
- 已实测(浏览器):新建文档 → 转为流程 → 文档改台词流程节点即时变、节点 inspector 改台词文档块即时变、⇄ 标识两侧显示、刷新后 localStorage 中 units 与双侧 unitId 一致

## 最近变更(R1-4)

Excel / Final Draft 互通:

- 新增 `src/interop/`:
  - `zip.ts`:零依赖 zip 读写,DEFLATE 走浏览器原生 `CompressionStream('deflate-raw')`,UTF-8 文件名支持,不实现 zip64
  - `xlsx.ts`:最小 OOXML 读写(inlineStr / 数字 / 布尔),单 sheet Sheet API,列名 A/Z/AA/AZ 转换
  - `fdx.ts`:Final Draft 8-12 兼容 XML;`documentToParagraphs` / `flowToParagraphs` 生成段落;`parseFdx` 只吃 `<Content>` 内的段落(排除 TitlePage);`paragraphsToBlocks` 合并 Character + Parenthetical + Dialogue 为一个 dialogue 块
  - `projectXlsx.ts`:全项目多 sheet 导出(实体 / 实体字段 / 大纲 / 大纲剧情线 / 变量 / 时间线轨道 / 时间线时间点 / 时间线事件 / 资源);`previewProjectXlsx` 按稳定 ID 匹配走更新、否则新增,返回差异统计与警告
- 新增 `src/components/ImportPreview.tsx`:xlsx / fdx 通用预检模态,展示 add/update/skip 数、警告、未识别的说话人,用户确认才写入;xlsx 走 `replaceProject`,fdx 生成新文档不覆盖
- `App.tsx` 工具菜单加 4 项:导出 xlsx / fdx、导入 xlsx / fdx(带预检);两个隐藏 file input 触发 ImportPreview
- 修复两个正则 bug(否则空回读):xlsx `readXlsx` 里 `<Relationship>` 属性含 URL 里的 `/` 会让 `[^/]*` 提前中断 → 改为 `<Relationship\s[^>]*\/>` 匹配整个自闭标签;fdx `parseFdx` 全局匹配 `<Paragraph>` 会误吃 TitlePage 里嵌套的段落 → 先取 `<Content>` 内容再匹配
- 测试:`interop/interop.test.ts` 覆盖 zip / xlsx / 列名 / 项目往返(空→add、自身→update)/ fdx 段落往返 / 文档-段落-块角色匹配 / 未识别说话人预检,合计 45 项通过

## 最近变更(R1-3)

长篇写作体验:

- `types.ts`:`DocBlockType` 增 `subheading` / `quote` / `list`;`DocBlock` 增 `items?` / `ordered?` / `level?`;新增 `DOC_WRITING_TYPES` 集合(subheading / quote / list / note),统一"不进流程"判断
- `DocumentView.tsx`:三种新块的编辑 UI —— 子标题带 H2/H3 切换 + 加粗大字体输入框;引用带左侧竖线的 textarea;列表带有序/无序切换、每项一行、回车新增、退格删空项;`convertToFlow` 用 `DOC_WRITING_TYPES.has()` 过滤(与原 `note` 语义等价扩展);Legend 拆成「剧本块」与「写作块」两列
- `export.ts` `blockToLines`:子标题 → `## / ###`;引用多行 → 逐行 `> ` 前缀;列表 → `1. item` / `- item`
- `storage.ts`:`documentToMd` 的 yaml 序列化写入 `items` / `ordered` / `level`;`mdToDocument` 恢复,校验 level ∈ {2,3}、ordered 为布尔、items 为字符串数组
- `convert.ts`:`documentToFlow` 用 `DOC_WRITING_TYPES` 集合替代 `type === 'note'` 判断
- `search.ts`:文档全文搜索把 `items` 加入检索
- `audit.ts` + `DocumentView` 字数统计:把 `items` 长度纳入
- `styles.css`:`.doc-subheading-2/3`(粗体 17/15px)、`.doc-quote`(左侧灰竖线 + 斜体 + 面板底色)、`.doc-list-row`(marker + input + 删除)
- 测试:`storage.test.ts` 新增「R1-3 写作块 subheading/quote/list 无损往返」用例,合计 36 项通过

## 最近变更(R1-2)

对话框统一 + Navigator 易用性:

- `src/dialog.ts` + `src/components/Dialog.tsx`:应用内轻量弹窗(`promptText` / `confirmDialog` / `alertDialog`),返回 Promise;Esc 取消、Enter 确认、多行 Ctrl+Enter 提交、危险操作标红;`App.tsx` 挂载 `<DialogHost />`
- 全量替换原生 `prompt()` / `confirm()` / `alert()`(NavigatorTree、FlowEditor、EntityLibrary / EntityEditor、Assets、DocumentView、ResearchCards、Timeline、OutlineGrid、MapEditor、App、ProjectMenu、RecoveryPanel、PaletteManager、SyncPanel、VersionHistory、Variables、store)
- `NavigatorTree` 扩展:`order` 稳定排序、HTML5 拖拽(对象→文件夹、文件夹重父 + 同级重排、对象同级重排)、Ctrl/Shift 多选 + 底部批量归档条;新增 `renderItemMeta` / `renderItemActions` / `onItemDoubleClick` / `onMoveMany` / `onReorder` props
- FlowEditor 改用 `NavigatorTree`(原自带树删除),五个 Navigator 行为一致;流程行技术名走 `renderItemMeta`,# / × 走 `renderItemActions`,双击重命名
- `types.ts`:`Folder` / `Flow` / `Entity` / `Asset` / `Document` / `ResearchCard` 增 `order?: number`
- `util.ts`:`normalizeProject` 剔除非法 `order`(非有限数字);旧项目无 `order` → 稳定排序保持原序
- `storage.ts`:实体 / 资料 / 文档 Markdown frontmatter 无损往返 `order`
- 文件夹删除确认文案统一为「删除文件夹「X」?其下子文件夹一并删除,内容归入未分组(不会删除正文或资源)」
- 测试:`dialog.test.ts`(5 项)、`storage.test.ts` 补 `order` 往返(2 项)、`util.test.ts` 补 `order` 规范化(1 项);合计 35 项通过

## 模块清单(8 + 2)

主导航的 10 个 tab,每个对应 `src/modules/<name>/` 下的一个组件:

| tab | 模块 | 关键类型 |
|---|---|---|
| 流程 | flow/ | `Flow` `FlowNode` `SubFlow`(剧情片段可无限嵌套子流程,7+ 类节点) |
| 实体 | entities/ | `Entity`(角色/地点/物品/阵营/设定,自定义字段 + 模板) |
| **资源** | assets/ | `Asset`(图片/音频/视频/文件,256px 缩略图内嵌,文件夹模式原文件待补) |
| **文档** | document/ | `Document` `DocBlock`(结构化剧本块,一键转流程 `documentToFlow`) |
| 风暴 | brainstorm/ | 便签板,自由画布 + 连线 |
| 大纲 | outline/ | 罗琳式表格:行=章节,列=剧情线 |
| 时间线 | timeline/ | 轨道 × 时间点矩阵,事件可关联实体 |
| 地图 | map/ | 底图 + 标记 + 多边形区域,可按时间点筛选 |
| 资料 | research/ | `ResearchCard`(分类/标签/置顶/全文搜索) |
| 变量 | variables/ | 布尔/数值/文本,配合流程条件与指令节点 |

**资源** 与 **文档** 为 v0.5 草稿阶段新增(见下方"最近变更")。

## 架构约定

代码风格:**不写注释除非被要求**;中文 UI 文案;`uid()` 生成 12 位随机 id;`structuredClone` 做 immutable 更新。

### 数据层 `src/types.ts`
所有领域模型集中定义。`Project` 是顶层聚合,新增模块时:在 `Project` 加数组字段 + 在 `util.ts` 的 `normalizeProject` 补 `??= []` 兜底(旧项目自动迁移)。

### Store `src/store.ts`
zustand 单 store。核心是 `commit(fn)` —— 接收一个 mutate `Project` 的函数,做深拷贝、推撤销栈(800ms 合并连续编辑)、防抖持久化。所有动作都走 `commit`,不要绕过。删除带引用的对象时记得级联清理(参考 `removeAsset` 调 `detachAssetEverywhere`)。

### 工具 `src/util.ts`
`uid` / `normalizeProject` / `resolveSub`(按 path 深入子流程)/ `countSubNodes` / 图片处理 / **附件映射**(`getAttachments`/`setAttachments`/`addAttachment`/`removeAttachment`/`detachAssetEverywhere`)。

### 搜索与反向引用 `src/search.ts`
- `useNav` zustand store:跨模块跳转,`NavTarget` 带 `tab` + 定位字段,目标模块用 `useEffect` 监听 `navSeq` 消费
- `searchProject`:全文搜索,分组返回 `SearchHit[]`
- `findEntityRefs` / `findAssetRefs`:反向引用,遍历全项目给出该对象的出现位置

### 存储 `src/storage.ts` + Rust `src-tauri/src/lib.rs`
- 网页模式:project JSON 存 localStorage
- 文件夹模式:实体/资料卡/文档 序列化为带 YAML frontmatter 的 Markdown(便于 Obsidian 直接编辑),二进制资源存 `assets/`;`project.json` 存其余结构化数据(`slim` 副本剔除已 md 化的条目避免重复)
- Rust `load_project_dir` / `save_project_dir` 两个 `#[tauri::command]`,带路径穿越防护(`safe_join`);已删除文件由前端显式列出(`deleteFiles`,只含 `knownManaged` 记录过的本会话文件,外部新建的 md/图片不会被误删)
- 新增模块要文件夹往返时:`XxxToMd`/`mdToXxx` + Rust `read_md_dir` 扩展 + `recordKnown`/`keepMd` 纳入新目录 + `cargo test --lib` 覆盖

### 流程编辑器 `src/modules/flow/`
React Flow(`@xyflow/react`)。本地画布状态防抖 350ms 回写 store;卸载/切流程时立即冲刷。节点类型在 `nodes.tsx`,演出模式在 `Player.tsx`。`FlowNodeData` 是开放结构(`[key: string]: unknown`),扩展节点属性直接加字段。

## articy:draft X 复刻进度

参考 articy 单人版功能清单的对照(详细 gap analysis 见对话历史):

**已实现**
- 流程编辑器(嵌套子流程、出口引脚、演出模式、剧本导出)
- 实体库(自定义字段模板、头像、反向引用)
- 脚本系统(全局变量、条件/指令节点、选项级逻辑、一次性选项、检定节点、变量校验提示)
- **脚本表达力**:技术名 + `seen("x")`/`unseen("x")` 走过判断 + `实体技术名.字段名` 属性寻址 + `fallback` 兜底分支
- **富文本对白**:`**粗**` / `*斜*` / `~~删~~` 行内标记,带 B/I/S 工具栏
- 检查工具(演出/体检面板:孤儿节点、分支缺口、未定义变量、空对白、悬挂附件、重复技术名、字数统计)
- 导出(JSON 备份、流程→Markdown 剧本、文档→Markdown 剧本)
- 多人协作(端到端加密云房间)
- 通用附件(`AttachmentEditor` 已接入:流程节点 / 实体 / 资料卡 / 时间线事件)
- 资源库 + 文档视图
- **文件夹式 Navigator 树**(`Folder`,已覆盖流程 / 实体 / 资源 / 文档 / 资料,支持多级目录与移动)

**明确暂缓**
- ~~音视频/大图原文件的 Rust 文件夹存储~~ ✅ R8 已完成(内容寻址落盘 + IndexedDB 双后端)

**主要缺口(按建议优先级)**
1. ~~技术名 + 文件夹式 Navigator 树~~ ✅(技术名全对象通用;Navigator 树已覆盖全部适用模块)
2. ~~通用模板系统~~ ✅(实体约束 + 流程节点模板;`FieldListEditor` 跨对象复用)
3. ~~对象属性脚本寻址 + seen/unseen/fallback~~ ✅
4. ~~富文本对白~~ ✅(行内标记;段落级列表/标题待补)
5. Localization 本地化模块
6. ~~版本历史 + 回滚~~ ✅
7. ~~Conflict Search 增强~~ ✅(重复技术名、损坏资产)
8. Excel/FinalDraft 互通、矢量地点编辑、多窗口(CSV 导出已做;Excel xlsx/FinalDraft/矢量/多窗口待补)

## 最近变更(v0.5.0)

新增 **资源库** 与 **文档视图** 两个模块,以及通用附件系统:

- `types.ts`:`Asset` / `AssetKind` / `Document` / `DocBlock` / `DocBlockType` + `Project` 增 `assets`/`documents`/`documentCategories`/`attachments`
- `util.ts`:附件映射工具 + `fileToImageThumb`/`classifyAsset`/`formatSize`
- `store.ts`:`addAsset`/`updateAsset`/`removeAsset`(级联清理)/`addDocument`/`updateDocument`/`removeDocument`
- `src/modules/assets/Assets.tsx`:类型/标签筛选、缩略图网格、inspector、反向引用列表
- `src/modules/document/`:`DocumentView.tsx`(类 Notion 逐块编辑器)+ `convert.ts`(`documentToFlow`)
- `src/components/AttachmentEditor.tsx`:通用附件编辑器,已接入流程节点/实体/资料卡/时间线事件 inspector
- `search.ts`:`NavTab` 增 `assets`/`documents`;`findAssetRefs` 反向引用
- `audit.ts`:悬挂附件检测 + 文档字数/资源数统计
- `export.ts`:`documentToMarkdown`
- `storage.ts` + Rust:`documentToMd`/`mdToDocument` + `documents/` 目录读写往返(Rust 测试已覆盖)
- `Icon.tsx`:新增 `doc`/`tag`/`trash`/`film`/`music`
- `sample.ts`:补字段 + 示例文档「ACT 1 · 雨中短信草稿」(大纲示例已移除,留给用户自建)
- `OutlineGrid.tsx` + `styles.css`:章节/时间列宽从 64px 固定改为 100%/150px,修复长内容(如 `16:09–16:32`)被截断

验证:`npm run build` 通过;`cd src-tauri && cargo test --lib` 通过。

## 最近变更(v0.7.1)

流程节点模板 + FieldListEditor 复用(通用模板系统完整化):

- `FieldListEditor.tsx`:抽出可复用字段列表编辑器(实体/节点共用,含 enum/required/readonly 约束渲染)
- `FlowNodeData.fields?` + `Project.nodeTemplates`;`NodeTemplateModal` 按节点类型编辑模板;节点 inspector 加 `FieldListEditor` + ⚙ 模板入口
- `EntityLibrary` 用 `FieldListEditor` 替换 ~90 行内联渲染

## 最近变更(v0.7.0)

实体模板约束 + 版本历史:

- `EntityTemplateField` 加 `enumValues`/`required`/`readonly`;`TemplateModal` 加约束编辑列;实体字段渲染按约束(enum 下拉/readonly 只读/required 标记);audit 必填缺失检测
- 版本历史:`Snapshot` 持久化快照(localStorage,上限 30);`VersionHistory` 面板(命名保存/列表/回滚/删除);顶栏「历史」入口

## 最近变更(v0.6.0)

脚本表达力 + 富文本 + Navigator 树 + 技术名四个批次:

- **技术名**:`Entity`/`Flow`/`Asset`/`Document`/`FlowNodeData` 加 `technicalName?`;`util.ts` `sanitizeTechnicalName`/`validateTechnicalName`/`findDuplicateTechnicalNames`;`TechNameField` 组件接入各 inspector;audit 重复技术名检测
- **富文本对白**:`RichText`/`RichTextInput` 组件(`**粗**`/`*斜*`/`~~删~~` 行内标记 + B/I/S 工具栏);接入流程节点(对白/片段/跳转/注释)、Player beat、文档动作/对白块;导出 Markdown 天然透传
- **seen/unseen/fallback**:`FlowEdge.fallback` + `FlowNodeData.technicalName`;Player 维护 `seenRef` 节点访问集 + `techToId` 映射;`evalCondition`/`evalNumber` 注入 `seen`/`unseen` 函数;`outgoingChoices` fallback 边遮蔽逻辑;audit/ScriptHints 保留字同步
- **对象属性脚本寻址**:Player 构建 `entityProps`(实体技术名 → 字段属性对象,标量推断 + 引用字段解析为被引用实体技术名);注入 `evalCondition` 实现 `semelvie.trust > 5`;audit `findUnknownIdentifiers` 负向后看跳过 `obj.prop` 的 prop
- **文件夹式 Navigator 树**:`Folder` 类型(`module: FolderModule`)+ `Project.folders` + `Flow.folderId`;store `addFolder`/`updateFolder`/`removeFolder`(递归级联删除);FlowEditor side-list 树化(展开/折叠、子文件夹、移到下拉);数据层通用,其他模块待扩展
- `sample.ts`:`semelvie`/`valentine`/`demo_rain_night` 技术名 + `puzzle_timestamp` 节点技术名

## 开发命令

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # tsc -b + vite build
npm run build:runtime  # 独立流程运行库 → runtime-dist/theloom-runtime.js
npm run build:cli    # 无界面导出 CLI → cli-dist/theloom-cli.mjs(用法见 docs/CLI.md)
cd src-tauri && cargo test --lib   # Rust 单元测试
npm run tauri dev    # 桌面版调试
npm run tauri build  # 桌面版打包
```

发布、部署、协作后端启用见 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。
