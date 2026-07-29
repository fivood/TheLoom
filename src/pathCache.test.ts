import { beforeEach, describe, expect, it } from 'vitest';
import type { Entity, Flow, FlowEdge, FlowNode, Variable } from './types';
import { cachedSimulateFlow, clearPathCache, pathCacheStats } from './pathCache';
import { simulateFlow } from './simulate';

let seq = 0;
const node = (id: string, type: FlowNode['type'], data: Partial<FlowNode['data']> = {}): FlowNode => ({
  id, type, position: { x: seq++ * 100, y: 0 }, data: { title: id, text: '', ...data },
});
const edge = (source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge => ({
  id: `e-${source}-${target}-${seq++}`, source, target, ...extra,
});
const flow = (nodes: FlowNode[], edges: FlowEdge[]): Flow => ({ id: 'f', name: '测试', nodes, edges });

const ent = (id: string, technicalName: string, fields: Entity['fields']): Entity => ({
  id, kind: 'character', name: id, color: '#000', emoji: '', summary: '', notes: '',
  technicalName, fields, createdAt: 0,
});

describe('R19-P 路径报告缓存', () => {
  beforeEach(() => clearPathCache());

  it('相同输入命中缓存,结果与直接调用一致', () => {
    const f = flow(
      [node('a', 'dialogue'), node('b', 'dialogue')],
      [edge('a', 'b')],
    );
    const direct = simulateFlow(f, [], []);
    const first = cachedSimulateFlow(f, [], []);
    const second = cachedSimulateFlow(f, [], []);
    expect(first).toEqual(direct);
    expect(second).toBe(first);                    // 命中返回同一引用
    expect(pathCacheStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('流程内容变化后不再命中', () => {
    const a = flow([node('x', 'dialogue')], []);
    const b = flow([node('x', 'dialogue', { text: '改了正文' })], []);
    cachedSimulateFlow(a, [], []);
    cachedSimulateFlow(b, [], []);
    expect(pathCacheStats()).toMatchObject({ hits: 0, misses: 2 });
  });

  it('变量初值变化会让条件走向不同,必须重算', () => {
    const f = flow(
      [node('c', 'condition', { text: 'gate' }), node('t', 'dialogue'), node('e', 'dialogue')],
      [edge('c', 't', { sourceHandle: 'true' }), edge('c', 'e', { sourceHandle: 'false' })],
    );
    const on: Variable[] = [{ id: 'gate', name: 'gate', type: 'boolean', value: 'true', description: '' }];
    const off: Variable[] = [{ id: 'gate', name: 'gate', type: 'boolean', value: 'false', description: '' }];
    const r1 = cachedSimulateFlow(f, on, []);
    const r2 = cachedSimulateFlow(f, off, []);
    expect(pathCacheStats()).toMatchObject({ hits: 0, misses: 2 });
    // 走向确实不同:各自有一个分支不可达
    expect(r1.unreachable.map((x) => x.nodeId)).toEqual(['e']);
    expect(r2.unreachable.map((x) => x.nodeId)).toEqual(['t']);
  });

  it('只改实体简介(不参与遍历)仍然命中 —— dry-run 前后对比的收益来源', () => {
    const f = flow([node('a', 'dialogue')], []);
    const e1 = ent('e1', 'hero', [{ id: 'f1', label: 'trust', value: '5' }]);
    const e2 = { ...structuredClone(e1), summary: '换了简介', name: '换了名字', notes: '换了备注' };
    cachedSimulateFlow(f, [], [e1]);
    cachedSimulateFlow(f, [], [e2]);
    expect(pathCacheStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('实体字段值参与条件求值,改动必须重算', () => {
    const f = flow(
      [node('c', 'condition', { text: 'hero.trust > 3' }), node('t', 'dialogue'), node('e', 'dialogue')],
      [edge('c', 't', { sourceHandle: 'true' }), edge('c', 'e', { sourceHandle: 'false' })],
    );
    const low = ent('e1', 'hero', [{ id: 'f1', label: 'trust', value: '1' }]);
    const high = ent('e1', 'hero', [{ id: 'f1', label: 'trust', value: '9' }]);
    const r1 = cachedSimulateFlow(f, [], [low]);
    const r2 = cachedSimulateFlow(f, [], [high]);
    expect(pathCacheStats()).toMatchObject({ hits: 0, misses: 2 });
    expect(r1.unreachable.map((x) => x.nodeId)).toEqual(['t']);
    expect(r2.unreachable.map((x) => x.nodeId)).toEqual(['e']);
  });

  it('字段 type 决定是否注入属性表,改 type 必须重算', () => {
    const f = flow([node('a', 'dialogue')], []);
    const asText = ent('e1', 'hero', [{ id: 'f1', label: 'ref', value: 'e2', type: 'text' }]);
    const asEntity = ent('e1', 'hero', [{ id: 'f1', label: 'ref', value: 'e2', type: 'entity' }]);
    cachedSimulateFlow(f, [], [asText]);
    cachedSimulateFlow(f, [], [asEntity]);
    expect(pathCacheStats()).toMatchObject({ hits: 0, misses: 2 });
  });

  it('entity 型字段按 id 解析,实体 id 变化必须重算', () => {
    const f = flow([node('a', 'dialogue')], []);
    const mk = (heroId: string, otherId: string): Entity[] => [
      ent(heroId, 'hero', [{ id: 'f1', label: 'ref', value: 'X', type: 'entity' }]),
      ent(otherId, 'other', []),
    ];
    // 'X' 分别指向不同实体 → 属性表里 hero.ref 的值不同
    cachedSimulateFlow(f, [], mk('X', 'Y'));
    cachedSimulateFlow(f, [], mk('Y', 'X'));
    expect(pathCacheStats()).toMatchObject({ hits: 0, misses: 2 });
  });

  it('遍历上限不同不共用缓存', () => {
    const f = flow([node('a', 'dialogue')], []);
    cachedSimulateFlow(f, [], [], { maxPaths: 10 });
    cachedSimulateFlow(f, [], [], { maxPaths: 20 });
    expect(pathCacheStats()).toMatchObject({ hits: 0, misses: 2 });
  });

  it('超过上限时淘汰最久未用的条目', () => {
    for (let i = 0; i < 70; i++) {
      cachedSimulateFlow(flow([node(`n${i}`, 'dialogue')], []), [], []);
    }
    expect(pathCacheStats().size).toBeLessThanOrEqual(64);
  });
});
