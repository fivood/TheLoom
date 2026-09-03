/**
 * 分屏的面板归属计算。
 * 不变量:同一个模块不允许在主副面板同时打开 —— 两个实例各自维护选中项,
 * 跳转该落在哪一侧无从判断(实测是竞态),两边显示同一份内容也没有意义。
 */
import type { WorkspaceTab as Tab } from './workspace';

export interface PaneState {
  tab: Tab;
  secondary: Tab | null;
}

/** 主面板切到 next:撞上副面板正在显示的模块时两侧对调 */
export function openInPrimary(state: PaneState, next: Tab): PaneState {
  if (state.tab === next) return state;
  if (state.secondary === next) return { tab: next, secondary: state.tab };
  return { ...state, tab: next };
}

/** 跳转目标已经在副面板打开时不动主面板,交给副面板消费 */
export function jumpTargetPane(state: PaneState, target: Tab): 'primary' | 'secondary' {
  return state.secondary === target && state.tab !== target ? 'secondary' : 'primary';
}
