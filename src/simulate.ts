import type { Entity, FlowEdge, FlowNode, SubFlow, Variable } from './types';
import { ANNOTATION_TYPES } from './types';
import { resolveSub } from './util';
import {
  applyInstructions, buildEntityProps, coerceVar, evalCondition,
  type EvalCtx, type VarValue,
} from './script';

/**
 * R7 批量路径遍历:从流程起点出发,对每个分支点(选项 / 条件 / 检定)
 * 分叉状态并穷举,产出路径覆盖率与结构问题报告。
 *
 * - 行进语义与 Player 一致:exit 回溯父层、fragment 默认引脚、
 *   fallback 遮蔽、一次性选项、条件边过滤、红色检定结果沿用
 * - 检定不掷骰而是枚举成功 / 失败两支;条件无法求值时双向分叉
 * - 完全确定性:同一流程与变量初值,报告永远一致(可复现)
 */

export interface SimOptions {
  /** 展开路径数上限(防组合爆炸) */
  maxPaths?: number;
  /** 单路径步数上限 */
  maxSteps?: number;
}

export interface SimNodeRef {
  nodeId: string;
  path: string[];
  title: string;
  kind: string;
}

export type SimEnd = 'end' | 'stuck' | 'loop' | 'truncated' | 'merged';

export interface SimPath {
  trace: string[];
  end: SimEnd;
  lastNodeId: string;
}

export interface SimReport {
  totalNodes: number;
  visitedCount: number;
  coverage: number;
  pathCount: number;
  pathsTruncated: boolean;
  ends: Record<SimEnd, number>;
  unreachable: SimNodeRef[];
  stuck: SimNodeRef[];
  loops: SimNodeRef[];
}

interface FlowLike { nodes: FlowNode[]; edges: FlowEdge[] }

interface SimState {
  path: string[];
  nodeId: string;
  vars: Record<string, VarValue>;
  seen: Set<string>;
  taken: Set<string>;
  checks: Map<string, boolean>;
  entityProps: Record<string, Record<string, VarValue>>;
  steps: number;
  trail: Set<string>;
  trace: string[];
}

function startNodes(sub: FlowLike): FlowNode[] {
  const hasIncoming = new Set(sub.edges.map((e) => e.target));
  const story = sub.nodes.filter((n) => !ANNOTATION_TYPES.has(n.type));
  const starts = story.filter((n) => !hasIncoming.has(n.id));
  return starts.length > 0 ? starts : story;
}

function cloneState(s: SimState): SimState {
  return {
    path: [...s.path],
    nodeId: s.nodeId,
    vars: { ...s.vars },
    seen: new Set(s.seen),
    taken: new Set(s.taken),
    checks: new Map(s.checks),
    entityProps: structuredClone(s.entityProps),
    steps: s.steps,
    trail: new Set(s.trail),
    trace: [...s.trace],
  };
}

/** 状态指纹:节点 + 层级 + 变量 + 一次性/检定记录(死循环与合流判定) */
function stateKey(s: SimState): string {
  return JSON.stringify([
    s.nodeId, s.path, s.vars,
    [...s.taken].sort(),
    [...s.checks.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  ]);
}

export function simulateFlow(
  flow: FlowLike & { id?: string },
  variables: Variable[],
  entities: Entity[],
  options: SimOptions = {},
): SimReport {
  const maxPaths = options.maxPaths ?? 400;
  const maxSteps = options.maxSteps ?? 400;

  // 全部叙事节点(含所有层级子流程),记录容器路径便于跳转
  const allNodes = new Map<string, SimNodeRef>();
  const techToId = new Map<string, string>();
  const collect = (sub: FlowLike, p: string[]) => {
    for (const n of sub.nodes) {
      if (n.data.technicalName) techToId.set(n.data.technicalName, n.id);
      if (!ANNOTATION_TYPES.has(n.type)) {
        allNodes.set(n.id, { nodeId: n.id, path: p, title: n.data.title || n.data.text?.slice(0, 20) || n.type, kind: n.type });
      }
      if (n.data.sub) collect(n.data.sub, [...p, n.id]);
    }
  };
  collect(flow, []);

  const container = (p: string[]): FlowLike => resolveSub(flow as SubFlow & FlowLike, p) ?? { nodes: [], edges: [] };

  const initVars: Record<string, VarValue> = {};
  for (const v of variables) initVars[v.name] = coerceVar(v.type, v.value);

  const makeCtx = (s: SimState): EvalCtx => ({
    seen: (tn) => s.seen.has(techToId.get(tn) ?? '__none__'),
    entityProps: s.entityProps,
  });

  const visited = new Set<string>();       // 覆盖到的节点
  const expanded = new Set<string>();      // 展开过的状态指纹(合流剪枝)
  const paths: SimPath[] = [];
  const stuck = new Map<string, SimNodeRef>();
  const loops = new Map<string, SimNodeRef>();
  let pathsTruncated = false;

  /**
   * 复刻 Player.outgoingChoices:出边 → 可选项;无出边逐层回溯,
   * exit 走父层片段命名引脚,condition/check 按状态过滤。
   * 返回可用边与所在层级;stuckHere 表示第一层有出边但全被过滤。
   */
  const nextEdges = (s: SimState, node: FlowNode): { edges: { edge: FlowEdge; path: string[] }[]; stuckHere: boolean } => {
    let curP = [...s.path];
    let cur: FlowNode | undefined = node;
    let exitId: string | null = null;
    let firstLayer = true;
    let stuckHere = false;
    const ctx = makeCtx(s);
    for (let guard = 0; guard < 64; guard++) {
      if (cur?.type === 'exit' && curP.length > 0) {
        exitId = cur.id;
        const fragId = curP[curP.length - 1];
        curP = curP.slice(0, -1);
        cur = container(curP).nodes.find((n) => n.id === fragId);
      }
      const c = container(curP);
      let edges = cur ? c.edges.filter((e) => e.source === cur!.id) : [];
      if (exitId) {
        const named = edges.filter((e) => e.sourceHandle === `exit:${exitId}`);
        edges = named.length > 0 ? named : edges.filter((e) => !e.sourceHandle);
        exitId = null;
      } else if (cur?.type === 'fragment') {
        edges = edges.filter((e) => !e.sourceHandle);
      }
      if (cur?.type === 'condition') {
        const result = evalCondition(cur.data.text, s.vars, ctx);
        if (result !== null) {
          const want = result ? 'true' : 'false';
          const picked = edges.filter((e) => e.sourceHandle === want);
          edges = picked.length > 0 ? picked : [];
        }
        // null:无法求值 → 保留全部引脚(等价于双向分叉)
      }
      if (cur?.type === 'check') {
        const passed = s.checks.get(cur.id) ?? false;
        const want = passed ? 'success' : 'fail';
        const picked = edges.filter((e) => e.sourceHandle === want);
        edges = picked.length > 0 ? picked : [];
      }
      const rawCount = edges.length;
      const usable = edges.filter((e) =>
        !(e.once && s.taken.has(e.id)) &&
        (!e.condition || evalCondition(e.condition, s.vars, ctx) !== false),
      );
      const nonFallback = usable.filter((e) => !e.fallback);
      const finalUsable = nonFallback.length > 0 ? nonFallback : usable;
      if (firstLayer && rawCount > 0 && finalUsable.length === 0) stuckHere = true;
      firstLayer = false;
      if (finalUsable.length > 0) {
        return { edges: finalUsable.map((edge) => ({ edge, path: curP })), stuckHere: false };
      }
      if (curP.length === 0) return { edges: [], stuckHere };
      const fragId = curP[curP.length - 1];
      curP = curP.slice(0, -1);
      cur = container(curP).nodes.find((n) => n.id === fragId);
    }
    return { edges: [], stuckHere };
  };

  const stack: SimState[] = [];
  const rootStarts = startNodes(flow);
  for (const n of rootStarts) {
    stack.push({
      path: [], nodeId: n.id, vars: { ...initVars },
      seen: new Set(), taken: new Set(), checks: new Map(),
      entityProps: buildEntityProps(entities), steps: 0,
      trail: new Set(), trace: [],
    });
  }

  const endPath = (s: SimState, end: SimEnd) => {
    paths.push({ trace: s.trace, end, lastNodeId: s.nodeId });
  };

  while (stack.length > 0) {
    if (paths.length >= maxPaths) { pathsTruncated = true; break; }
    const s = stack.pop()!;

    // 进入节点
    const c = container(s.path);
    const node = c.nodes.find((n) => n.id === s.nodeId);
    if (!node) { endPath(s, 'end'); continue; }

    s.steps++;
    s.trace.push(s.nodeId);
    visited.add(s.nodeId);
    s.seen.add(s.nodeId);
    const ctx = makeCtx(s);

    if (s.steps > maxSteps) { endPath(s, 'truncated'); continue; }

    // 死循环:同一路径内状态指纹重现
    const key = stateKey(s);
    if (s.trail.has(key)) {
      const ref = allNodes.get(s.nodeId);
      if (ref) loops.set(s.nodeId, ref);
      endPath(s, 'loop');
      continue;
    }
    s.trail.add(key);

    // 合流剪枝:其他路径已从同一状态展开过
    if (expanded.has(key)) { endPath(s, 'merged'); continue; }
    expanded.add(key);

    // 节点副作用
    if (node.type === 'instruction') {
      applyInstructions(node.data.text, s.vars, ctx);
    }
    if (node.type === 'check' && !s.checks.has(node.id)) {
      // 枚举成功 / 失败两支(红色检定结果记录后沿用)
      const fail = cloneState(s);
      fail.checks.set(node.id, false);
      fail.nodeId = node.id;
      // fail 分支从"已进入该节点"的后半继续:直接计算出边
      const failNext = nextEdges(fail, node);
      forkEdges(fail, node, failNext);
      s.checks.set(node.id, true);
    }
    if (node.type === 'fragment' && node.data.sub && node.data.sub.nodes.length > 0) {
      // 钻入子流程:每个起点一支
      const subStarts = startNodes(node.data.sub);
      for (const start of subStarts) {
        const child = cloneState(s);
        child.path = [...s.path, node.id];
        child.nodeId = start.id;
        stack.push(child);
      }
      continue;
    }

    const next = nextEdges(s, node);
    forkEdges(s, node, next);
  }

  function forkEdges(s: SimState, node: FlowNode, next: { edges: { edge: FlowEdge; path: string[] }[]; stuckHere: boolean }) {
    if (next.edges.length === 0) {
      if (next.stuckHere) {
        const ref = allNodes.get(node.id);
        if (ref) stuck.set(node.id, ref);
        endPath(s, 'stuck');
      } else {
        endPath(s, 'end');
      }
      return;
    }
    for (const { edge, path } of next.edges) {
      const child = cloneState(s);
      child.path = [...path];
      child.nodeId = edge.target;
      if (edge.once) child.taken.add(edge.id);
      if (edge.effect) applyInstructions(edge.effect, child.vars, makeCtx(child));
      stack.push(child);
    }
  }

  const unreachable = [...allNodes.values()].filter((r) => !visited.has(r.nodeId));
  const ends: Record<SimEnd, number> = { end: 0, stuck: 0, loop: 0, truncated: 0, merged: 0 };
  for (const p of paths) ends[p.end]++;

  return {
    totalNodes: allNodes.size,
    visitedCount: visited.size,
    coverage: allNodes.size === 0 ? 1 : visited.size / allNodes.size,
    pathCount: paths.length,
    pathsTruncated,
    ends,
    unreachable,
    stuck: [...stuck.values()],
    loops: [...loops.values()],
  };
}
