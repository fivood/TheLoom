# CLAUDE.md

本文件供 AI 助手(Claude Code / opencode 等)快速进入项目上下文。详细文档见 [README.md](./README.md) 与 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。

## 项目定位

**TheLoom 叙事织机** —— 本地优先的叙事设计工具,面向小说写作与游戏剧本。结构化叙事方法参考 articy:draft,叠加自有模块(头脑风暴、罗琳式表格大纲、故事时间线、资料卡片)。

- 网页版(Cloudflare Pages)+ Windows 桌面版(Tauri 2),黑白灰浅色 UI
- 数据默认存本地:网页版 localStorage,桌面版可绑定本地文件夹(Obsidian 兼容)
- 多项目槽位、撤销/重做(50 步)、端到端加密的接力式云协作

## 当前工作计划(通往 v1.0 的 R0-R16 路线图,更新于 2026-07-16)

### 命名约定(重要)

- **R0-R16 = 面向 v1.0 的发布批次**,每批对应一个 minor 版本(v0.x.0 或 v1.0.0),是本表的主索引
- 之前 CLAUDE.md 里使用过的「R1-1/R1-2/R1-3/R1-4」是**已归档的批次内小迭代命名**,与新表 R-编号无关,不要混用
- AI/知识库集成拆两批插入:轻量批(R3-A)在数据模型稳定后立刻做,深度批(R10-A)在脚本 AST 与体检系统就绪后再做

### 当前基线

- 已发布版本:`v0.12.0`(package.json / tauri.conf.json / Cargo.toml 同步)
- 已交付的能力(截至 v0.12.0):
  - **v0.12.0 R1 统一叙事数据模型** ✅ — `NarrativeUnit` 权威内容对象 + `syncNarrativeUnits` 迁移/同步器;文档块与流程节点经 `unitId` 共享同一份内容,双向同步
  - **v0.9.0 R0 工程安全基线** ✅ — 测试框架、恢复面板、损坏隔离、诊断导出、大项目性能兜底、桌面项目文件原子替换
  - **v0.10.0 附加批** ✅ — 全模块 Navigator(五模块统一)+ 文件夹归档 + 对话框统一 + 拖拽 / 多选 / 批量
  - **v0.11.0 附加批** ✅ — 长篇写作块(subheading / quote / list,无损往返)+ Excel .xlsx 与 Final Draft .fdx 双向互通(带 ImportPreview 预检)+ 配色表系统(zimg JSON 集成)+ 实体宽版编辑窗 + 文件夹 md 往返修复
- 最近验证:`npm test` 45 项通过、`npm run build` 通过、`cargo test --lib` 通过

### 路线图 · 通往 v1.0(按顺序开发,一批一 minor)

| # | 版本 | 主题 | 主要工作 | 完成标准 | 规模 |
|---|---|---|---|---|---|
| ~~R0~~ | ~~v0.9.0~~ | ~~工程安全基线~~ | ~~测试 / 迁移器 / 大项目性能 / 完整性检查~~ | ✅ 已完成(实际交付于 v0.9.0,内容对齐) | M |
| ~~R1~~ | ~~v0.12.0~~ | ~~统一叙事数据模型~~ | ~~叙事单元对象 / unitId 引用 / 迁移器~~ | ✅ 已完成(NarrativeUnit + syncNarrativeUnits,详见「最近变更」) | L |
| R2 | v0.13.0 | **长篇正文工作台** | 卷 / 章 / 场景树;拖拽排序;连续稿模式;场景元数据(字数目标 / 状态 / POV / 地点 / 时间) | 30 万字项目可流畅打开与连续编辑;重排不丢内容 | L |
| R3 | v0.14.0 | **文档—流程双视图** | 两视图共享同一叙事单元;完整选项 / 条件 / 指令双向映射;流程反向查看为剧本 | 任一视图修改后另一视图立即同步;选择分支不再丢失 | L |
| **R3-A** | **v0.15.0** | **🆕 外部知识库 + AI 抽取(轻量)** | Obsidian / md / 纯文本 / PDF 粘贴接入;AI 抽实体 / 事件 / 场景 / 时间点走 ImportPreview 预检;AI 按模板补字段;LLM 服务可切换(OpenAI / Anthropic / Ollama);API Key 本地存储 | AI 输出走稳定 ID 通道,不改结构;可粘贴长文自动生成初稿骨架;支持自建模型 | M |
| R4 | v0.16.0 | **小说规划增强** | 人物关系图;角色弧线;伏笔台账;章节登场统计;场景卡片墙;节奏图 | 可追踪伏笔埋设 / 回收;可查看人物每章状态与登场情况 | M |
| R5 | v0.17.0 | **正文修订系统** | 批注 / 作者备注 / 修订状态 / 文档快照 / 版本差异 / 全局查找替换 | 可比较两版正文;可按修订轮次筛选场景;替换可撤销 | M |
| R6 | v0.18.0 | **脚本语言重构** | 自有解析器 / AST / 类型检查 / 属性读写 / 语法高亮 / 自动补全 / 重命名联动 | 不再动态执行字符串;错误精确到表达式位置;支持实体属性修改 | L |
| R7 | v0.19.0 | **演出与路径测试** | 演出存档;固定随机种子;断点;变量监视;批量路径遍历;路径覆盖率 | 自动发现不可达分支 / 死循环 / 无出口路径;测试结果可复现 | M |
| R8 | v0.20.0 | **资源原文件闭环** | 图片 / 音频 / 视频 / 文件落盘 / 播放 / 缩略图 / 哈希去重 / 替换 / 缺失重定位 / 授权字段 | 桌面项目迁移后所有媒体仍可用;资源替换不破坏引用 | M |
| R9 | v0.21.0 | **通用游戏引擎导出** | 带版本的 JSON Schema;导出规则;引用索引;增量导出;类型生成;独立流程运行库 | 示例游戏可在无 React 环境读取项目并运行对白流程 | L |
| R10 | v0.22.0 | **高级体检与查询** | 脚本类型错误;无效引用;孤立节点 / 循环 / 时间冲突 / 角色一致性;保存查询 | 所有问题可点击直达;支持按对象类型 / 属性 / 状态组合查询 | M |
| **R10-A** | **v0.23.0** | **🆕 AI 智能助手(深度)** | 消费 R6 AST → AI 生成 / 改写脚本即时校验;消费 R10 体检结果 → AI 修复方案一键 apply;自然语言 → 保存查询;演出路径分析建议;人物一致性诊断 | AI 建议全部通过类型 / 结构检查后才允许 apply;不产生"跑不通"的输出 | L |
| R11 | v0.24.0 | **完整模板与数据库** | 模块化模板;模板分配 / 继承 / 迁移;扩展到资源 / 文档 / 地图;收藏夹;批量编辑 | 模板新增字段后实例安全迁移;所有主要对象可套用模板 | L |
| R12 | v0.25.0 | **Localization 与 VO(含 AI 翻译辅助)** | 项目语言 / 可本地化字段 / 翻译状态 / 原文变更过期标记 / Excel 往返 / 配音绑定与播放;AI 翻译初稿(必须经审校才落表) | 完整导出翻译表 → 修改 → 再导入;配音与 Line ID 稳定对应 | L |
| R13 | v0.26.0 | **专业导入导出(含 AI 辅助解析)** | DOCX / PDF / EPUB / 完整 Markdown / Excel / Final Draft;可选章节编译;AI 辅助反向解析扫描件 PDF 表格、图注 | 小说可直接生成投稿稿件;FDX / Excel 可往返且有冲突报告 | L |
| R14 | v0.27.0 | **地图与工作区增强** | 地图图层 / 路径 / 形状 / 文字 / 锁定 / 显隐;跨模块树状目录;多面板 / 多窗口 | 地图承担空间设计;实体 / 资料 / 文档 / 资源都支持文件夹树 | M |
| R15 | v0.28.0 | **Unity / Unreal 接入** | 基于通用引擎包制作 Unity 导入器、Unreal 导入器和示例工程 | 引擎可导入实体 / 对白 / 变量 / Localization,并运行分支 | L |
| R16 | v1.0.0 | **稳定版** | 性能 / 崩溃恢复 / 备份策略 / 无障碍 / 快捷键 / 帮助文档 / 安装升级测试 | 大型真实项目长期使用无数据丢失;完成完整回归测试 | L |

### 关于 AI / 知识库集成的设计准则

- **不建议单独一批做完** — AI 集成的天花板取决于项目基础设施,分两批插入最经济:
  - **R3-A(v0.15.0,轻量)** 只写"内容"不改"结构":AI 抽实体 / 场景 / 时间点后走已有的 ImportPreview 通道,用户确认才 apply。放在 R3 双视图之后,因为需要稳定叙事单元
  - **R10-A(v0.23.0,深度)** 消费 R6 AST + R10 体检系统:AI 生成 / 改写脚本要能被类型检查即时校验;AI 修复方案基于结构化的体检结果,一键 apply。放在 R10 之后,否则 AI 建议要么无法验证要么无从触发
  - **R12 / R13 · 内嵌不单独成批** — 翻译辅助属于 L10n 工作流一部分;DOCX / PDF 反向解析属于导入器一部分
- **LLM 服务应可切换**(OpenAI 兼容 API / Anthropic / Ollama 本地):本地优先的项目不能强制走某家云;API Key 存 localStorage 或桌面 keychain,不同步到云端
- **AI 输出必须走已有的合并通道**(ImportPreview、体检修复 apply、脚本校验),不建立独立的"AI 直接写项目"路径
- **提示词模板与调用记录**留在项目内可导出,便于用户自建 prompt 库

### 后续增强(独立小批,不阻塞主线)

- 矢量地点编辑;音视频 / 大图原文件写入桌面项目文件夹(R8 前可能先出个人体验版)
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
- 音视频/大图原文件的 Rust 文件夹存储(网页模式缩略图已可用;`assets/` 目录读写框架已就位,只差把二进制原文件 push 到 files 列表)

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
cd src-tauri && cargo test --lib   # Rust 单元测试
npm run tauri dev    # 桌面版调试
npm run tauri build  # 桌面版打包
```

发布、部署、协作后端启用见 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。
