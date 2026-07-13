/**
 * 桌面版自动更新(仅 Tauri)
 *
 * 更新清单与安装包均经 theloom.pages.dev 中转(Cloudflare 边缘
 * 代理 GitHub Releases),更新包由 minisign 签名校验。
 */
import { isTauri } from './storage';

export async function checkForUpdates(silent = true): Promise<void> {
  if (!isTauri) return;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      if (!silent) alert('当前已是最新版本。');
      return;
    }
    const notes = update.body ? `\n\n更新说明:\n${update.body.slice(0, 400)}` : '';
    if (!confirm(`发现新版本 v${update.version}(当前 v${update.currentVersion}),现在下载并安装?${notes}`)) return;
    await update.downloadAndInstall();
    if (confirm('更新已安装完成,立即重启应用生效?')) {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    }
  } catch (e) {
    console.warn('检查更新失败', e);
    if (!silent) alert(`检查更新失败:${e}`);
  }
}
