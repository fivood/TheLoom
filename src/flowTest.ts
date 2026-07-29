import type { AssertOp, Flow, FlowTest, FlowTestAssertion, Project, SubFlow, Variable } from './types';
import { ANNOTATION_TYPES } from './types';
import { FlowRuntime, type RuntimeEvent, type VarValue } from './runtime/player';
import { contentHash } from './engine/package';

/**
 * R19-4 场景化回归测试运行器(纯逻辑)。
 *
 * 把一次演出固化成「入口 + 种子 + 选择序列 + 事件响应」,流程改动后批量重跑,
 * 用断言守住结局、变量终值、节点访问与事件触发。
 *
 * 它补上了 R19-2 / R19-3 刻意留下的两个口子:
 *   - `simulate.ts` 对跨流程调用是局部建模,检测不到「被调流程永不返回」
 *   - 路径遍历不知道外部事件回值的运行期真值
 * 这里跑的是真正的 `FlowRuntime`,跨流程与事件都按真实语义走。
 *
 * 完全确定性:同一项目 + 同一测试,结果永远一致(种子固定,事件响应预置)。
 */

/** 单条断言的判定结果 */
export interface AssertionResult {
  assertion: FlowTestAssertion;
  ok: boolean;
  /** 人话说明:失败时说清楚实际是什么 */
  detail: string;
}

export interface FlowTestCoverage {
  totalNodes: number;
  visitedNodes: number;
  totalEdges: number;
  takenEdges: number;
  /** 0-1;总数为 0 时记 1(没有可覆盖的东西不算未覆盖) */
  nodeRate: number;
  edgeRate: number;
}

export interface FlowTestResult {
  testId: string;
  name: string;
  ok: boolean;
  results: AssertionResult[];
  coverage: FlowTestCoverage;
  visitedNodes: string[];
  takenEdges: string[];
  firedEvents: { event: string; args: Record<string, VarValue> }[];
  finalVars: Record<string, VarValue>;
  ended: boolean;
  /** 最后进入的节点 id */
  lastNodeId?: string;
  steps: number;
  /**
   * 回放本身出的问题(流程不存在、选项下标越界、步数超限)。
   * 与断言失败区分开 —— 前者说明测试脚本该修,后者说明流程行为变了。
   */
  error?: string;
}

/** 单次回放的步数上限:防止环状流程把回归跑挂 */
const MAX_STEPS = 500;

/** 递归统计流程内的叙事节点与边(含各层子流程) */
function countFlowGraph(flow: Flow): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  const walk = (sub: SubFlow) => {
    for (const n of sub.nodes) {
      if (!ANNOTATION_TYPES.has(n.type)) nodes.add(n.id);
      if (n.data.sub) walk(n.data.sub);
    }
    for (const e of sub.edges) edges.add(e.id);
  };
  walk(flow);
  return { nodes, edges };
}

/** 测试引用的流程:技术名优先,退回 id */
export function findTestFlow(project: Project, flowRef: string): Flow | undefined {
  return project.flows.find((f) => f.technicalName === flowRef) ?? project.flows.find((f) => f.id === flowRef);
}

/**
 * 目标流程的内容哈希,用于「流程改过 → 测试结果可能过时」的标记。
 * 只含流程本身:改别的流程不该让这条测试变成「受影响」。
 */
export function flowFingerprint(flow: Flow): string {
  return contentHash([flow.nodes, flow.edges, flow.entries ?? []]);
}

function compare(actual: VarValue | undefined, op: AssertOp, expected: string): boolean {
  if (actual === undefined) return op === '!=';
  // 数值比较:两边都能当数字时按数字比,否则退回字符串
  const an = typeof actual === 'number' ? actual : Number(actual);
  const en = Number(expected);
  const numeric = Number.isFinite(an) && Number.isFinite(en) && expected.trim() !== '';
  switch (op) {
    case '==': return numeric ? an === en : String(actual) === expected;
    case '!=': return numeric ? an !== en : String(actual) !== expected;
    case '>': return numeric && an > en;
    case '>=': return numeric && an >= en;
    case '<': return numeric && an < en;
    case '<=': return numeric && an <= en;
  }
}

/**
 * 节点引用可以写技术名或 id;返回该节点的 id。
 * 在**全部流程**里找 —— 跨流程调用时访问轨迹会横跨多个流程,
 * 断言「被调流程里的某个节点走到了」是合理诉求。
 */
function resolveNodeRef(project: Project, ref: string): string | undefined {
  let found: string | undefined;
  const walk = (sub: SubFlow) => {
    for (const n of sub.nodes) {
      if (n.id === ref || n.data.technicalName === ref) found ??= n.id;
      if (n.data.sub) walk(n.data.sub);
    }
  };
  for (const f of project.flows) walk(f);
  return found;
}

/** 按事件声明的返回类型给一个确定的零值,保证没配响应时也能确定性地跑完 */
function defaultEventValue(project: Project, eventName: string): VarValue {
  const decl = (project.externalEvents ?? []).find((e) => e.name === eventName);
  if (decl?.returnType === 'boolean') return false;
  if (decl?.returnType === 'number') return 0;
  return '';
}

function coerceResponse(project: Project, eventName: string, raw: string | undefined): VarValue {
  if (raw === undefined) return defaultEventValue(project, eventName);
  const decl = (project.externalEvents ?? []).find((e) => e.name === eventName);
  if (decl?.returnType === 'boolean') return raw === 'true';
  if (decl?.returnType === 'number') return Number(raw) || 0;
  return raw;
}

/**
 * 跑一条回归测试。
 * 不修改传入的 project —— 初始变量覆盖走的是变量表副本。
 */
export function runFlowTest(project: Project, test: FlowTest): FlowTestResult {
  const base: FlowTestResult = {
    testId: test.id,
    name: test.name,
    ok: false,
    results: [],
    coverage: { totalNodes: 0, visitedNodes: 0, totalEdges: 0, takenEdges: 0, nodeRate: 1, edgeRate: 1 },
    visitedNodes: [],
    takenEdges: [],
    firedEvents: [],
    finalVars: {},
    ended: false,
    steps: 0,
  };

  const flow = findTestFlow(project, test.flowRef);
  if (!flow) return { ...base, error: `流程不存在:${test.flowRef}` };

  // 初始变量覆盖:只替换 value,类型仍由项目声明决定
  const overrides = new Map((test.initialVars ?? []).map((v) => [v.name, v.value]));
  const variables: Variable[] = project.variables.map((v) =>
    (overrides.has(v.name) ? { ...v, value: overrides.get(v.name)! } : v));

  const visited: string[] = [];
  const visitedSet = new Set<string>();
  const takenEdges = new Set<string>();
  const fired: { event: string; args: Record<string, VarValue> }[] = [];
  let lastNodeId: string | undefined;

  const onEvent = (ev: RuntimeEvent) => {
    if (ev.event !== 'enter') return;
    lastNodeId = ev.nodeId;
    if (!visitedSet.has(ev.nodeId)) { visitedSet.add(ev.nodeId); visited.push(ev.nodeId); }
    if (ev.edgeId) takenEdges.add(ev.edgeId);
  };

  // 事件响应按事件名排队,同名多条按顺序消费
  const queues = new Map<string, string[]>();
  for (const r of test.eventResponses ?? []) {
    const list = queues.get(r.event) ?? [];
    list.push(r.value ?? '');
    queues.set(r.event, list);
  }
  const takeResponse = (eventName: string): VarValue => {
    const list = queues.get(eventName);
    if (list && list.length > 0) return coerceResponse(project, eventName, list.shift());
    return defaultEventValue(project, eventName);
  };

  const run = new FlowRuntime(
    {
      flows: project.flows,
      variables,
      entities: project.entities,
      externalEvents: project.externalEvents,
    },
    test.flowRef,
    {
      seed: test.seed,
      onEvent,
      // continue 模式的事件不会挂起,只有这个回调能捕获到,所以统一在这里记
      onExternalEvent: (call) => fired.push({ event: call.name, args: call.args }),
    },
  );

  let error: string | undefined;
  let steps = 0;
  try {
    run.start(test.entryKey);
    let ci = 0;
    for (; steps < MAX_STEPS; steps++) {
      // R19-3:挂起在外部事件上 → 用预置响应放行(触发记录已由 onExternalEvent 收下)
      if (run.pendingExternal) {
        run.resolveExternal(takeResponse(run.pendingExternal.call.name));
        continue;
      }
      if (run.ended) break;
      if (run.choices.length === 0) break;
      if (ci >= test.choices.length) {
        error = `选择序列在第 ${ci} 步用完,但演出还停在 ${run.choices.length} 个选项上`;
        break;
      }
      const pick = test.choices[ci++];
      if (pick < 0 || pick >= run.choices.length) {
        error = `第 ${ci} 步选项下标 ${pick} 越界(当前只有 ${run.choices.length} 个选项)`;
        break;
      }
      run.choose(pick);
    }
    if (steps >= MAX_STEPS) error = `回放超过 ${MAX_STEPS} 步,可能是环状流程`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const graph = countFlowGraph(flow);
  const visitedInFlow = visited.filter((id) => graph.nodes.has(id));
  const takenInFlow = [...takenEdges].filter((id) => graph.edges.has(id));
  const coverage: FlowTestCoverage = {
    totalNodes: graph.nodes.size,
    visitedNodes: visitedInFlow.length,
    totalEdges: graph.edges.size,
    takenEdges: takenInFlow.length,
    nodeRate: graph.nodes.size === 0 ? 1 : visitedInFlow.length / graph.nodes.size,
    edgeRate: graph.edges.size === 0 ? 1 : takenInFlow.length / graph.edges.size,
  };

  const firedNames = new Set(fired.map((f) => f.event));
  const results: AssertionResult[] = test.assertions.map((a) => {
    switch (a.kind) {
      case 'ended': {
        if (!run.ended) return { assertion: a, ok: false, detail: '演出没有走到结束' };
        if (!a.node) return { assertion: a, ok: true, detail: '演出已结束' };
        const want = resolveNodeRef(project, a.node);
        const ok = !!want && lastNodeId === want;
        return {
          assertion: a, ok,
          detail: ok ? `结束于「${a.node}」` : `期望结束于「${a.node}」,实际停在 ${lastNodeId ?? '(无)'}`,
        };
      }
      case 'variable': {
        const actual = run.vars[a.name];
        const ok = compare(actual, a.op, a.value);
        return {
          assertion: a, ok,
          detail: ok ? `${a.name} = ${String(actual)}` : `期望 ${a.name} ${a.op} ${a.value},实际 ${actual === undefined ? '(变量不存在)' : String(actual)}`,
        };
      }
      case 'nodeVisited': {
        const want = resolveNodeRef(project, a.node);
        const hit = !!want && visitedSet.has(want);
        const ok = hit === a.expect;
        return {
          assertion: a, ok,
          detail: !want ? `节点「${a.node}」在项目里不存在`
            : ok ? `「${a.node}」${hit ? '被访问' : '未被访问'},符合预期`
            : `期望「${a.node}」${a.expect ? '被访问' : '不被访问'},实际${hit ? '被访问' : '未被访问'}`,
        };
      }
      case 'eventFired': {
        const hit = firedNames.has(a.event);
        const ok = hit === a.expect;
        return {
          assertion: a, ok,
          detail: ok ? `事件「${a.event}」${hit ? '已触发' : '未触发'},符合预期`
            : `期望事件「${a.event}」${a.expect ? '触发' : '不触发'},实际${hit ? '触发了' : '没触发'}`,
        };
      }
    }
  });

  return {
    testId: test.id,
    name: test.name,
    ok: !error && results.every((r) => r.ok),
    results,
    coverage,
    visitedNodes: visited,
    takenEdges: [...takenEdges],
    firedEvents: fired,
    finalVars: { ...run.vars },
    ended: run.ended,
    lastNodeId,
    steps,
    error,
  };
}

/** 批量运行;顺序稳定,便于结果对比 */
export function runAllFlowTests(project: Project): FlowTestResult[] {
  return (project.flowTests ?? []).map((t) => runFlowTest(project, t));
}

/** 目标流程内容与上次记录不一致 = 结果可能过时 */
export function isTestStale(project: Project, test: FlowTest): boolean {
  if (!test.flowHash) return false;
  const flow = findTestFlow(project, test.flowRef);
  if (!flow) return true;
  return flowFingerprint(flow) !== test.flowHash;
}
