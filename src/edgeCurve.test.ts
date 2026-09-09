import { describe, expect, it } from 'vitest';
import {
  curveControl, curvedPath, dragCurve, isCurved, sanitizeCurve,
  type EdgeCurve, type Point,
} from './edgeCurve';

const P1: Point = { x: 0, y: 0 };
const P2: Point = { x: 200, y: 0 };
const MID: Point = { x: 100, y: 0 };

/** 二次贝塞尔上的点,用来独立验证路径确实经过手柄 */
function bezier(p1: Point, c: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p1.x + 2 * u * t * c.x + t * t * p2.x,
    y: u * u * p1.y + 2 * u * t * c.y + t * t * p2.y,
  };
}

describe('连线弯度', () => {
  it('没弯时输出直线段,手柄在中点', () => {
    const out = curvedPath(P1, P2, curveControl(MID), undefined);
    expect(out.path).toBe('M 0,0L 200,0');
    expect(out.handle).toEqual({ x: 100, y: 0 });
  });

  it('半像素以内的抖动不算弯 —— 一次误触不该把直线永久变成贝塞尔', () => {
    expect(isCurved({ dx: 0.3, dy: -0.2 })).toBe(false);
    expect(curvedPath(P1, P2, curveControl(MID, { dx: 0.3, dy: -0.2 }), { dx: 0.3, dy: -0.2 }).path)
      .toBe('M 0,0L 200,0');
  });

  it('控制点是偏移的两倍,曲线正好在「中点+偏移」处经过', () => {
    const curve: EdgeCurve = { dx: 0, dy: -60 };
    const ctrl = curveControl(MID, curve);
    expect(ctrl).toEqual({ x: 100, y: -120 });
    const out = curvedPath(P1, P2, ctrl, curve);
    expect(out.handle.x).toBeCloseTo(100, 6);
    expect(out.handle.y).toBeCloseTo(-60, 6);
    // 独立算一遍贝塞尔,确认手柄真在曲线上
    const onCurve = bezier(P1, ctrl, P2, 0.5);
    expect(onCurve.x).toBeCloseTo(out.handle.x, 6);
    expect(onCurve.y).toBeCloseTo(out.handle.y, 6);
  });

  it('手柄 1:1 跟手 —— 拖多远,手柄就移多远', () => {
    const before: EdgeCurve = { dx: 10, dy: -20 };
    const delta = { x: 33, y: 47 };
    const after = dragCurve(before, delta)!;
    const h0 = curvedPath(P1, P2, curveControl(MID, before), before).handle;
    const h1 = curvedPath(P1, P2, curveControl(MID, after), after).handle;
    expect(h1.x - h0.x).toBeCloseTo(delta.x, 6);
    expect(h1.y - h0.y).toBeCloseTo(delta.y, 6);
  });

  it('从直线开始拖也是 1:1', () => {
    const delta = { x: -18, y: 55 };
    const after = dragCurve(undefined, delta)!;
    const h0 = curvedPath(P1, P2, curveControl(MID), undefined).handle;
    const h1 = curvedPath(P1, P2, curveControl(MID, after), after).handle;
    expect(h1.x - h0.x).toBeCloseTo(delta.x, 6);
    expect(h1.y - h0.y).toBeCloseTo(delta.y, 6);
  });

  it('拖回原处自动退回直线,不留下一条几乎笔直的贝塞尔', () => {
    const bent = dragCurve(undefined, { x: 40, y: 40 })!;
    expect(dragCurve(bent, { x: -40, y: -40 })).toBeUndefined();
  });

  it('弯度是相对中点的偏移,卡片整体挪动时形状不变', () => {
    const curve: EdgeCurve = { dx: 0, dy: -60 };
    const shape = (o: number) => {
      const a = { x: P1.x + o, y: P1.y + o };
      const b = { x: P2.x + o, y: P2.y + o };
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const h = curvedPath(a, b, curveControl(mid, curve), curve).handle;
      return { x: h.x - mid.x, y: h.y - mid.y };
    };
    expect(shape(500)).toEqual(shape(0));
  });

  it('脏数据一律丢弃', () => {
    expect(sanitizeCurve(null)).toBeUndefined();
    expect(sanitizeCurve({ dx: NaN, dy: 1 })).toBeUndefined();
    expect(sanitizeCurve({ dx: '10', dy: 1 })).toBeUndefined();
    expect(sanitizeCurve({ dx: 0.1, dy: 0.1 })).toBeUndefined();
    expect(sanitizeCurve({ dx: 12, dy: -30 })).toEqual({ dx: 12, dy: -30 });
  });
});
