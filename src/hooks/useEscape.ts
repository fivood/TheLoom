import { useEffect } from 'react';

/**
 * R16-3 无障碍:模态 / 面板挂上就能用 Esc 关闭,
 * 焦点在 modal 内的输入框里按 Esc 也能一路冒出到 window 层。
 * 已开的其他弹层(dialog 等)自己处理时应先 stopPropagation。
 */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onEscape(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onEscape]);
}
