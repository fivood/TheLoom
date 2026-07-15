import { describe, expect, it } from 'vitest';
import { useDialog, promptText, confirmDialog, alertDialog } from './dialog';

describe('应用内对话框 store', () => {
  it('prompt 返回输入文本,关闭后 store 清空', async () => {
    const p = promptText({ message: '问', defaultValue: '默认' });
    expect(useDialog.getState().current).not.toBeNull();
    expect(useDialog.getState().current?.kind).toBe('prompt');
    expect(useDialog.getState().current?.options.defaultValue).toBe('默认');
    useDialog.getState().close('回答');
    const result = await p;
    expect(result).toBe('回答');
    expect(useDialog.getState().current).toBeNull();
  });

  it('prompt 取消(Esc / 关闭返回 null)resolve 为 null', async () => {
    const p = promptText('问');
    useDialog.getState().close(null);
    expect(await p).toBeNull();
  });

  it('confirm 确认返回 true,取消返回 false', async () => {
    const c1 = confirmDialog({ message: '确认', danger: true });
    expect(useDialog.getState().current?.kind).toBe('confirm');
    expect(useDialog.getState().current?.options.danger).toBe(true);
    useDialog.getState().close(true);
    expect(await c1).toBe(true);

    const c2 = confirmDialog('再次确认');
    useDialog.getState().close(false);
    expect(await c2).toBe(false);
  });

  it('alert 关闭即 resolve', async () => {
    const a = alertDialog({ message: '注意' });
    expect(useDialog.getState().current?.kind).toBe('alert');
    useDialog.getState().close(true);
    await a;
    expect(useDialog.getState().current).toBeNull();
  });

  it('字符串快捷入参等价于 { message }', () => {
    promptText('纯字符串');
    expect(useDialog.getState().current?.options.message).toBe('纯字符串');
    useDialog.getState().close(null);
  });
});
