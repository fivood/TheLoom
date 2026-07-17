import { describe, expect, it } from 'vitest';
import type { Entity, Flow, FlowEdge, FlowNode, Variable } from './types';
import { simulateFlow } from './simulate';

let seq = 0;
const node = (id: string, type: FlowNode['type'], data: Partial<FlowNode['data']> = {}): FlowNode => ({
  id, type, position: { x: seq++ * 100, y: 0 }, data: { title: id, text: '', ...data },
});
const edge = (source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge => ({
  id: `e-${source}-${target}-${seq++}`, source, target, ...extra,
});
const flow = (nodes: FlowNode[], edges: FlowEdge[]): Flow => ({ id: 'f', name: '测试', nodes, edges });

const boolVar = (name: string, value: string): Variable => ({ id: name, name, type: 'boolean', value, description: '' });
const noEntities: Entity[] = [];

describe('simulateFlow 基础遍历', () => {
  it('线性流程:一条路径,全覆盖', () => {
    const f = flow(
      [node('a', 'dialogue'), node('b', 'dialogue'), node('c', 'dialogue')],
      [edge('a', 'b'), edge('b', 'c')],
    );
    const r = simulateFlow(f, [], noEntities);
    expect(r.pathCount).toBe(1);
    expect(r.ends.end).toBe(1);
    expect(r.coverage).toBe(1);
    expect(r.unreachable).toHaveLength(0);
    expect(r.stuck).toHaveLength(0);
    expect(r.loops).toHaveLength(0);
  });

  it('汇聚点分支:每个选项一条路径', () => {
    const f = flow(
      [node('h', 'hub'), node('x', 'dialogue'), node('y', 'dialogue')],
      [edge('h', 'x', { label: '左' }), edge('h', 'y', { label: '右' })],
    );
    const r = simulateFlow(f, [], noEntities);
    expect(r.pathCount).toBe(2);
    expect(r.coverage).toBe(1);
  });

  it('条件确定走向 → 另一分支不可达', () => {
    const f = flow(
      [node('c', 'condition', { text: 'flag' }), node('t', 'dialogue'), node('fnode', 'dialogue')],
      [edge('c', 't', { sourceHandle: 'true' }), edge('c', 'fnode', { sourceHandle: 'false' })],
    );
    const r = simulateFlow(f, [boolVar('flag', 'false')], noEntities);
    expect(r.unreachable.map((u) => u.nodeId)).toEqual(['t']);
    expect(r.coverage).toBeLessThan(1);
  });

  it('指令改变变量后条件分支可达', () => {
    const f = flow(
      [
        node('set', 'instruction', { text: 'flag = true' }),
        node('c', 'condition', { text: 'flag' }),
        node('t', 'dialogue'),
        node('fnode', 'dialogue'),
      ],
      [edge('set', 'c'), edge('c', 't', { sourceHandle: 'true' }), edge('c', 'fnode', { sourceHandle: 'false' })],
    );
    const r = simulateFlow(f, [boolVar('flag', 'false')], noEntities);
    expect(r.unreachable.map((u) => u.nodeId)).toEqual(['fnode']);
  });
});

describe('simulateFlow 问题发现', () => {
  it('死循环:无状态变化的环被检出', () => {
    const f = flow(
      [node('a', 'dialogue'), node('b', 'dialogue')],
      [edge('a', 'b'), edge('b', 'a')],
    );
    const r = simulateFlow(f, [], noEntities);
    expect(r.loops.length).toBeGreaterThan(0);
    expect(r.ends.loop).toBeGreaterThan(0);
  });

  it('带计数指令的环不是死循环(状态在变),由步数上限截断', () => {
    const f = flow(
      [node('a', 'instruction', { text: 'n = n + 1' }), node('b', 'dialogue')],
      [edge('a', 'b'), edge('b', 'a')],
    );
    const r = simulateFlow(f, [{ id: 'n', name: 'n', type: 'number', value: '0', description: '' }], noEntities, { maxSteps: 30 });
    expect(r.loops).toHaveLength(0);
    expect(r.ends.truncated).toBeGreaterThan(0);
  });

  it('卡死:出边全被条件过滤', () => {
    const f = flow(
      [node('h', 'hub'), node('x', 'dialogue')],
      [edge('h', 'x', { condition: 'flag' })],
    );
    const r = simulateFlow(f, [boolVar('flag', 'false')], noEntities);
    expect(r.stuck.map((s) => s.nodeId)).toEqual(['h']);
    expect(r.ends.stuck).toBe(1);
    expect(r.unreachable.map((u) => u.nodeId)).toEqual(['x']);
  });

  it('fallback 边拯救被过滤光的分支(不算卡死)', () => {
    const f = flow(
      [node('h', 'hub'), node('x', 'dialogue'), node('safe', 'dialogue')],
      [edge('h', 'x', { condition: 'flag' }), edge('h', 'safe', { fallback: true })],
    );
    const r = simulateFlow(f, [boolVar('flag', 'false')], noEntities);
    expect(r.stuck).toHaveLength(0);
    expect(r.unreachable.map((u) => u.nodeId)).toEqual(['x']);
  });
});

describe('simulateFlow 检定与子流程', () => {
  it('检定枚举成功与失败两支', () => {
    const f = flow(
      [node('k', 'check', { checkExpr: '2', checkDc: 8 }), node('win', 'dialogue'), node('lose', 'dialogue')],
      [edge('k', 'win', { sourceHandle: 'success' }), edge('k', 'lose', { sourceHandle: 'fail' })],
    );
    const r = simulateFlow(f, [], noEntities);
    expect(r.coverage).toBe(1);
    expect(r.pathCount).toBe(2);
  });

  it('子流程钻入 + 出口回父层', () => {
    const inner = {
      nodes: [node('s1', 'dialogue'), node('exit1', 'exit', { title: '离开' })],
      edges: [edge('s1', 'exit1')],
    };
    const f = flow(
      [node('frag', 'fragment', { sub: inner }), node('after', 'dialogue')],
      [edge('frag', 'after')],
    );
    const r = simulateFlow(f, [], noEntities);
    expect(r.coverage).toBe(1);
    expect(r.unreachable).toHaveLength(0);
    expect(r.ends.end).toBe(1);
  });

  it('一次性选项 + 环:第二次经过被过滤,不误报死循环', () => {
    // h --once--> a --> h --> end(第二次到 h 时 once 边不可用,走 end)
    const f = flow(
      [node('h', 'hub'), node('a', 'dialogue'), node('end', 'dialogue')],
      [edge('h', 'a', { once: true, label: '拿钥匙' }), edge('a', 'h'), edge('h', 'end', { label: '离开' })],
    );
    const r = simulateFlow(f, [], noEntities);
    expect(r.loops).toHaveLength(0);
    expect(r.coverage).toBe(1);
  });
});

describe('simulateFlow 可复现与上限', () => {
  it('同一输入两次运行报告一致', () => {
    const f = flow(
      [node('h', 'hub'), node('x', 'dialogue'), node('y', 'dialogue'), node('k', 'check', { checkDc: 7 })],
      [edge('h', 'x'), edge('h', 'y'), edge('x', 'k'), edge('k', 'y', { sourceHandle: 'success' })],
    );
    const a = simulateFlow(f, [], noEntities);
    const b = simulateFlow(f, [], noEntities);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('无状态差异的分支被合流剪枝,不会爆炸', () => {
    // 五连 hub,每个 2 分支:选择序列 32 种,但状态相同 → 合流,总路径远小于 32
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    for (let i = 0; i < 5; i++) {
      nodes.push(node(`h${i}`, 'hub'));
      nodes.push(node(`d${i}`, 'dialogue'));
    }
    for (let i = 0; i < 4; i++) {
      edges.push(edge(`h${i}`, `h${i + 1}`, { label: 'A' }));
      edges.push(edge(`h${i}`, `d${i}`, { label: 'B' }));
      edges.push(edge(`d${i}`, `h${i + 1}`));
    }
    edges.push(edge('h4', 'd4', { label: '终' }));
    const r = simulateFlow(flow(nodes, edges), [], noEntities);
    expect(r.pathsTruncated).toBe(false);
    expect(r.pathCount).toBeLessThan(32);
    expect(r.coverage).toBe(1);
  });

  it('状态发散的分支触发 maxPaths 截断', () => {
    // 每层分支带不同 effect,状态两两不同 → 真实组合爆炸,由上限截断
    const nodes: FlowNode[] = [node('end', 'dialogue')];
    const edges: FlowEdge[] = [];
    for (let i = 0; i < 6; i++) nodes.push(node(`h${i}`, 'hub'));
    for (let i = 0; i < 5; i++) {
      edges.push(edge(`h${i}`, `h${i + 1}`, { label: 'A', effect: `n = n + 1` }));
      edges.push(edge(`h${i}`, `h${i + 1}`, { label: 'B', effect: `n = n + 10` }));
    }
    edges.push(edge('h5', 'end'));
    const r = simulateFlow(
      flow(nodes, edges),
      [{ id: 'n', name: 'n', type: 'number', value: '0', description: '' }],
      noEntities,
      { maxPaths: 8 },
    );
    expect(r.pathsTruncated).toBe(true);
    expect(r.pathCount).toBeLessThanOrEqual(8);
  });
});
