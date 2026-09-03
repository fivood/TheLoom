import type { ReactNode } from 'react';

/**
 * 界面文案里引用另一处界面元素的名字:「设定集」「＋ 新建场景」。
 * 引号由组件补,颜色走 --ink-quote —— 一句提示里哪几个字是「要去点的东西」,不用读完整句才知道。
 * 只用于 UI 文案,正文内容的渲染在 RichText,两者互不影响。
 */
export default function Q({ children }: { children: ReactNode }) {
  return <span className="ui-quote">「{children}」</span>;
}
