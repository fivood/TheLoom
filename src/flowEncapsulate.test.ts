import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from './types';
import { encapsulateSelection } from './flowEncapsulate';

let n = 0;
const newId = () => `new${++n}`;
const node = (id: string, type: FlowNode['type'] = 'dialogue', x = 0, y = 0, title = id): FlowNode =>
  ({ id, type, position: { x, y }, data: { title, text: '' } });
const edge = (source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge =>
  ({ id: `e-${source}-${target}`, source, target, ...extra });

describe('R19-5 从选区封装为剧情片段', () => {
  /** a → b → c → d,封装 b、c */
  const linear = () => ({
    nodes: [node('a', 'dialogue', 0, 0), node('b', 'dialogue', 100, 0), node('c', 'dialogue', 200, 0), node('d', 'dialogue', 300, 0)],
    edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')],
  });

  it('内部边搬进子流程,入边改接片段,出边经出口接出去', () => {
    n = 0;
    const { nodes, edges } = linear();
    const r = encapsulateSelection({ nodes, edges, selectedIds: ['b', 'c'], newId, title: '中段' });
    expect(r.ok).toBe(true);

    // 父层只剩 a、d 与片段
    expect(r.nodes.map((x) => x.id).sort()).toEqual(['a', 'd', r.fragmentId].sort());
    const frag = r.nodes.find((x) => x.id === r.fragmentId)!;
    expect(frag.type).toBe('fragment');
    expect(frag.data.title).toBe('中段');

    // 子流程:b、c + 一个出口;内部边 b→c 跟着搬进来
    const sub = frag.data.sub!;
    expect(sub.nodes.filter((x) => x.type !== 'exit').map((x) => x.id).sort()).toEqual(['b', 'c']);
    expect(sub.nodes.filter((x) => x.type === 'exit')).toHaveLength(1);
    expect(sub.edges.some((e) => e.source === 'b' && e.target === 'c')).toBe(true);
    expect(r.exitCount).toBe(1);

    // 父层:a → 片段,片段(命名引脚)→ d
    const toFrag = r.edges.find((e) => e.source === 'a')!;
    expect(toFrag.target).toBe(r.fragmentId);
    const fromFrag = r.edges.find((e) => e.source === r.fragmentId)!;
    expect(fromFrag.target).toBe('d');
    const exitNode = sub.nodes.find((x) => x.type === 'exit')!;
    expect(fromFrag.sourceHandle).toBe(`exit:${exitNode.id}`);
  });

  it('同一内部节点的多条出边共用一个出口,引脚数反映出口语义而不是边数', () => {
    n = 0;
    const nodes = [node('a'), node('b'), node('x'), node('y')];
    const edges = [edge('a', 'b'), edge('b', 'x'), edge('b', 'y')];
    const r = encapsulateSelection({ nodes, edges, selectedIds: ['a', 'b'], newId });
    expect(r.exitCount).toBe(1);
    const sub = r.nodes.find((x) => x.id === r.fragmentId)!.data.sub!;
    const exits = sub.nodes.filter((x) => x.type === 'exit');
    expect(exits).toHaveLength(1);
    // 两条父层出边都挂在同一个引脚上,分别去 x 和 y
    const out = r.edges.filter((e) => e.source === r.fragmentId);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((e) => e.sourceHandle)).size).toBe(1);
    expect(out.map((e) => e.target).sort()).toEqual(['x', 'y']);
  });

  it('不同内部节点各自一个出口', () => {
    n = 0;
    const nodes = [node('a'), node('b'), node('out1'), node('out2')];
    const edges = [edge('a', 'b'), edge('a', 'out1'), edge('b', 'out2')];
    const r = encapsulateSelection({ nodes, edges, selectedIds: ['a', 'b'], newId });
    expect(r.exitCount).toBe(2);
    const sub = r.nodes.find((x) => x.id === r.fragmentId)!.data.sub!;
    expect(sub.nodes.filter((x) => x.type === 'exit')).toHaveLength(2);
  });

  it('保留出边上的标签与逻辑字段', () => {
    n = 0;
    const nodes = [node('a'), node('b')];
    const edges = [edge('a', 'b', { label: '走这边', condition: 'gate', effect: 'n += 1', once: true })];
    const r = encapsulateSelection({ nodes, edges, selectedIds: ['a'], newId });
    const out = r.edges.find((e) => e.source === r.fragmentId)!;
    expect(out).toMatchObject({ label: '走这边', condition: 'gate', effect: 'n += 1', once: true, target: 'b' });
  });

  it('与选区无关的连线原样不动', () => {
    n = 0;
    const nodes = [node('a'), node('b'), node('x'), node('y')];
    const edges = [edge('a', 'b'), edge('x', 'y')];
    const r = encapsulateSelection({ nodes, edges, selectedIds: ['a', 'b'], newId });
    expect(r.edges.some((e) => e.source === 'x' && e.target === 'y' && e.id === 'e-x-y')).toBe(true);
  });

  it('子流程内位置相对化,不会挤在角落或飞出视野', () => {
    n = 0;
    const nodes = [node('a', 'dialogue', 5000, 3000), node('b', 'dialogue', 5200, 3000), node('outside')];
    const edges = [edge('a', 'b')];
    const r = encapsulateSelection({ nodes, edges, selectedIds: ['a', 'b'], newId });
    const sub = r.nodes.find((x) => x.id === r.fragmentId)!.data.sub!;
    const positions = sub.nodes.filter((x) => x.type !== 'exit').map((x) => x.position);
    expect(Math.min(...positions.map((p) => p.x))).toBe(60);
    expect(Math.min(...positions.map((p) => p.y))).toBe(60);
    // 相对间距保持
    expect(Math.max(...positions.map((p) => p.x)) - Math.min(...positions.map((p) => p.x))).toBe(200);
  });

  it('拒绝无效选区:空选、纯注释、以及整个流程', () => {
    n = 0;
    const nodes = [node('a'), node('n1', 'note'), node('z1', 'zone')];
    const edges: FlowEdge[] = [];
    expect(encapsulateSelection({ nodes, edges, selectedIds: [], newId }).reason).toContain('没有选中');
    expect(encapsulateSelection({ nodes, edges, selectedIds: ['n1', 'z1'], newId }).reason).toContain('只有注释');
    expect(encapsulateSelection({ nodes, edges, selectedIds: ['a', 'n1', 'z1'], newId }).reason).toContain('整个流程');
  });

  it('拒绝时原样返回,不produce半成品', () => {
    n = 0;
    const { nodes, edges } = linear();
    const r = encapsulateSelection({ nodes, edges, selectedIds: [], newId });
    expect(r.ok).toBe(false);
    expect(r.nodes).toBe(nodes);
    expect(r.edges).toBe(edges);
  });
});
