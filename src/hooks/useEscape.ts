import { useEffect } from 'react';

/**
 * R16-3 无障碍:模态 / 面板挂上就能用 Esc 关闭,
 * 焦点在 modal 内的输入框里按 Esc 也能一路冒出到 window 层。
 * 已开的其他弹层(如输入框内的候选菜单)自己处理时应先 stopPropagation。
 *
 * 多层叠加时只有最上层响应 Esc:所有实例共享一个 window 监听,
 * 后挂载的(栈顶)先关,避免「确认框 + 下层面板」被一次 Esc 同时关掉。
 */
const stack: Array<() => void> = [];
let listening = false;

const onKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || stack.length === 0) return;
  e.preventDefault();
  stack[stack.length - 1]();
};

export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    stack.push(onEscape);
    if (!listening) {
      window.addEventListener('keydown', onKey);
      listening = true;
    }
    return () => {
      const i = stack.lastIndexOf(onEscape);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0 && listening) {
        window.removeEventListener('keydown', onKey);
        listening = false;
      }
    };
  }, [active, onEscape]);
}
