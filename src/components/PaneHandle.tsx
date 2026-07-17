import { useRef } from 'react';

/**
 * 竖向分栏拖拽柄:拖动修改根元素上的 CSS 变量宽度,松手后存 localStorage。
 * 宽度是本机界面偏好,不写入项目数据。
 */

const STORE_KEY = 'theloom-panes-v1';

type PaneVar = '--pane-nav' | '--pane-inspector';

const LIMITS: Record<PaneVar, { min: number; max: number; fallback: number }> = {
  '--pane-nav': { min: 170, max: 480, fallback: 260 },
  '--pane-inspector': { min: 240, max: 560, fallback: 320 },
};

function readStore(): Partial<Record<PaneVar, number>> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Partial<Record<PaneVar, number>>;
  } catch { /* 忽略 */ }
  return {};
}

/** 应用启动时恢复保存过的分栏宽度(App 挂载时调用一次) */
export function initPaneWidths() {
  const saved = readStore();
  for (const key of Object.keys(LIMITS) as PaneVar[]) {
    const value = saved[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const { min, max } = LIMITS[key];
      document.documentElement.style.setProperty(key, `${Math.min(max, Math.max(min, value))}px`);
    }
  }
}

function currentWidth(varName: PaneVar): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : LIMITS[varName].fallback;
}

/**
 * 放在栏容器(position: relative)内部,贴在 side 指定的边缘。
 * side='right':柄在右缘,向右拖变宽(Navigator);
 * side='left' :柄在左缘,向左拖变宽(inspector)。
 */
export default function PaneHandle({ varName, side }: { varName: PaneVar; side: 'left' | 'right' }) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: currentWidth(varName) };
    const { min, max } = LIMITS[varName];
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      const delta = ev.clientX - drag.current.startX;
      const next = drag.current.startWidth + (side === 'right' ? delta : -delta);
      document.documentElement.style.setProperty(varName, `${Math.min(max, Math.max(min, next))}px`);
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('pane-resizing');
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ ...readStore(), [varName]: currentWidth(varName) }));
      } catch { /* 空间不足时忽略 */ }
    };
    document.body.classList.add('pane-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className={`pane-handle pane-handle-${side}`}
      title="拖动调整栏宽"
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        document.documentElement.style.removeProperty(varName);
        try {
          const saved = readStore();
          delete saved[varName];
          localStorage.setItem(STORE_KEY, JSON.stringify(saved));
        } catch { /* 忽略 */ }
      }}
    />
  );
}
