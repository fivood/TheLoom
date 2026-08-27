import { describe, expect, it } from 'vitest';
import type { FlowNodeData } from './types';
import { recastPasted } from './flowClipboard';

let seq = 0;
const newId = () => `new-${++seq}`;
const node = (id: string, data: Partial<FlowNodeData> = {}) =>
  ({ id, position: { x: 10, y: 20 }, data: data as FlowNodeData });

describe('粘贴时的身份重铸', () => {
  it('换 id 并整体偏移,内部连线按新 id 重接', () => {
    seq = 0;
    const out = recastPasted(
      [node('a'), node('b')],
      [{ id: 'e1', source: 'a', target: 'b' }],
      40, newId,
    );
    expect(out.nodes.map((n) => n.id)).toEqual(['new-1', 'new-2']);
    expect(out.nodes[0].position).toEqual({ x: 50, y: 60 });
    expect(out.edges[0]).toMatchObject({ source: 'new-1', target: 'new-2' });
    expect(out.edges[0].id).not.toBe('e1');
  });

  it('技术名不复制 —— 项目内唯一,复制过来必然重复', () => {
    seq = 0;
    const out = recastPasted([node('a', { technicalName: 'door_check' })], [], 0, newId);
    expect(out.nodes[0].data.technicalName).toBeUndefined();
  });

  it('unitId 不复制 —— 留着的话改副本会同时改原件', () => {
    seq = 0;
    const out = recastPasted([node('a', { unitId: 'u1', text: '台词' })], [], 0, newId);
    expect(out.nodes[0].data.unitId).toBeUndefined();
    expect(out.nodes[0].data.text).toBe('台词');
  });

  it('子流程内部也要一路换到底 —— 体检与 seen() 把嵌套节点当一等公民', () => {
    seq = 0;
    const fragment = node('frag', {
      sub: {
        nodes: [
          { id: 'in1', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '', text: '', technicalName: 'inner_tn', unitId: 'u9' } },
          { id: 'in2', type: 'exit', position: { x: 0, y: 0 }, data: { title: '', text: '' } },
        ],
        edges: [{ id: 'ie', source: 'in1', target: 'in2' }],
      },
    });
    const out = recastPasted([fragment], [], 0, newId);
    const sub = out.nodes[0].data.sub!;
    expect(sub.nodes.map((n) => n.id)).not.toContain('in1');
    expect(sub.nodes[0].data.technicalName).toBeUndefined();
    expect(sub.nodes[0].data.unitId).toBeUndefined();
    // 内部连线要接到换过的 id 上,不能还指着老的
    expect(sub.edges[0].source).toBe(sub.nodes[0].id);
    expect(sub.edges[0].target).toBe(sub.nodes[1].id);
  });

  it('多层嵌套逐层重铸', () => {
    seq = 0;
    const deep = node('outer', {
      sub: {
        nodes: [{
          id: 'mid', type: 'fragment', position: { x: 0, y: 0 },
          data: { title: '', text: '', sub: { nodes: [{ id: 'deep', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '', text: '', technicalName: 'x' } }], edges: [] } },
        }],
        edges: [],
      },
    });
    const out = recastPasted([deep], [], 0, newId);
    const inner = out.nodes[0].data.sub!.nodes[0].data.sub!;
    expect(inner.nodes[0].id).not.toBe('deep');
    expect(inner.nodes[0].data.technicalName).toBeUndefined();
  });

  it('不修改入参', () => {
    seq = 0;
    const src = [node('a', { technicalName: 'keep', unitId: 'u1' })];
    recastPasted(src, [], 40, newId);
    expect(src[0].id).toBe('a');
    expect(src[0].position).toEqual({ x: 10, y: 20 });
    expect(src[0].data.technicalName).toBe('keep');
    expect(src[0].data.unitId).toBe('u1');
  });
});
