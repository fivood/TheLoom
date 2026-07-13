# 叙事织机 TheLoom 🪡

一个面向写作者和叙事设计师的本地工具,灵感来自 articy:draft X,并融合了头脑风暴画布、J.K. 罗琳的表格大纲法、故事时间线和写作前的资料卡片归档。

## 七大模块

| 模块 | 说明 |
| --- | --- |
| 🧵 **流程** | articy 式节点流程编辑器:对白、剧情片段、汇聚点、条件分支、指令、跳转、出口七类节点,拖拽连线构建分支叙事;**剧情片段可双击进入内部子画布,无限层级嵌套**,面包屑导航返回;子流程内的「出口」节点会成为父层片段的命名引脚,实现跨层连线;**▶ 演出模式**像视觉小说一样试玩分支(条件自动求值、指令实时改变量);**📜 导出剧本**生成分段式 Markdown 文稿(Shift+点击导出全部流程) |
| 👤 **实体** | 角色 / 地点 / 物品 / 阵营 / 设定卡片库,支持自定义字段和头像图片;角色可在流程中作为说话人引用;属性面板的「出现于」列出该实体在全项目的引用与提及,点击直达 |
| 💡 **风暴** | 自由画布上的彩色便签,双击新建、拖拽连线,把灵感织成网 |
| 📋 **大纲** | 罗琳式表格大纲:每行一章,每列一条剧情线,逐格检查每条线在每一章的进展与留白 |
| ⏳ **时间线** | 故事时间线:轨道(谁的线)× 时间点(故事时刻),事件可关联实体。大纲记「讲述顺序」,时间线记「发生顺序」,倒叙插叙对照使用 |
| 🗂️ **资料** | 写作前的资料卡片:分类、标签、搜索、置顶,把设定和考据归档妥当 |
| 🔣 **变量** | 全局变量表,配合流程中的条件分支和指令节点追踪剧情状态 |

## 运行方式

### 网页版(开发)

```bash
npm install
npm run dev      # http://localhost:5173,数据存浏览器 localStorage
```

### 桌面版(Tauri)

```bash
npm run tauri dev     # 开发调试
npm run tauri build   # 打包,安装程序在 src-tauri/target/release/bundle/nsis/
```

需要 Rust 工具链(`rustup`,MSVC target)。

## 通用能力

- **全局搜索**:`Ctrl+K` 打开,横跨全部模块,回车直达(流程结果会自动打开对应层级并选中节点)
- **撤销 / 重做**:`Ctrl+Z` / `Ctrl+Y`,50 步历史,连续打字自动合并为一步

## 部署到 Cloudflare Pages(网页版)

仓库自带 GitHub Actions 工作流([deploy.yml](.github/workflows/deploy.yml)),每次 push 到 `main` 自动构建并部署。启用只需两步:

1. 在 [Cloudflare Dashboard → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens) 创建一个 Token,使用 **Edit Cloudflare Workers** 模板(或自定义授予 `Cloudflare Pages: Edit` 权限);Account ID 在 Cloudflare 首页右侧栏可以找到。
2. GitHub 仓库 → Settings → Secrets and variables → Actions,添加两个 Secret:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

之后每次推送自动发布到 `theloom.pages.dev`。未配置密钥时工作流只验证构建、跳过部署,不会报错。

> 也可以不用 Actions:在 Cloudflare Dashboard → Workers & Pages → 创建 Pages 项目 → 连接此 GitHub 仓库,构建命令 `npm run build`、输出目录 `dist`,效果相同。

**网页版的定位**:纯静态、无后端,数据只存在访问者自己的浏览器 localStorage 里(不会上传)。适合演示和轻量使用;认真写作请用桌面版绑定项目文件夹(见下文),那才有文件级备份、网盘同步和 Obsidian 联动。

## 多人协作(云端房间)

顶栏「☁ 协作」面板:一人填**房间码 + 口令**后「推送」即创建房间,把两者告诉同伴,同伴「拉取」即可接力编辑。工作节奏:**开工先拉取,改完就推送**;推送时若云端已被同伴更新会提示冲突,可选择拉取覆盖本地或强制覆盖云端(不做自动合并,同一时间建议只有一人编辑)。

- **端到端加密**:口令在本地派生出鉴权令牌(服务器只存哈希)和 AES-256-GCM 加密密钥,项目先 gzip 再加密上传——**服务器只保存密文,忘记口令数据即无法找回**
- 版本号乐观锁保证不会静默互相覆盖
- 网页版、桌面版都能用(桌面版在面板里填服务器地址,如 `https://theloom.pages.dev`)

**部署方启用步骤**(在 Cloudflare Pages 部署的基础上):

```bash
npx wrangler d1 create theloom-sync
```

把输出的 `database_id` 填进 [wrangler.toml](wrangler.toml)(取消 `[[d1_databases]]` 三行的注释),重新部署即可。未启用时其余功能不受影响,协作面板会提示"云同步未配置"。

## 数据存储与云同步

- **网页版**:数据自动保存在浏览器 localStorage;顶栏可导出 / 导入 `.loom.json` 备份。
- **桌面版**:点击顶栏「📁 项目文件夹」,把项目绑定到磁盘上的任意文件夹,之后所有改动自动写入该文件夹。

### OneDrive / Google Drive 同步

把项目文件夹选在网盘同步目录里即可,例如:

```
C:\Users\你\OneDrive\写作\我的小说\
G:\我的云端硬盘\写作\我的小说\      (Google Drive 桌面版)
```

网盘客户端会自动把改动同步到云端和其他设备。在另一台电脑上打开 TheLoom,选择同一个文件夹即可继续工作(顶栏「⟳ 重新加载」可拉取磁盘上的最新改动)。

> 注意:同一时间请只在一台设备上编辑,本工具采用"最后写入者获胜"策略,不做合并。

### 项目文件夹结构

```
我的小说/
├── project.json       流程、大纲、时间线、风暴、变量等结构化数据
├── entities/          实体卡,每个实体一个 Markdown 文件
│   ├── 林晚.md
│   └── 守店人.md
└── research/          资料卡,每张卡一个 Markdown 文件
    └── 织机的结构.md
```

## Obsidian 联动

项目文件夹本身就是 Obsidian 兼容的:

1. **作为库打开**:Obsidian →「打开文件夹作为库」→ 选择项目文件夹;或者把项目文件夹放进现有库的子目录。
2. **实体卡和资料卡就是普通笔记**:YAML frontmatter(类型、颜色、标签等)+ 正文,可以在 Obsidian 里阅读、编辑、加双链 `[[林晚]]`、打标签,出现在图谱里。
3. **双向同步**:
   - 在 Obsidian 里改了笔记正文 → 回到 TheLoom 点「⟳ 重新加载」即可看到;
   - 在 `entities/` 或 `research/` 里**新建**的 `.md` 文件,下次加载时自动导入为实体 / 资料卡(文件名即名称,frontmatter 里写 `kind: character` 可指定实体类型);
   - 在 TheLoom 里删除实体 / 资料卡,会同步删除对应 `.md` 文件。
4. **frontmatter 字段**:实体卡的自定义字段直接写进 frontmatter,在 Obsidian 的属性面板里可见可编辑。

> `project.json`(流程 / 大纲 / 时间线)是结构化数据,不适合手工编辑,Obsidian 里请只把它当附件。

## 技术栈

Vite · React 18 · TypeScript · @xyflow/react (React Flow) · zustand · yaml · Tauri 2
