import { useEffect } from 'react';

/**
 * 软键盘适配。
 *
 * iOS Safari 弹出键盘时**不会**缩小布局视口 —— `innerHeight` 与 CSS 的 100% 都保持不变,
 * 于是吸底的块操作条与底部 tab 栏原地不动,被键盘整个盖住(真机截图里操作条只露半截)。
 * 只有 visualViewport 会反映真实可见区域。
 *
 * 这里把可见高度写进 `--vvh`,移动壳用它当自身高度,键盘一弹整个壳就缩到键盘之上;
 * 同时在 <html> 上打 `data-kb`,供 CSS 在键盘打开时让出 tab 栏的空间。
 *
 * 注意:**不要把首次写入放进 requestAnimationFrame** —— 页面在后台(或无头环境)时
 * rAF 不会触发,`--vvh` 就永远不会被设置。visualViewport 的事件本身频率不高,直接同步写。
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!vv) return; // 老浏览器:CSS 里的 100% 兜底,行为与改动前一致

    const update = () => {
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      // offsetTop:页面被键盘顶上去时的偏移,不减掉会少算一截
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // 80px 阈值:躲开 Safari 上下工具栏收放造成的小幅抖动,只认真正的键盘
      root.dataset.kb = covered > 80 ? '1' : '0';
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--vvh');
      delete root.dataset.kb;
    };
  }, []);
}
