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

- 已发布版本:`v0.23.0`(package.json / tauri.conf.json / Cargo.toml 同步)
- 当前工作区:`v0.23.1` 文件夹模式稳定性发布候选已完成,尚未提交 / 打标签 / 发布;下一开发项为 R10-1
- 已交付的能力(截至 v0.23.0):
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
- 最近验证(2026-07-17,含当前未提交改动):`npm test` 167 项通过、`npm run build` 通过、`cargo test --lib` 2 项通过;项目菜单与弹窗已在浏览器实际点验,控制台无错误

### 当前执行顺序

1. **v0.23.1 文件夹模式稳定性小批**:✅ 开发与验证完成,等待独立提交 / 发布
2. **R10-1 · 统一问题模型**:把现有 audit、脚本诊断和路径测试收敛为统一问题结构,统一严重级别、对象定位、筛选与点击直达
3. **R10-2 · 高级体检**:补无效引用、结构循环、时间冲突和角色一致性规则;支持全项目 / 当前模块范围与增量复检
4. **R10-3 · 组合查询**:按对象类型、文件夹、属性、标签、状态、引用关系组合筛选;结果可跨模块跳转
5. **R10-4 · 保存查询与回归**:查询命名保存 / 编辑 / 删除,旧项目迁移与文件夹往返;大型项目性能基线、浏览器交互检查和完整回归

R10 完成后才进入 R10-A。AI 修复与自然语言查询不得先于统一问题模型和保存查询落地。

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
| R10 | v0.24.0 | **高级体检与查询** | 脚本类型错误;无效引用;孤立节点 / 循环 / 时间冲突 / 角色一致性;保存查询 | 所有问题可点击直达;支持按对象类型 / 属性 / 状态组合查询 | M |
| **R10-A** | **v0.25.0** | **🆕 AI 智能助手(深度)** | 消费 R6 AST → AI 生成 / 改写脚本即时校验;消费 R10 体检结果 → AI 修复方案一键 apply;自然语言 → 保存查询;演出路径分析建议;人物一致性诊断;完整互动剧本生成配置 | AI 建议全部通过类型 / 结构检查后才允许 apply;互动项目生成的变量、条件、指令与分支通过脚本和路径检查,不产生"跑不通"的输出 | L |
| R11 | v0.26.0 | **完整模板与数据库** | 模块化模板;模板分配 / 继承 / 迁移;扩展到资源 / 文档 / 地图;收藏夹;批量编辑 | 模板新增字段后实例安全迁移;所有主要对象可套用模板 | L |
| R12 | v0.27.0 | **Localization 与 VO(含 AI 翻译辅助)** | 项目语言 / 可本地化字段 / 翻译状态 / 原文变更过期标记 / Excel 往返 / 配音绑定与播放;AI 翻译初稿(必须经审校才落表) | 完整导出翻译表 → 修改 → 再导入;配音与 Line ID 稳定对应 | L |
| R13 | v0.28.0 | **专业导入导出(含 AI 辅助解析)** | DOCX / PDF / EPUB / 完整 Markdown / Excel / Final Draft;可选章节编译;AI 辅助反向解析扫描件 PDF 表格、图注 | 小说可直接生成投稿稿件;FDX / Excel 可往返且有冲突报告 | L |
| R14 | v0.29.0 | **地图与工作区增强** | 地图图层 / 路径 / 形状 / 文字 / 锁定 / 显隐;跨模块树状目录;多面板 / 多窗口 | 地图承担空间设计;实体 / 资料 / 文档 / 资源都支持文件夹树 | M |
| R15 | v0.30.0 | **Unity / Unreal 接入** | 基于通用引擎包制作 Unity 导入器、Unreal 导入器和示例工程 | 引擎可导入实体 / 对白 / 变量 / Localization,并运行分支 | L |
| R16 | v1.0.0 | **稳定版** | 性能 / 崩溃恢复 / 备份策略 / 无障碍 / 快捷键 / 帮助文档 / 安装升级测试 | 大型真实项目长期使用无数据丢失;完成完整回归测试 | L |

### 关于 AI / 知识库集成的设计准则

- **不建议单独一批做完** — AI 集成的天花板取决于项目基础设施,按能力成熟度分阶段插入:
  - **R3-A(v0.15.0,轻量)** 只写"内容"不改"结构":AI 抽实体 / 场景 / 时间点后走已有的 ImportPreview 通道,用户确认才 apply。放在 R3 双视图之后,因为需要稳定叙事单元
  - **R5-A(v0.18.0,完整小说项目)** 消费 R2-R5 的正文、规划与修订模型:多份材料先形成可审阅的项目生成计划,再完整预检并事务式导入;小说配置以文档为权威,流程只表达线性情节结构,不得无依据生成变量 / 条件 / 分支
  - **R10-A(v0.25.0,深度 / 互动剧本)** 消费 R6 AST + R10 体检系统:AI 生成 / 改写脚本要能被类型检查即时校验;AI 修复方案基于结构化的体检结果,一键 apply;完整互动项目的变量 / 条件 / 指令 / 分支还必须通过路径检查。放在 R10 之后,否则 AI 建议要么无法验证要么无从触发
  - **R12 / R13 · 内嵌不单独成批** — 翻译辅助属于 L10n 工作流一部分;DOCX / PDF 反向解析属于导入器一部分
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

- 矢量地点编辑;演出 / 流程节点内直接播放挂接的音视频资源(R8 已有原文件与播放能力,差 Player 接入)
- Localization UI 文案层(与 R12 项目内容本地化解耦,可先做)

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
- 每批至少运行:`npm test`、`npm run build`;涉及桌面文件夹存储时再运行 `cd src-tauri && cargo test --lib`;界面改动需实际检查受影响模块
- 未经用户明确要求,不要推送 tag、移动版本标签或发布安装包;发布前更新版本号(package.json / tauri.conf.json / Cargo.toml 三处 + `cargo check --lib` 刷新 Cargo.lock)、`RELEASE_NOTES.md` 并确认桌面更新清单
- 新增外部依赖(尤其是运行时依赖)前请先评估能否用浏览器原生 API 手写;当前项目坚持零第三方 zip / xlsx / fdx 解析(见 `src/interop/`),接入 LLM 时也应保留可切换后端(OpenAI 兼容 / Anthropic / Ollama)以维持本地优先

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
- `Assets.tsx`:导入哈希去重(重复文件跳过并提示);视频导入截首帧缩略图(`util.ts` `fileToVideoThumb`);任意文件类型可导入;inspector 原图预览 / 音视频播放 / 下载原文件;「替换文件」保 asset id 引用不断;「重新定位」哈希一致才关联、不一致询问转替换,旧资源(无 hash)可补挂原文件;卡片「缺失」徽标;「清理未引用原文件」是唯一删字节入口(扫描全部 theloom-* localStorage + 当前项目,子串匹配哈希,宁可漏删)
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
cd src-tauri && cargo test --lib   # Rust 单元测试
npm run tauri dev    # 桌面版调试
npm run tauri build  # 桌面版打包
```

发布、部署、协作后端启用见 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。
