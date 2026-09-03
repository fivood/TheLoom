import { useEffect, useState } from 'react';
import { installPwa, refreshForUpdate, usePwaStatus } from '../pwa';
import Q from './Q';

const INSTALL_DISMISS_KEY = 'theloom-install-dismissed';
const IOS_SAFETY_DISMISS_KEY = 'theloom-ios-safety-dismissed';

/**
 * iOS Safari(非 Chrome/Firefox/Edge):不触发 beforeinstallprompt,且存储 7 天不活跃会被清。
 *
 * iPadOS 13+ 的 Safari 默认「请求桌面网站」,UA 里报的是 Macintosh 而非 iPad ——
 * 只匹配 /iPad/ 会漏掉全部现代 iPad,而存储清理策略对 iPad 一样生效,
 * 恰恰是最该看到这条提醒的设备。用触点数把它和真 Mac 分开(Mac 触点为 0)。
 */
export function isIosSafari(ua: string, maxTouchPoints: number): boolean {
  if (/CriOS|FxiOS|EdgiOS/.test(ua)) return false;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

function currentIsIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isIosSafari(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

export default function PwaBanner() {
  const { canInstall, needRefresh, offlineReady } = usePwaStatus();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(INSTALL_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [offlineSeen, setOfflineSeen] = useState(false);
  const [safetyDismissed, setSafetyDismissed] = useState(() => {
    try { return localStorage.getItem(IOS_SAFETY_DISMISS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (!offlineReady) return;
    setOfflineSeen(true);
    const timer = setTimeout(() => setOfflineSeen(false), 6000);
    return () => clearTimeout(timer);
  }, [offlineReady]);

  if (needRefresh) {
    return (
      <div className="pwa-banner" role="status">
        <span>新版本已就绪,刷新后生效。</span>
        <button className="pwa-banner-btn" onClick={() => refreshForUpdate()}>立即刷新</button>
      </div>
    );
  }

  if (canInstall && !dismissed) {
    return (
      <div className="pwa-banner" role="status">
        <span>安装到桌面,无需联网也能打开写作。</span>
        <button className="pwa-banner-btn" onClick={() => installPwa()}>安装</button>
        <button
          className="pwa-banner-close"
          aria-label="稍后"
          title="稍后"
          onClick={() => {
            try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch { /* 忽略 */ }
            setDismissed(true);
          }}
        >×</button>
      </div>
    );
  }

  if (currentIsIosSafari() && !safetyDismissed) {
    return (
      <div className="pwa-banner" role="status">
        <span>数据保存在本机浏览器,iOS 长期不打开可能被清理。建议定期<Q>工具 → JSON 备份</Q>,或用外链网盘同步 / 桌面版绑定文件夹。</span>
        <button
          className="pwa-banner-close"
          aria-label="知道了"
          title="知道了"
          onClick={() => {
            try { localStorage.setItem(IOS_SAFETY_DISMISS_KEY, '1'); } catch { /* 忽略 */ }
            setSafetyDismissed(true);
          }}
        >×</button>
      </div>
    );
  }

  if (offlineReady && offlineSeen) {
    return <div className="pwa-toast" role="status">已可离线使用。</div>;
  }

  return null;
}
