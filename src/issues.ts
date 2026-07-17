import type { NavTarget } from './search';
import type { SimReport } from './simulate';

export type IssueSeverity = 'error' | 'warning' | 'info';
export type IssueSource = 'audit' | 'script' | 'path';
export type IssueScope = 'project' | 'flow' | 'document' | 'entity' | 'asset';

export interface ProjectIssue {
  id: string;
  code: string;
  source: IssueSource;
  severity: IssueSeverity;
  scope: IssueScope;
  kind: string;
  message: string;
  nav?: NavTarget;
  objectId?: string;
}

export type ProjectIssueInput = Omit<ProjectIssue, 'id'>;

function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function createIssue(input: ProjectIssueInput): ProjectIssue {
  const location = input.nav ? JSON.stringify(input.nav) : '';
  return { ...input, id: `${input.source}:${input.code}:${hashText(`${location}\n${input.message}`)}` };
}

export function pathReportIssues(flowId: string, report: SimReport): ProjectIssue[] {
  const fromRefs = (
    code: string,
    kind: string,
    severity: IssueSeverity,
    refs: SimReport['unreachable'],
    describe: (title: string) => string,
  ) => refs.map((ref) => createIssue({
    code,
    source: 'path',
    severity,
    scope: 'flow',
    kind,
    message: describe(ref.title),
    nav: { tab: 'flow', flowId, path: ref.path, nodeId: ref.nodeId },
    objectId: ref.nodeId,
  }));

  const issues = [
    ...fromRefs('path.unreachable', '不可达', 'error', report.unreachable, (title) => `${title}:任何路径都无法到达`),
    ...fromRefs('path.stuck', '卡死', 'error', report.stuck, (title) => `${title}:存在所有出边都被过滤的路径`),
    ...fromRefs('path.loop', '循环', 'error', report.loops, (title) => `${title}:存在返回完全相同状态的路径`),
  ];
  if (report.pathsTruncated || report.ends.truncated > 0) {
    issues.push(createIssue({
      code: 'path.truncated',
      source: 'path',
      severity: 'warning',
      scope: 'flow',
      kind: '遍历截断',
      message: `路径测试达到遍历上限,当前报告是问题下界`,
      nav: { tab: 'flow', flowId },
      objectId: flowId,
    }));
  }
  return issues;
}

export const ISSUE_SEVERITY_LABEL: Record<IssueSeverity, string> = {
  error: '错误',
  warning: '警告',
  info: '提示',
};
