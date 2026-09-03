import { describe, expect, it } from 'vitest';
import { jumpTargetPane, openInPrimary, type PaneState } from './panes';

const split: PaneState = { tab: 'documents', secondary: 'entities' };

describe('分屏面板归属', () => {
  it('主面板切到副面板正在显示的模块时两侧对调,绝不出现同模块并存', () => {
    expect(openInPrimary(split, 'entities')).toEqual({ tab: 'entities', secondary: 'documents' });
    expect(openInPrimary(split, 'outline')).toEqual({ tab: 'outline', secondary: 'entities' });
    expect(openInPrimary(split, 'documents')).toEqual(split);
    // 任何一步之后两侧都不同
    for (const next of ['documents', 'entities', 'outline', 'flow'] as const) {
      const after = openInPrimary(split, next);
      expect(after.tab).not.toBe(after.secondary);
    }
  });

  it('单栏时不受影响', () => {
    const single: PaneState = { tab: 'documents', secondary: null };
    expect(openInPrimary(single, 'entities')).toEqual({ tab: 'entities', secondary: null });
  });

  it('跳转:目标在副面板则由副面板消费,否则走主面板', () => {
    expect(jumpTargetPane(split, 'entities')).toBe('secondary');
    expect(jumpTargetPane(split, 'documents')).toBe('primary');
    expect(jumpTargetPane({ tab: 'entities', secondary: 'entities' }, 'entities')).toBe('primary');
    expect(jumpTargetPane({ tab: 'documents', secondary: null }, 'entities')).toBe('primary');
  });
});
