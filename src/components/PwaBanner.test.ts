import { describe, expect, it } from 'vitest';
import { isIosSafari } from './PwaBanner';

/**
 * 存储清理提醒的目标设备判定。
 *
 * 核心是 iPadOS 13+ ——「请求桌面网站」是默认开启的,UA 报 Macintosh。
 * 只按 /iPad/ 匹配会漏掉全部现代 iPad,而 iOS「7 天不活跃清存储」对 iPad 一样生效。
 */

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const IPAD_MOBILE_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

describe('isIosSafari', () => {
  it('iPhone Safari 命中', () => {
    expect(isIosSafari(IPHONE, 5)).toBe(true);
  });

  it('iPad 报 Macintosh UA 时靠触点数命中(这是原来漏掉的)', () => {
    expect(isIosSafari(IPAD_DESKTOP_UA, 5)).toBe(true);
  });

  it('iPad 未开桌面网站时按 UA 直接命中', () => {
    expect(isIosSafari(IPAD_MOBILE_UA, 5)).toBe(true);
  });

  it('真 Mac 不命中(触点为 0)', () => {
    expect(isIosSafari(MAC_SAFARI, 0)).toBe(false);
  });

  it('iOS 上的 Chrome 不命中(它有自己的安装提示路径)', () => {
    expect(isIosSafari(IOS_CHROME, 5)).toBe(false);
  });

  it('桌面 Chrome 不命中', () => {
    expect(isIosSafari(WINDOWS_CHROME, 0)).toBe(false);
  });

  it('触摸屏 Windows 笔记本不命中', () => {
    expect(isIosSafari(WINDOWS_CHROME, 10)).toBe(false);
  });
});
