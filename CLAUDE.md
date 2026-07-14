# CLAUDE.md

本文件供 AI 助手(Claude Code / opencode 等)快速进入项目上下文。详细文档见 [README.md](./README.md) 与 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。

## 项目定位

**TheLoom 叙事织机** —— 本地优先的叙事设计工具,面向小说写作与游戏剧本。结构化叙事方法参考 articy:draft,叠加自有模块(头脑风暴、罗琳式表格大纲、故事时间线、资料卡片)。

- 网页版(Cloudflare Pages)+ Windows 桌面版(Tauri 2),黑白灰浅色 UI
- 数据默认存本地:网页版 localStorage,桌面版可绑定本地文件夹(Obsidian 兼容)
- 多项目槽位、撤销/重做(50 步)、端到端加密的接力式云协作

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
- Rust `load_project_dir` / `save_project_dir` 两个 `#[tauri::command]`,带路径穿越防护(`safe_join`)与已删除文件清理
- 新增模块要文件夹往返时:`XxxToMd`/`mdToXxx` + Rust `read_md_dir` 扩展 + `save_project_dir` 清理循环纳入新目录 + `cargo test --lib` 覆盖

### 流程编辑器 `src/modules/flow/`
React Flow(`@xyflow/react`)。本地画布状态防抖 350ms 回写 store;卸载/切流程时立即冲刷。节点类型在 `nodes.tsx`,演出模式在 `Player.tsx`。`FlowNodeData` 是开放结构(`[key: string]: unknown`),扩展节点属性直接加字段。

## articy:draft X 复刻进度

参考 articy 单人版功能清单的对照(详细 gap analysis 见对话历史):

**已实现**
- 流程编辑器(嵌套子流程、出口引脚、演出模式、剧本导出)
- 实体库(自定义字段模板、头像、反向引用)
- 脚本系统(全局变量、条件/指令节点、选项级逻辑、一次性选项、检定节点、变量校验提示)
- 检查工具(演出/体检面板:孤儿节点、分支缺口、未定义变量、空对白、悬挂附件、字数统计)
- 导出(JSON 备份、流程→Markdown 剧本、文档→Markdown 剧本)
- 多人协作(端到端加密云房间)
- 通用附件(`AttachmentEditor` 已接入:流程节点 / 实体 / 资料卡 / 时间线事件)
- 资源库 + 文档视图(本轮新增)

**明确暂缓**
- 音视频/大图原文件的 Rust 文件夹存储(网页模式缩略图已可用;`assets/` 目录读写框架已就位,只差把二进制原文件 push 到 files 列表)

**主要缺口(按建议优先级)**
1. 技术名(Technical Name)+ 文件夹式 Navigator 树
2. 通用模板系统(扩展到流程节点 + 约束/只读属性)
3. 对象属性在脚本中寻址(`entity.skill`)+ seen/unseen/fallback 关键字
4. 富文本对白(粗体/斜体/列表)
5. Localization 本地化模块
6. 版本历史 + 回滚(超出 50 步撤销)
7. Conflict Search 增强(重复技术名、损坏资产)
8. Excel/FinalDraft 互通、矢量地点编辑、多窗口

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
