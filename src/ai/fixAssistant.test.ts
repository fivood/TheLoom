import { describe, expect, it } from 'vitest';
import { createIssue } from '../issues';
import { sampleProject } from '../sample';
import type { Flow, Project } from '../types';
import { normalizeProject } from '../util';
import { buildAiContextBundle, fingerprintValue } from './context';
import { generateFixProposal } from './fixAssistant';
import { MockLlmClient } from './mock';
import { dryRunAiProposal, type AiProposalOperation } from './proposal';
import type { StructuredRequest } from './llm';

function testFlow(edgeCondition?: string): Flow {
  return {
    id: 'f1',
    name: '测试流程',
    nodes: [
      { id: 'n1', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '开场', text: '你好' } },
      { id: 'n2', type: 'hub', position: { x: 160, y: 0 }, data: { title: '选择', text: '' } },
      { id: 'n3', type: 'dialogue', position: { x: 320, y: 0 }, data: { title: '甲', text: 'A' } },
      { id: 'n4', type: 'dialogue', position: { x: 320, y: 80 }, data: { title: '乙', text: 'B' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3', label: '去甲', condition: edgeCondition },
      { id: 'e3', source: 'n2', target: 'n4', label: '去乙' },
    ],
  };
}

function testProject(flow: Flow): Project {
  const base = structuredClone(sampleProject());
  base.flows = [flow];
  base.documents = [];
  base.units = [];
  base.variables = [];
  return normalizeProject(base);
}

function edgeScriptOp(id: string, edgeId: string, value: string): AiProposalOperation {
  return {
    kind: 'replace_flow_edge_script',
    id,
    reason: '测试脚本修复',
    confidence: 0.9,
    flowId: 'f1',
    path: [],
    edgeId,
    field: 'condition',
    value,
  };
}

describe('R10-A3 提案路径验证', () => {
  it('让全部出边失效的脚本提案被路径测试拦截', async () => {
    const project = testProject(testFlow());
    const dryRun = await dryRunAiProposal(project, {
      version: 1,
      id: 'p1',
      task: 'script-fix',
      summary: '加条件',
      baselineProjectFingerprint: await fingerprintValue(project),
      contextSourceKeys: [],
      evidenceSourceKeys: [],
      operations: [edgeScriptOp('op1', 'e2', '1 > 2'), edgeScriptOp('op2', 'e3', '1 > 2')],
      confirmations: [],
    });
    expect(dryRun.status).toBe('blocked');
    expect(dryRun.issues.some((issue) => issue.code === 'audit.new-error' && issue.message.includes('卡死'))).toBe(true);
  });

  it('制造不可达节点的提案同样拦截,无害脚本通过', async () => {
    const project = testProject(testFlow());
    const blockedRun = await dryRunAiProposal(project, {
      version: 1,
      id: 'p2',
      task: 'script-fix',
      summary: '只锁一条边',
      baselineProjectFingerprint: await fingerprintValue(project),
      contextSourceKeys: [],
      evidenceSourceKeys: [],
      operations: [edgeScriptOp('op1', 'e2', '1 > 2')],
      confirmations: [],
    });
    expect(blockedRun.status).toBe('blocked');
    expect(blockedRun.issues.some((issue) => issue.code === 'audit.new-error' && issue.message.includes('不可达'))).toBe(true);

    const passRun = await dryRunAiProposal(project, {
      version: 1,
      id: 'p3',
      task: 'script-fix',
      summary: '永真条件',
      baselineProjectFingerprint: await fingerprintValue(project),
      contextSourceKeys: [],
      evidenceSourceKeys: [],
      operations: [edgeScriptOp('op1', 'e2', '1 < 2')],
      confirmations: [],
    });
    expect(passRun.status).toBe('pass');
  });

  it('新增变量触发引用它的流程重新路径测试', async () => {
    const flow = testFlow('door_open == true');
    flow.edges = flow.edges.filter((edge) => edge.id !== 'e3');
    flow.nodes = flow.nodes.filter((node) => node.id !== 'n4');
    const project = testProject(flow);

    const addVar = (value: string): AiProposalOperation => ({
      kind: 'add_variable',
      id: 'op1',
      reason: '补上缺失变量',
      confidence: 0.9,
      variableId: 'var1',
      name: 'door_open',
      variableType: 'boolean',
      value,
      description: '',
    });

    const blockedRun = await dryRunAiProposal(project, {
      version: 1, id: 'p4', task: 'script-fix', summary: '补变量(false)',
      baselineProjectFingerprint: await fingerprintValue(project),
      contextSourceKeys: [], evidenceSourceKeys: [],
      operations: [addVar('false')], confirmations: [],
    });
    expect(blockedRun.status).toBe('blocked');
    expect(blockedRun.issues.some((issue) => issue.code === 'audit.new-error')).toBe(true);

    const passRun = await dryRunAiProposal(project, {
      version: 1, id: 'p5', task: 'script-fix', summary: '补变量(true)',
      baselineProjectFingerprint: await fingerprintValue(project),
      contextSourceKeys: [], evidenceSourceKeys: [],
      operations: [addVar('true')], confirmations: [],
    });
    expect(passRun.status).toBe('pass');
  });
});

describe('generateFixProposal', () => {
  it('本地构建提案信封,过滤未知依据,产出可通过验证的提案', async () => {
    const project = testProject(testFlow());
    const issue = createIssue({
      code: 'path.stuck',
      source: 'path',
      severity: 'error',
      scope: 'flow',
      kind: '卡死',
      message: '选择:存在所有出边都被过滤的路径',
      nav: { tab: 'flow', flowId: 'f1', path: [], nodeId: 'n2' },
      objectId: 'n2',
    });
    const bundle = await buildAiContextBundle(project, { issue, charBudget: 20_000 });
    expect(bundle.items.length).toBeGreaterThan(0);
    const knownKey = bundle.items[0].sourceRef.key;

    const client = new MockLlmClient([{
      type: 'structured',
      data: {
        summary: '把去甲的条件改为永真',
        operations: [edgeScriptOp('op1', 'e2', '1 < 2')],
        evidenceSourceKeys: [knownKey, 'ctx:bogus'],
        confirmations: ['默认玩家总是可以去甲'],
      },
      usage: { totalTokens: 321 },
    }]);

    const result = await generateFixProposal(client, project, bundle, [issue], '尽量小改');
    expect(result.proposal.task).toBe('script-fix');
    expect(result.proposal.baselineProjectFingerprint).toBe(await fingerprintValue(project));
    expect(result.proposal.contextSourceKeys).toEqual(bundle.items.map((item) => item.sourceRef.key));
    expect(result.proposal.evidenceSourceKeys).toEqual([knownKey]);
    expect(result.ignoredEvidenceKeys).toEqual(['ctx:bogus']);
    expect(result.usage?.totalTokens).toBe(321);

    const request = client.calls[0].request as StructuredRequest;
    expect(request.user).toContain('fix_target');
    expect(request.user).toContain('可用作用域');
    expect(request.user).toContain('尽量小改');
    expect(request.system).toContain('不可信');

    const dryRun = await dryRunAiProposal(project, result.proposal, {
      expectedContextSourceKeys: result.proposal.contextSourceKeys,
    });
    expect(dryRun.status).toBe('pass');
    expect(dryRun.changes).toHaveLength(1);
  });
});
