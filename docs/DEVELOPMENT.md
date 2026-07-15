# 开发与部署

## 技术栈

Vite · React 18 · TypeScript · @xyflow/react (React Flow) · zustand · yaml · Tauri 2 · Cloudflare Pages Functions · D1

## 本地开发

```bash
npm install
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 产物输出到 dist/
npm test         # 运行前端核心逻辑测试
npm run test:watch  # 开发时监听测试
```

推送到 `main` 或提交 Pull Request 时,[verify.yml](../.github/workflows/verify.yml) 会自动运行前端测试、生产构建和 Rust 单元测试。桌面版发布流程也会在打包前执行测试,失败时停止发布。

## 桌面版(Tauri)

需要 Rust 工具链(rustup,MSVC target)。

```bash
npm run tauri dev     # 开发调试
npm run tauri build   # 打包,安装程序位于 src-tauri/target/release/bundle/nsis/
```

Rust 端单元测试:

```bash
cd src-tauri && cargo test --lib
```

## 部署到 Cloudflare Pages

仓库自带 GitHub Actions 工作流([deploy.yml](../.github/workflows/deploy.yml)),推送到 `main` 自动构建并部署。启用步骤:

1. 在 [Cloudflare Dashboard → API Tokens](https://dash.cloudflare.com/profile/api-tokens) 使用 Edit Cloudflare Workers 模板创建 Token;Account ID 位于 Cloudflare 首页右侧栏。
2. GitHub 仓库 → Settings → Secrets and variables → Actions,添加 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。

未配置密钥时,工作流仅验证构建并跳过部署。

也可以在 Cloudflare Dashboard → Workers & Pages 创建 Pages 项目并连接本仓库,构建命令 `npm run build`,输出目录 `dist`。

## 启用协作后端(可选)

协作同步基于 Pages Functions(`functions/api/room/[id].ts`)与 D1 数据库:

```bash
npx wrangler d1 create theloom-sync
```

将输出的 `database_id` 填入 [wrangler.toml](../wrangler.toml)(取消 `[[d1_databases]]` 段的注释)后重新部署。未绑定 D1 时,协作接口返回 501,前端提示"云同步未配置",其余功能不受影响。

本地联调(模拟 D1):

```bash
npm run build
npx wrangler pages dev dist --d1=SYNC_DB --port 8788
```

## 项目文件夹格式(桌面版)

```
我的小说/
├── project.json       流程、大纲、时间线、风暴、变量等结构化数据
├── project.json.bak   自动恢复副本(由应用管理)
├── entities/          实体卡,每个实体一个 Markdown 文件(YAML frontmatter)
├── research/          资料卡,每张卡一个 Markdown 文件
├── documents/         文档,每篇一个 Markdown 文件(结构化块 + 剧本预览)
└── assets/            实体头像等二进制资源
```

- `entities/`、`research/`、`documents/` 下新建的 `.md` 文件在下次加载时自动导入,文件名即名称,frontmatter 中 `kind: character` 可指定实体类型
- 在应用内删除实体、资料卡或文档会同步删除对应文件
- `project.json` 为结构化数据,不建议手工编辑
- 文件写入先落到临时文件再替换;`project.json.bak` 最多每 10 分钟更新一次,主文件损坏时桌面端自动回退并在顶栏提示
- 同一时间请只在一台设备上编辑同一文件夹(最后写入者获胜)

浏览器存储与桌面端本地缓存都会在覆盖当前项目之前保留一个滚动恢复点,最多每 10 分钟更新一次。损坏的原始内容不会被自动覆盖,可从“工具 → 恢复与备份”下载或清除。

## 发布与自动更新

推送 `v*` 标签触发 [release.yml](../.github/workflows/release.yml):在 Windows Runner 上构建 NSIS 安装包、用 minisign 私钥签名更新包,并连同自动更新清单 `latest.json` 发布为 GitHub Release。

发布新版本的步骤:

1. 同步修改三处版本号:`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`
2. 更新根目录的 [`RELEASE_NOTES.md`](../RELEASE_NOTES.md),其内容会同时写入 GitHub Release 和桌面端更新弹窗
3. 提交后打标签并推送:`git tag v0.4.0 && git push origin v0.4.0`

密钥:

- 更新包签名私钥保存在仓库 Secret `TAURI_SIGNING_PRIVATE_KEY`(本机备份于 `~/.tauri/theloom.key`,**丢失后将无法对后续更新签名**,老版本用户只能手动重装);公钥内置在 `tauri.conf.json`
- 私钥无口令,工作流中密码传空串

### 自动更新与大陆网络

桌面版启动后静默检查更新。更新清单与安装包不直连 GitHub,而是经 Cloudflare Pages Functions 中转:

```
GET /api/update/{target}/{version}   更新清单(重写下载地址为本站代理,边缘缓存 5 分钟)
GET /api/download/{tag}/{file}       Release 资产流式代理(仅限本仓库,边缘缓存 1 天)
GET /api/download/latest             302 到最新 Windows 安装包(固定下载入口)
```

Cloudflare 边缘节点到 GitHub 的连接稳定,大陆用户只需能访问 `theloom.pages.dev` 即可完成下载与更新。

## 协作接口

```
GET  /api/room/:id   Authorization: Bearer <token>
     → { version, updatedAt, payload }

PUT  /api/room/:id   Authorization: Bearer <token>
     body { baseVersion, payload }
     → { version } | 409 { version }(基线过期)
```

`token` 由客户端从口令经 PBKDF2 派生,服务端仅存 SHA-256 哈希;`payload` 为 gzip + AES-256-GCM 加密后的 base64 密文,按 20 万字符分块存储于 D1。首次 PUT 创建房间,口令由创建者确定。
