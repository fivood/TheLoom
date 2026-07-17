/**
 * 引擎包 JSON Schema(draft-07,随 schemaVersion 演进)。
 * 引擎侧可用任意 JSON Schema 校验器在导入前验证包结构。
 */
import { ENGINE_SCHEMA_VERSION } from './package';

export const ENGINE_PACKAGE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: `https://theloom.pages.dev/schema/theloom-package-${ENGINE_SCHEMA_VERSION}.json`,
  title: 'TheLoom Engine Package',
  type: 'object',
  required: ['schema', 'schemaVersion', 'meta', 'variables', 'entities', 'flows', 'assets', 'index', 'manifest'],
  properties: {
    schema: { const: 'theloom-package' },
    schemaVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    meta: {
      type: 'object',
      required: ['projectName', 'exportedAt', 'generator'],
      properties: {
        projectName: { type: 'string' },
        exportedAt: { type: 'number' },
        generator: { type: 'string' },
      },
    },
    rules: {
      type: 'object',
      properties: {
        includeLayout: { type: 'boolean' },
        includeAnnotations: { type: 'boolean' },
        entities: { enum: ['all', 'referenced'] },
        assets: { enum: ['all', 'referenced'] },
      },
    },
    variables: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'type', 'value'],
        properties: {
          name: { type: 'string' },
          type: { enum: ['boolean', 'number', 'string'] },
          value: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'kind', 'fields'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string' },
          technicalName: { type: 'string' },
          color: { type: 'string' },
          emoji: { type: 'string' },
          summary: { type: 'string' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              required: ['label', 'value'],
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
                type: { type: 'string' },
                filterKind: { type: 'string' },
              },
            },
          },
        },
      },
    },
    flows: {
      type: 'array',
      items: {
        allOf: [
          { $ref: '#/definitions/sub' },
          {
            type: 'object',
            required: ['id', 'name'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              technicalName: { type: 'string' },
            },
          },
        ],
      },
    },
    assets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'kind', 'mime', 'size'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { enum: ['image', 'audio', 'video', 'file'] },
          mime: { type: 'string' },
          size: { type: 'number' },
          technicalName: { type: 'string' },
          hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          ext: { type: 'string' },
          license: { type: 'string' },
          source: { type: 'string' },
          fileName: { type: 'string' },
        },
      },
    },
    attachments: {
      type: 'object',
      additionalProperties: { type: 'array', items: { type: 'string' } },
    },
    index: {
      type: 'object',
      required: ['technicalNames', 'nodes', 'speakers', 'assetOwners'],
      properties: {
        technicalNames: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['kind', 'id'],
            properties: {
              kind: { enum: ['flow', 'entity', 'asset', 'node'] },
              id: { type: 'string' },
              flowId: { type: 'string' },
            },
          },
        },
        nodes: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['flowId', 'path', 'type'],
            properties: {
              flowId: { type: 'string' },
              path: { type: 'array', items: { type: 'string' } },
              type: { type: 'string' },
            },
          },
        },
        speakers: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
        assetOwners: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
      },
    },
    manifest: { type: 'object', additionalProperties: { type: 'string' } },
  },
  definitions: {
    node: {
      type: 'object',
      required: ['id', 'type', 'data'],
      properties: {
        id: { type: 'string' },
        type: { enum: ['dialogue', 'fragment', 'hub', 'condition', 'instruction', 'jump', 'exit', 'check', 'note', 'zone'] },
        position: {
          type: 'object',
          required: ['x', 'y'],
          properties: { x: { type: 'number' }, y: { type: 'number' } },
        },
        data: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            text: { type: 'string' },
            speakerId: { type: 'string' },
            technicalName: { type: 'string' },
            checkExpr: { type: 'string' },
            checkDc: { type: 'number' },
            checkRed: { type: 'boolean' },
            sub: { $ref: '#/definitions/sub' },
            fields: { type: 'array' },
            color: { type: 'string' },
            w: { type: 'number' },
            h: { type: 'number' },
          },
        },
      },
    },
    edge: {
      type: 'object',
      required: ['id', 'source', 'target'],
      properties: {
        id: { type: 'string' },
        source: { type: 'string' },
        target: { type: 'string' },
        sourceHandle: { type: ['string', 'null'] },
        label: { type: 'string' },
        condition: { type: 'string' },
        effect: { type: 'string' },
        once: { type: 'boolean' },
        fallback: { type: 'boolean' },
      },
    },
    sub: {
      type: 'object',
      required: ['nodes', 'edges'],
      properties: {
        nodes: { type: 'array', items: { $ref: '#/definitions/node' } },
        edges: { type: 'array', items: { $ref: '#/definitions/edge' } },
      },
    },
  },
} as const;

/** 打进导出 zip 的使用说明 */
export function engineReadme(projectName: string): string {
  return `# TheLoom 引擎包 · ${projectName}

本压缩包由 TheLoom 叙事织机导出,供游戏引擎 / 自研运行时消费。

## 内容

- \`theloom-package.json\` —— 完整数据包:变量、实体、流程(含嵌套子流程)、资源清单、附件挂接、索引、内容哈希清单
- \`theloom-package.schema.json\` —— 包结构的 JSON Schema(draft-07),导入前可校验
- \`theloom-types.d.ts\` —— TypeScript 类型定义,变量名与各类技术名均为字面量联合类型

## 运行对白流程

TheLoom 提供独立运行库(theloom-runtime,零依赖 ES Module),行为与编辑器内演出完全一致:

\`\`\`js
import { FlowRuntime } from './theloom-runtime.js';

const pkg = JSON.parse(fs.readFileSync('theloom-package.json', 'utf8'));
const run = new FlowRuntime(pkg, '流程技术名或id', { seed: 42 });
run.start();
// run.log     → 演出记录(对白/指令/检定…)
// run.choices → 当前选项
run.choose(0); // 选第 1 项
// run.ended   → 是否结束
// run.snapshot() / run.restore(s) → 存档 / 读档(掷骰不漂移)
\`\`\`

## 约定

- 节点行进语义:单出边的汇聚点 / 指令 / 条件 / 出口 / 检定自动前进;无出边逐层回溯父流程;\`exit\` 走父层片段的命名引脚;\`fallback\` 边在有其他可用选项时被遮蔽;\`once\` 选项选过即隐藏
- 条件 / 指令 / 检定技能值是 TheLoom 脚本源码(运行库内置解释器),包含 \`seen("节点技术名")\` 与 \`实体技术名.字段名\` 寻址
- 检定:2d6 + 技能 ≥ 难度;\`checkRed\` 为真时只掷一次、结果沿用;RNG 为 mulberry32,同种子完全可复现
- 资源原文件不在包内:\`assets[].fileName\` 指向项目文件夹 \`assets/\` 下按内容哈希命名的文件,\`hash\` 为其 SHA-256
- \`manifest\` 为对象内容哈希(kind:id → hash),配合增量包(theloom-delta)做部分更新
`;
}
