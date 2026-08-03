# 无界面导出 CLI(R20-3)

把 TheLoom 项目文件夹导出成引擎包,不打开界面。用于 CI 流水线、开发期自动同步到引擎工程,以及批量出包。

## 构建

```bash
npm run build:runtime   # 配置里勾了「运行库随包」时需要
npm run build:cli       # → cli-dist/theloom-cli.mjs
```

产物是单文件 ES Module,除 Node 内置模块外零依赖(Node 18+)。

## 用法

```bash
node cli-dist/theloom-cli.mjs export --project <项目目录> [选项]
```

| 选项 | 说明 |
|---|---|
| `--project, -p <目录>` | 项目文件夹(含 `project.json`),必填 |
| `--config, -c <名字>` | 用项目里保存的命名导出配置;缺省取第一个,项目没有配置时用默认规则 |
| `--out, -o <路径>` | 输出目标。`.zip` 结尾写压缩包,否则当目录做同步;不给则只跑检查不写文件 |
| `--flows <a,b>` | 覆盖配置的流程选择(技术名或 id) |
| `--clean` | 目录同步时删除上次由本工具写入、这次不再产出的文件 |
| `--no-gate` | 跳过导出前检查(CI 里不建议) |
| `--watch` | 监听项目目录,内容变化后自动重新导出 |
| `--json` | 以 JSON 输出结果,便于流水线解析 |
| `--quiet` | 只在出错时输出 |

## 退出码

| 码 | 含义 | 典型处理 |
|---|---|---|
| 0 | 成功 | — |
| 2 | 用法或输入错误(参数缺失、项目读不到、配置名不存在) | 修流水线配置 |
| 3 | 脚本 / 高级体检 / 路径检查有阻断项 | 让写作或策划修流程 |
| 4 | 场景化回归测试失败 | 剧情行为变了,确认是有意改动还是回归 |
| 5 | 目标目录里已有的包是不兼容的 schema 主版本 | 引擎侧先适配,再清空目标目录 |
| 6 | 读写文件失败 | 看磁盘权限、路径、`build:runtime` 是否跑过 |

检查的判定范围与界面一致：**只看真正进包的对象**，没选中的流程不会拦住本次导出。

## 目录同步

`--out` 指向目录时，包会铺开写进去，并且**只写内容真的变了的文件**。同一份项目内容反复导出得到完全相同的字节（包内时间戳取项目 `updatedAt` 而不是当前时间），所以引擎的资源导入器不会被反复触发。

目录里会留一个 `.theloom-sync.json` 记录本次产出的文件清单，`--clean` 依据它删除陈旧文件——引擎工程里的其他文件一律不碰。

```bash
# 同步进 Godot 工程
node cli-dist/theloom-cli.mjs export -p ./我的项目 -c 'Godot 完整包' -o ../godot-game/theloom --clean
```

## 开发期监听

```bash
node cli-dist/theloom-cli.mjs export -p ./我的项目 -o ../godot-game/theloom --watch
```

按内容指纹判断是否真的变化，编辑器保存时的多次写入只会触发一次重新导出。Ctrl+C 退出。

## CI 示例（GitHub Actions）

```yaml
name: 引擎包
on:
  push:
    paths: ['我的项目/**']

jobs:
  export:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build:runtime
      - run: npm run build:cli

      - name: 导出引擎包
        id: export
        run: |
          node cli-dist/theloom-cli.mjs export \
            --project 我的项目 \
            --config 'Godot 完整包' \
            --out dist/engine \
            --clean --json > export.json
        continue-on-error: true

      - name: 按失败类型分流
        if: steps.export.outcome == 'failure'
        run: |
          code=$?
          case "${{ steps.export.outputs.exit-code || 1 }}" in
            3) echo "::error::流程有阻断问题，见 export.json" ;;
            4) echo "::error::回归测试失败，剧情行为可能变了" ;;
            5) echo "::error::引擎包 schema 主版本不兼容，需要引擎侧适配" ;;
            *) echo "::error::导出失败" ;;
          esac
          cat export.json
          exit 1

      - uses: actions/upload-artifact@v4
        with:
          name: engine-package
          path: dist/engine
```

`--json` 的输出形如：

```json
{
  "ok": true,
  "code": 0,
  "message": "已同步到 …:写入 8、跳过 0、删除 0",
  "stats": { "flows": 1, "nodes": 3, "entities": 1, "assets": 1, "bundledAssets": 1, "missingAssets": 0, "warnings": 0 },
  "config": "Godot 完整包",
  "sync": { "written": ["…"], "skipped": [], "removed": [] }
}
```

失败时同样是一行 JSON（写到 stderr），带 `code` 与 `blocking` / `failedTests` 明细。

## 验收产物

同步出来的目录如果包含了资源原文件与运行库，可以直接用脱机验收脚本确认它真的能独立跑：

```bash
node examples/engine-demo/selfcontained.mjs dist/engine
```
