import { useEffect, useState } from 'react';
import { installPwa, refreshForUpdate, usePwaStatus } from '../pwa';

const INSTALL_DISMISS_KEY = 'theloom-install-dismissed';

export default function PwaBanner() {
  const { canInstall, needRefresh, offlineReady } = usePwaStatus();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(INSTALL_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [offlineSeen, setOfflineSeen] = useState(false);

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

  if (offlineReady && offlineSeen) {
    return <div className="pwa-toast" role="status">已可离线使用。</div>;
  }

  return null;
}
