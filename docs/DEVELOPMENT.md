# 开发与部署

## 技术栈

Vite · React 18 · TypeScript · @xyflow/react (React Flow) · zustand · yaml · Tauri 2 · Cloudflare Pages Functions · D1

## 本地开发

```bash
npm install
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 产物输出到 dist/
```

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
├── entities/          实体卡,每个实体一个 Markdown 文件(YAML frontmatter)
├── research/          资料卡,每张卡一个 Markdown 文件
└── assets/            实体头像等二进制资源
```

- `entities/`、`research/` 下新建的 `.md` 文件在下次加载时自动导入,文件名即名称,frontmatter 中 `kind: character` 可指定实体类型
- 在应用内删除实体或资料卡会同步删除对应文件
- `project.json` 为结构化数据,不建议手工编辑
- 同一时间请只在一台设备上编辑同一文件夹(最后写入者获胜)

## 协作接口

```
GET  /api/room/:id   Authorization: Bearer <token>
     → { version, updatedAt, payload }

PUT  /api/room/:id   Authorization: Bearer <token>
     body { baseVersion, payload }
     → { version } | 409 { version }(基线过期)
```

`token` 由客户端从口令经 PBKDF2 派生,服务端仅存 SHA-256 哈希;`payload` 为 gzip + AES-256-GCM 加密后的 base64 密文,按 20 万字符分块存储于 D1。首次 PUT 创建房间,口令由创建者确定。
