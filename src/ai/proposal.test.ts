import { describe, expect, it } from 'vitest';
import { sampleProject } from '../sample';
import type { FlowNode, Project, SubFlow } from '../types';
import { fingerprintValue } from './context';
import {
  dryRunAiProposal,
  parseAiProposal,
  type AiProposal,
  type AiProposalOperation,
} from './proposal';

async function proposal(
  project: Project,
  operations: AiProposalOperation[],
  overrides: Partial<AiProposal> = {},
): Promise<AiProposal> {
  return {
    version: 1,
    id: 'proposal-1',
    task: 'content-edit',
    summary: '测试提案',
    baselineProjectFingerprint: await fingerprintValue(project),
    contextSourceKeys: [],
    evidenceSourceKeys: [],
    operations,
    confirmations: [],
    ...overrides,
  };
}

function operationBase(id: string) {
  return { id, reason: '改善叙事表达', confidence: 0.9 };
}

function findNode(
  sub: SubFlow,
  predicate: (node: FlowNode) => boolean,
  path: string[] = [],
): { node: FlowNode; path: string[] } | null {
  for (const node of sub.nodes) {
    if (predicate(node)) return { node, path };
    if (node.data.sub) {
      const found = findNode(node.data.sub, predicate, [...path, node.id]);
      if (found) return found;
    }
  }
  return null;
}

describe('AI 提案安全内核', () => {
  it('拒绝未知操作、额外字段和任意代码载荷', () => {
    const parsed = parseAiProposal({
      version: 1,
      id: 'evil',
      task: 'content-edit',
      summary: '执行代码',
      baselineProjectFingerprint: `sha256:${'0'.repeat(64)}`,
      contextSourceKeys: [],
      evidenceSourceKeys: [],
      operations: [{
        kind: 'execute_javascript',
        id: 'op-1',
        reason: '绕过限制',
        confidence: 1,
        code: 'globalThis.fetch("https://evil.example")',
      }],
      confirmations: [],
      projectReplacement: {},
    });

    expect(parsed.proposal).toBeUndefined();
    expect(parsed.issues.some((issue) => issue.code === 'schema.invalid')).toBe(true);
  });

  it('在克隆项目上试运行正文与已有字段更新，不修改原项目', async () => {
    const project = sampleProject();
    const document = project.documents[0];
    const block = document.blocks[0];
    const entity = project.entities.find((item) => item.fields.length > 0)!;
    const field = entity.fields[0];
    const originalBlock = block.text;
    const originalField = field.value;
    const raw = await proposal(project, [
      {
        kind: 'update_document_block_text',
        ...operationBase('text-1'),
        documentId: document.id,
        blockId: block.id,
        text: `${block.text}\n补充一句。`,
      },
      {
        kind: 'update_entity_field',
        ...operationBase('field-1'),
        entityId: entity.id,
        fieldId: field.id,
        value: `${field.value}（修订）`,
      },
    ]);

    const result = await dryRunAiProposal(project, raw);

    expect(result.status).not.toBe('blocked');
    expect(result.metrics).toMatchObject({ requestedOperations: 2, appliedOperations: 2 });
    expect(result.changes).toHaveLength(2);
    expect(result.preview?.documents[0].blocks[0].text).toContain('补充一句');
    expect(project.documents[0].blocks[0].text).toBe(originalBlock);
    expect(project.entities.find((item) => item.id === entity.id)?.fields[0].value).toBe(originalField);
  });

  it('项目变化后阻止过期提案', async () => {
    const project = sampleProject();
    const entity = project.entities.find((item) => item.fields.length > 0)!;
    const field = entity.fields[0];
    const raw = await proposal(project, [{
      kind: 'update_entity_field',
      ...operationBase('field-1'),
      entityId: entity.id,
      fieldId: field.id,
      value: '新值',
    }]);
    project.name += ' 已变化';

    const result = await dryRunAiProposal(project, raw);

    expect(result.status).toBe('blocked');
    expect(result.preview).toBeUndefined();
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'baseline.stale' }));
  });

  it('拒绝提案引用未发送的上下文来源', async () => {
    const project = sampleProject();
    const raw = await proposal(project, [{
      kind: 'add_variable',
      ...operationBase('var-1'),
      variableId: 'ai-var-1',
      name: 'new_flag',
      variableType: 'boolean',
      value: 'false',
      description: '测试',
    }], {
      contextSourceKeys: ['entity:invented'],
      evidenceSourceKeys: ['entity:invented'],
    });

    const result = await dryRunAiProposal(project, raw, {
      expectedContextSourceKeys: [`entity:${project.entities[0].id}`],
    });

    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'context.unknown-source',
      'context.unknown-evidence',
    ]));
  });

  it('脚本产生新的解析错误时阻止提案', async () => {
    const project = sampleProject();
    const flow = project.flows[0];
    const found = findNode(flow, (node) => node.type === 'condition')!;
    const raw = await proposal(project, [{
      kind: 'replace_flow_node_script',
      ...operationBase('script-1'),
      flowId: flow.id,
      path: found.path,
      nodeId: found.node.id,
      field: 'condition',
      value: '&&&&',
    }], { task: 'script-fix' });

    const result = await dryRunAiProposal(project, raw);

    expect(result.status).toBe('blocked');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'audit.new-error' }));
  });

  it('不能通过正文操作绕过脚本专用操作', async () => {
    const project = sampleProject();
    const flow = project.flows[0];
    const found = findNode(flow, (node) => node.type === 'instruction')!;
    const raw = await proposal(project, [{
      kind: 'update_flow_node_text',
      ...operationBase('text-script-1'),
      flowId: flow.id,
      path: found.path,
      nodeId: found.node.id,
      text: 'unknown = true',
    }]);

    const result = await dryRunAiProposal(project, raw);

    expect(result.status).toBe('blocked');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'permission.script-via-text' }));
  });

  it('拒绝只读模板字段和非法变量默认值', async () => {
    const project = sampleProject();
    const entity = project.entities.find((item) => item.fields.length > 0)!;
    const field = entity.fields[0];
    project.entityTemplates ??= {};
    project.entityTemplates[entity.kind] = [{ label: field.label, readonly: true }];
    const raw = await proposal(project, [
      {
        kind: 'update_entity_field',
        ...operationBase('readonly-1'),
        entityId: entity.id,
        fieldId: field.id,
        value: '禁止',
      },
      {
        kind: 'add_variable',
        ...operationBase('var-1'),
        variableId: 'ai-var-1',
        name: 'new_flag',
        variableType: 'boolean',
        value: 'yes',
        description: '',
      },
    ]);

    const result = await dryRunAiProposal(project, raw);

    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'permission.readonly-field',
      'constraint.variable-value',
    ]));
  });

  it('低信心操作产生警告，同长度替换仍计入字符改动上限', async () => {
    const project = sampleProject();
    const document = project.documents[0];
    const block = document.blocks[0];
    const replacement = block.text.replace(/./u, (char) => char === '甲' ? '乙' : '甲');
    const raw = await proposal(project, [{
      kind: 'update_document_block_text',
      ...operationBase('text-1'),
      confidence: 0.3,
      documentId: document.id,
      blockId: block.id,
      text: replacement,
    }]);

    const result = await dryRunAiProposal(project, raw, { maxChangedChars: 1 });

    expect(result.metrics.characterDelta).toBe(0);
    expect(result.metrics.changedChars).toBeGreaterThan(1);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'limit.changed-characters',
      'confidence.low',
    ]));
  });
});
