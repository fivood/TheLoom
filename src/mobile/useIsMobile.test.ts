import { afterEach, describe, expect, it, vi } from 'vitest';
import { TABLET_MIN_EDGE, computeIsMobile } from './useIsMobile';

/** 造一个只提供 screen / innerWidth / innerHeight 的最小环境 */
function stubDevice(screenW: number, screenH: number, innerW = screenW, innerH = screenH) {
  vi.stubGlobal('window', {
    screen: { width: screenW, height: screenH },
    innerWidth: innerW,
    innerHeight: innerH,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('移动壳判定(按设备短边)', () => {
  it('iPhone 竖屏走手机壳', () => {
    stubDevice(393, 852);
    expect(computeIsMobile()).toBe(true);
  });

  it('iPhone 横屏仍走手机壳 —— 按视口宽度判定会误入桌面三栏', () => {
    // 横屏时视口宽 852(> 旧的 768 阈值),但设备短边仍是 393
    stubDevice(852, 393, 852, 393);
    expect(computeIsMobile()).toBe(true);
  });

  it('iPad mini(744)走手机壳', () => {
    stubDevice(744, 1133);
    expect(computeIsMobile()).toBe(true);
  });

  it('11 寸 iPad(短边 834)走桌面布局', () => {
    stubDevice(834, 1194);
    expect(computeIsMobile()).toBe(false);
  });

  it('11 寸 iPad 横屏同样走桌面布局', () => {
    stubDevice(1194, 834);
    expect(computeIsMobile()).toBe(false);
  });

  it('桌面浏览器把窗口拖窄不会变成手机壳', () => {
    stubDevice(1920, 1080, 500, 900);
    expect(computeIsMobile()).toBe(false);
  });

  it('阈值边界:短边正好等于阈值算平板', () => {
    stubDevice(TABLET_MIN_EDGE, 1200);
    expect(computeIsMobile()).toBe(false);
    stubDevice(TABLET_MIN_EDGE - 1, 1200);
    expect(computeIsMobile()).toBe(true);
  });

  it('screen 不可用时退回视口短边', () => {
    vi.stubGlobal('window', { screen: undefined, innerWidth: 400, innerHeight: 800 });
    expect(computeIsMobile()).toBe(true);
  });
});
