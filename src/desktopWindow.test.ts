import { describe, expect, it } from 'vitest';
import { fitWindow, type MonitorBox, type WindowState } from './desktopWindow';

const mon4k: MonitorBox = { width: 2560, height: 1440 };   // 4K 屏 150% 缩放后的逻辑尺寸
const monSmall: MonitorBox = { width: 1366, height: 768 };  // 老笔记本

describe('首次启动(没有记录)', () => {
  it('按屏幕比例给一个大窗,而不是固定 1440×900', () => {
    const w = fitWindow(null, mon4k);
    expect(w.width).toBe(Math.round(2560 * 0.86));
    expect(w.height).toBe(Math.round(1440 * 0.86));
    // 留了边,不是整屏
    expect(w.width).toBeLessThan(mon4k.width);
  });

  it('小屏上不低于最小尺寸', () => {
    const w = fitWindow(null, { width: 800, height: 500 });
    expect(w.width).toBeGreaterThanOrEqual(940);
    expect(w.height).toBeGreaterThanOrEqual(600);
  });

  it('不给位置,交给居中', () => {
    expect(fitWindow(null, mon4k).x).toBeUndefined();
  });
});

describe('恢复上次尺寸', () => {
  const saved: WindowState = { width: 2000, height: 1200, x: 100, y: 60 };

  it('原样恢复', () => {
    expect(fitWindow(saved, mon4k)).toMatchObject({ width: 2000, height: 1200, x: 100, y: 60 });
  });

  it('换到更小的屏幕时收进屏内 —— 否则窗口比屏幕还大,标题栏都够不着', () => {
    const w = fitWindow(saved, monSmall);
    expect(w.width).toBeLessThanOrEqual(monSmall.width);
    expect(w.height).toBeLessThanOrEqual(monSmall.height);
  });

  it('位置跑到屏幕外时拉回来,至少留一条边可抓', () => {
    const off = fitWindow({ width: 1200, height: 800, x: 9999, y: 9999 }, monSmall);
    expect(off.x!).toBeLessThanOrEqual(monSmall.width - 80);
    expect(off.y!).toBeLessThanOrEqual(monSmall.height - 80);
    // 负坐标(多屏左侧)允许,但不能整个移出去
    const left = fitWindow({ width: 1200, height: 800, x: -5000, y: -500 }, monSmall);
    expect(left.x!).toBeGreaterThan(-1200);
    expect(left.y!).toBeGreaterThanOrEqual(0);
  });

  it('最大化状态跟着记', () => {
    expect(fitWindow({ ...saved, maximized: true }, mon4k).maximized).toBe(true);
  });

  it('记录里是荒唐值时也收进合法范围', () => {
    const w = fitWindow({ width: 1, height: 1 }, mon4k);
    expect(w.width).toBeGreaterThanOrEqual(940);
    expect(w.height).toBeGreaterThanOrEqual(600);
  });
});
