# CLAUDE.md

本文件供 AI 助手(Claude Code / opencode 等)快速进入项目上下文。详细文档见 [README.md](./README.md) 与 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。

## 项目定位

**TheLoom 叙事织机** —— 本地优先的叙事设计工具,面向小说写作与游戏剧本。结构化叙事方法参考 articy:draft,叠加自有模块(头脑风暴、罗琳式表格大纲、故事时间线、资料卡片)。

- 网页版(Cloudflare Pages)+ Windows 桌面版(Tauri 2),黑白灰浅色 UI
- 数据默认存本地:网页版 localStorage,桌面版可绑定本地文件夹(Obsidian 兼容)
- 多项目槽位、撤销/重做(50 步)、端到端加密的接力式云协作

## 当前工作计划(R1,更新于 2026-07-15)

### 当前基线

- 已发布版本:`v0.10.0`,R1 全模块 Navigator + 对话框统一 + Navigator 易用性已发布
- R1 第一批(全模块 Navigator 与文件夹归档)+ R1 第二批(R1-2:对话框统一 + Navigator 易用性)均已上线,网页部署与桌面签名安装包均由 CI 构建
- 版本号已同步至 `0.10.0`(`package.json` / `tauri.conf.json` / `Cargo.toml`)
- 最近验证基线:`npm test` 35 项通过、`npm run build` 通过、`cargo test --lib` 通过,并完成五个 Navigator + 对话框的 Playwright 实际交互验证

### 后续待办(按顺序开发)

| 优先级 | 批次 | 待办 | 完成标准 |
|---|---|---|---|
| ~~P0~~ | ~~R1-2 Navigator 易用性~~ | ~~拖拽移动;Ctrl/Shift 多选;批量归档;自定义排序~~ | ✅ 已完成:`order` 字段 + 稳定排序、HTML5 拖拽(对象→文件夹、文件夹重排 / 重父)、Ctrl/Shift 多选 + 批量归档条、五个 Navigator 一致 |
| ~~P0~~ | ~~R1-2 对话框统一~~ | ~~替换原生 `prompt()`;删除确认文案统一~~ | ✅ 已完成:`src/dialog.ts` + `Dialog.tsx` 统一弹窗;全量替换 `prompt` / `confirm` / `alert`;Esc 取消 Enter 确认;文件夹删除文案统一且不级联删除正文 |
| P0 | R1-3 长篇写作体验 | 文档富文本补段落级标题、列表、引用;保持结构化块与 Markdown 往返稳定 | 编辑、导出、文件夹重载后格式不丢;文档转流程不受影响 |
| P1 | R1-4 导入导出 | Excel `.xlsx` 与 Final Draft 互通,先做可逆导出,再做带预检的导入 | 中文、分支、角色、稳定 ID 可往返;导入始终先预览且不覆盖当前项目 |
| P1 | R1-5 Localization | 建立 UI 文案资源层和项目内容本地化模块 | 中文默认体验不退化;可添加语言、检查缺失条目并导出 |
| P2 | 后续增强 | 矢量地点编辑、多窗口、音视频/大图原文件写入桌面项目文件夹 | 分批独立交付,不与 R1 核心改动混在同一版本 |

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
- 未经用户明确要求,不要推送 R1、移动版本标签或发布安装包;发布前更新版本号、`RELEASE_NOTES.md` 并确认桌面更新清单

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
