/**
 * 界面文案里提到别的模块时,名字必须跟着预设走:
 * 小说预设下「实体」叫设定集、「文档」叫正文,写死模块名会把人指到一个不存在的按钮上。
 */
import { useLoom } from './store';
import { workspaceTabLabel, type WorkspaceTab } from './workspace';

export function useModuleName(tab: WorkspaceTab): string {
  const preset = useLoom((s) => s.project.workspacePreset) ?? 'universal';
  return workspaceTabLabel(preset, tab);
}
