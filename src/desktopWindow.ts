import { isTauri } from './storage';

/**
 * 桌面窗口尺寸的记忆与首次默认。
 *
 * 固定 1440×900 在 4K 屏上只占一小块,每次开都要拖。这里做两件事:
 *   ① 记住上次关闭时的尺寸、位置与是否最大化
 *   ② 没有记录时(首次启动 / 换机器),按当前显示器工作区按比例给一个大窗
 *
 * 尺寸属于本机界面偏好,存 localStorage,不进项目、不参与同步。
 */

const KEY = 'theloom-window-v1';

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

export interface MonitorBox {
  /** 显示器逻辑宽高(物理尺寸 ÷ 缩放系数) */
  width: number;
  height: number;
}

/** 首次启动占显示器的比例;留一圈边,免得看起来像最大化又不是 */
const FIRST_RUN_RATIO = 0.86;
/** 与 tauri.conf.json 的 minWidth / minHeight 保持一致 */
const MIN_W = 940;
const MIN_H = 600;

/**
 * 算出该用多大、摆在哪。纯函数 —— 换显示器、分辨率变小、记录损坏这些情况
 * 都在这里收敛,不必真开窗口才能验。
 *
 * @param saved 上次记录;没有则按比例给默认
 * @param monitor 当前显示器的逻辑尺寸
 */
export function fitWindow(saved: WindowState | null, monitor: MonitorBox): WindowState {
  const maxW = Math.max(MIN_W, monitor.width);
  const maxH = Math.max(MIN_H, monitor.height);

  if (!saved) {
    const width = Math.round(Math.min(maxW, Math.max(MIN_W, monitor.width * FIRST_RUN_RATIO)));
    const height = Math.round(Math.min(maxH, Math.max(MIN_H, monitor.height * FIRST_RUN_RATIO)));
    return { width, height };
  }

  // 换到更小的屏幕时,窗口不能比屏幕还大
  const width = Math.round(Math.min(maxW, Math.max(MIN_W, saved.width)));
  const height = Math.round(Math.min(maxH, Math.max(MIN_H, saved.height)));

  const out: WindowState = { width, height, maximized: saved.maximized };
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    // 至少留一部分在屏幕内,否则窗口会「消失」在看不见的地方
    const margin = 80;
    out.x = Math.round(Math.min(Math.max(saved.x, -width + margin), monitor.width - margin));
    out.y = Math.round(Math.min(Math.max(saved.y, 0), monitor.height - margin));
  }
  return out;
}

export function loadWindowState(): WindowState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<WindowState>;
    if (!Number.isFinite(v.width) || !Number.isFinite(v.height)) return null;
    return {
      width: v.width as number,
      height: v.height as number,
      x: Number.isFinite(v.x) ? v.x : undefined,
      y: Number.isFinite(v.y) ? v.y : undefined,
      maximized: v.maximized === true,
    };
  } catch {
    return null;
  }
}

export function saveWindowState(s: WindowState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* 存不下只是下次用默认尺寸,不影响使用 */ }
}

/** 在 App 挂载时调一次;网页端直接返回 */
export async function setupDesktopWindow(): Promise<void> {
  if (!isTauri) return;
  try {
    const { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } =
      await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const mon = await currentMonitor();
    if (!mon) return;
    const scale = mon.scaleFactor || 1;
    const box: MonitorBox = {
      width: Math.round(mon.size.width / scale),
      height: Math.round(mon.size.height / scale),
    };

    const want = fitWindow(loadWindowState(), box);
    await win.setSize(new LogicalSize(want.width, want.height));
    if (want.x !== undefined && want.y !== undefined) {
      await win.setPosition(new LogicalPosition(want.x, want.y));
    } else {
      await win.center();
    }
    if (want.maximized) await win.maximize();

    // 拖动 / 缩放随时记,而不是只在关闭时 —— 进程被强杀也不会丢
    let timer: ReturnType<typeof setTimeout> | null = null;
    const remember = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const maximized = await win.isMaximized();
          // 最大化时记的是「最大化」这个状态本身,尺寸保留还原后的那份
          if (maximized) {
            const prev = loadWindowState();
            saveWindowState({ ...(prev ?? want), maximized: true });
            return;
          }
          const size = await win.innerSize();
          const pos = await win.outerPosition();
          const f = await win.scaleFactor();
          saveWindowState({
            width: Math.round(size.width / f),
            height: Math.round(size.height / f),
            x: Math.round(pos.x / f),
            y: Math.round(pos.y / f),
            maximized: false,
          });
        } catch { /* 窗口正在关闭时取尺寸会失败,忽略 */ }
      }, 400);
    };
    await win.onResized(remember);
    await win.onMoved(remember);
  } catch (e) {
    /*
     * 拿不到窗口 API 就维持 tauri.conf.json 里的默认尺寸 —— 不影响使用,
     * 但**必须留痕**:Tauri v2 的窗口写操作要在 capabilities 里逐个放行,
     * 漏了就是这里静默失败,而现象只是「窗口还是老尺寸」,极难对上原因。
     */
    console.warn('窗口尺寸恢复失败(检查 capabilities 是否放行 core:window:allow-set-size 等):', e);
  }
}
