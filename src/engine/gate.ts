/**
 * 导出前统一闸门(R20-1)
 *
 * 把脚本检查、高级体检、路径测试和场景化回归测试收敛成一道关:
 * 有阻断项就不让导出,避免把跑不通的包交给引擎。
 *
 * 范围原则:**只看真正进包的东西**。没被选中的流程、没被引用的实体
 * 有问题,不该拦住本次交付 —— 判定直接以构建出的引擎包为准,
 * 保证「闸门查的」与「导出的」永远是同一批对象。
 */
import type { EngineExportConfig, Project } from '../types';
import { DEFAULT_ENGINE_EXPORT_GATE } from '../types';
import type { ProjectIssue } from '../issues';
import { auditProject } from '../audit';
import { findTestFlow, runFlowTest, type FlowTestResult } from '../flowTest';
import { buildEnginePackage, rulesFromConfig, type EnginePackage } from './package';

export interface ExportGateReport {
  /** 没有任何阻断项(警告不影响) */
  ok: boolean;
  blocking: ProjectIssue[];
  warnings: ProjectIssue[];
  failedTests: FlowTestResult[];
  /** 跑了多少个范围内的测试 */
  testsRun: number;
  /** 被关掉的检查项(界面提示「这些没查」,避免误以为全绿) */
  skipped: string[];
  durationMs: number;
}

/** 包内实际含有的对象 id;闸门据此判断某个问题算不算数 */
function packageScope(pkg: EnginePackage): Set<string> {
  const ids = new Set<string>();
  for (const f of pkg.flows) ids.add(f.id);
  for (const id of Object.keys(pkg.index.nodes)) ids.add(id);
  for (const e of pkg.entities) ids.add(e.id);
  for (const a of pkg.assets) ids.add(a.id);
  return ids;
}

/**
 * 问题是否落在导出范围内。
 * - 指向具体对象(objectId / nav 定位)→ 该对象必须在包里
 * - 文档相关的问题一律排除:文档正文与其条件 / 指令块不进引擎包
 * - 没有具体对象的项目级问题(如重复技术名)→ 保留,它们会影响引擎寻址
 */
function inScope(issue: ProjectIssue, scope: Set<string>): boolean {
  if (issue.nav?.tab === 'documents' || issue.scope === 'document') return false;
  const target = issue.nav?.nodeId ?? issue.nav?.flowId ?? issue.nav?.entityId
    ?? issue.nav?.assetId ?? issue.objectId;
  if (!target) return true;
  return scope.has(target);
}

export function runExportGate(project: Project, config: EngineExportConfig): ExportGateReport {
  const started = Date.now();
  const gate = { ...DEFAULT_ENGINE_EXPORT_GATE, ...(config.gate ?? {}) };
  const pkg = buildEnginePackage(project, rulesFromConfig(config));
  const scope = packageScope(pkg);

  const blocking: ProjectIssue[] = [];
  const warnings: ProjectIssue[] = [];
  const skipped: string[] = [];
  if (!gate.script) skipped.push('脚本检查');
  if (!gate.audit) skipped.push('高级体检');
  if (!gate.paths) skipped.push('路径测试');
  if (!gate.tests) skipped.push('回归测试');

  const wantIssues = gate.script || gate.audit || gate.paths;
  if (wantIssues) {
    // 路径遍历是 auditProject 的主要开销;闸门不查路径时直接省掉
    for (const issue of auditProject(project, { includePaths: gate.paths })) {
      const enabled = issue.source === 'script' ? gate.script
        : issue.source === 'path' ? gate.paths
        : gate.audit;
      if (!enabled) continue;
      if (!inScope(issue, scope)) continue;
      if (issue.severity === 'error' || (gate.blockOnWarnings && issue.severity === 'warning')) {
        blocking.push(issue);
      } else if (issue.severity === 'warning') {
        warnings.push(issue);
      }
    }
  }

  const failedTests: FlowTestResult[] = [];
  let testsRun = 0;
  if (gate.tests) {
    for (const test of project.flowTests ?? []) {
      const flow = findTestFlow(project, test.flowRef);
      // 目标流程不在包里 → 这条测试与本次交付无关
      if (!flow || !scope.has(flow.id)) continue;
      testsRun++;
      const result = runFlowTest(project, test);
      if (!result.ok) failedTests.push(result);
    }
  }

  return {
    ok: blocking.length === 0 && failedTests.length === 0,
    blocking,
    warnings,
    failedTests,
    testsRun,
    skipped,
    durationMs: Date.now() - started,
  };
}
