import { useEffect, useRef } from 'react';

/**
 * R16-3 无障碍:模态 / 面板挂上就能用 Esc 关闭,
 * 焦点在 modal 内的输入框里按 Esc 也能一路冒出到 window 层。
 * 已开的其他弹层(如输入框内的候选菜单)自己处理时应先 stopPropagation。
 *
 * 多层叠加时只有最上层响应 Esc:所有实例共享一个 window 监听,
 * 后挂载的(栈顶)先关,避免「确认框 + 下层面板」被一次 Esc 同时关掉。
 */
const stack: Array<{ fn: () => void }> = [];
let listening = false;

const onKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || stack.length === 0) return;
  e.preventDefault();
  stack[stack.length - 1].fn();
};

export function useEscape(active: boolean, onEscape: () => void): void {
  // 回调存 ref:入栈的是稳定条目,父组件重渲染换了新闭包也不会把旧层重新顶到栈顶
  const fnRef = useRef(onEscape);
  useEffect(() => { fnRef.current = onEscape; });
  useEffect(() => {
    if (!active) return;
    const entry = { fn: () => fnRef.current() };
    stack.push(entry);
    if (!listening) {
      window.addEventListener('keydown', onKey);
      listening = true;
    }
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0 && listening) {
        window.removeEventListener('keydown', onKey);
        listening = false;
      }
    };
  }, [active]);
}
