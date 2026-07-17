import type { ReactNode } from 'react';
import PaneHandle from './PaneHandle';

/** 右侧属性栏:外层定位 + 左缘拖拽柄,内层滚动(柄不随内容滚动) */
export default function Inspector({ children }: { children: ReactNode }) {
  return (
    <aside className="inspector">
      <PaneHandle varName="--pane-inspector" side="left" />
      <div className="inspector-body">{children}</div>
    </aside>
  );
}
