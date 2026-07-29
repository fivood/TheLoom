import { describe, expect, it } from 'vitest';
import { alignNodes, distributeNodes, type LayoutBox } from './flowLayout';

const box = (id: string, x: number, y: number, width = 100, height = 50): LayoutBox =>
  ({ id, position: { x, y }, width, height });

describe('R19-5 对齐', () => {
  const three = [box('a', 0, 0), box('b', 50, 20), box('c', 200, 100)];

  it('左 / 右对齐:右对齐按各自宽度回退,不是简单对齐左上角', () => {
    expect([...alignNodes(three, 'left').values()].map((p) => p.x)).toEqual([0, 0, 0]);
    // 最右边界 = 200 + 100 = 300;每个节点宽 100 → x 都是 200
    expect([...alignNodes(three, 'right').values()].map((p) => p.x)).toEqual([200, 200, 200]);
  });

  it('顶 / 底对齐同理', () => {
    expect([...alignNodes(three, 'top').values()].map((p) => p.y)).toEqual([0, 0, 0]);
    // 最下边界 = 100 + 50 = 150;每个节点高 50 → y 都是 100
    expect([...alignNodes(three, 'bottom').values()].map((p) => p.y)).toEqual([100, 100, 100]);
  });

  it('居中用整体包围盒中心,不被密集的一侧拽偏', () => {
    // 两个挤在左边、一个在右边:包围盒中心 = (0 + 300) / 2 = 150
    const r = alignNodes(three, 'centerX');
    expect([...r.values()].map((p) => p.x)).toEqual([100, 100, 100]);   // 150 - 100/2
  });

  it('宽高不同的节点居中后中心真的对齐', () => {
    const mixed = [box('wide', 0, 0, 200, 50), box('narrow', 300, 0, 40, 50)];
    const r = alignNodes(mixed, 'centerX');
    const centerOf = (id: string, w: number) => r.get(id)!.x + w / 2;
    expect(centerOf('wide', 200)).toBe(centerOf('narrow', 40));
  });

  it('尺寸缺失时按 0 处理,退化成按左上角对齐而不是算出离谱位置', () => {
    const noSize: LayoutBox[] = [{ id: 'a', position: { x: 10, y: 0 } }, { id: 'b', position: { x: 90, y: 0 } }];
    expect([...alignNodes(noSize, 'right').values()].map((p) => p.x)).toEqual([90, 90]);
    expect([...alignNodes(noSize, 'centerX').values()].map((p) => p.x)).toEqual([50, 50]);
  });

  it('少于 2 个节点不动', () => {
    expect(alignNodes([box('a', 5, 5)], 'left').size).toBe(0);
    expect(alignNodes([], 'left').size).toBe(0);
  });
});

describe('R19-5 等距分布', () => {
  it('首尾不动,中间均分', () => {
    const r = distributeNodes([box('a', 0, 0), box('b', 10, 0), box('c', 300, 0)], 'x');
    expect(r.get('a')).toBe(0);
    expect(r.get('b')).toBe(150);
    expect(r.get('c')).toBe(300);
  });

  it('按坐标排序而不是按传入顺序', () => {
    const r = distributeNodes([box('c', 300, 0), box('a', 0, 0), box('b', 10, 0)], 'x');
    expect(r.get('a')).toBe(0);
    expect(r.get('b')).toBe(150);
    expect(r.get('c')).toBe(300);
  });

  it('纵向同理', () => {
    const r = distributeNodes([box('a', 0, 0), box('b', 0, 5), box('c', 0, 90), box('d', 0, 300)], 'y');
    expect([...r.values()].sort((x, y) => x - y)).toEqual([0, 100, 200, 300]);
  });

  it('少于 3 个节点不动 —— 两个之间无所谓等距', () => {
    expect(distributeNodes([box('a', 0, 0), box('b', 99, 0)], 'x').size).toBe(0);
  });
});
