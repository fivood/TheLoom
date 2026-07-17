import { describe, expect, it } from 'vitest';
import { createIssue, pathReportIssues } from './issues';
import type { SimReport } from './simulate';

describe('统一问题模型', () => {
  it('相同问题生成稳定 id,位置或消息变化后 id 改变', () => {
    const input = {
      code: 'audit.required',
      source: 'audit' as const,
      severity: 'error' as const,
      scope: 'entity' as const,
      kind: '必填缺失',
      message: '角色 · 动机',
      nav: { tab: 'entities' as const, entityId: 'entity-1' },
      objectId: 'entity-1',
    };
    expect(createIssue(input).id).toBe(createIssue(input).id);
    expect(createIssue(input).id).not.toBe(createIssue({ ...input, message: '角色 · 恐惧' }).id);
  });

  it('路径报告转换为可跳转的统一问题', () => {
    const ref = { nodeId: 'node-1', path: ['fragment-1'], title: '失联分支', kind: 'dialogue' };
    const report: SimReport = {
      totalNodes: 1,
      visitedCount: 0,
      coverage: 0,
      pathCount: 1,
      pathsTruncated: true,
      ends: { end: 0, stuck: 1, loop: 1, truncated: 1, merged: 0 },
      unreachable: [ref],
      stuck: [ref],
      loops: [ref],
    };
    const issues = pathReportIssues('flow-1', report);

    expect(issues.map((issue) => issue.code)).toEqual([
      'path.unreachable',
      'path.stuck',
      'path.loop',
      'path.truncated',
    ]);
    expect(issues.every((issue) => issue.source === 'path')).toBe(true);
    expect(issues[0].nav).toEqual({
      tab: 'flow',
      flowId: 'flow-1',
      path: ['fragment-1'],
      nodeId: 'node-1',
    });
    expect(issues[3].severity).toBe('warning');
  });
});
