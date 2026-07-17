import { describe, expect, it } from 'vitest';
import { loadAiSessions, newAiSession, saveAiSessions } from './sessions';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe('AI 本机会话', () => {
  it('按项目槽位隔离保存并恢复', () => {
    const storage = new MemoryStorage();
    const first = newAiSession(100);
    first.title = '项目甲对话';
    first.messages.push({ id: 'm1', role: 'user', text: '问题', createdAt: 101 });
    saveAiSessions('slot-a', [first], storage);

    expect(loadAiSessions('slot-a', storage)[0].title).toBe('项目甲对话');
    expect(loadAiSessions('slot-b', storage)).toEqual([]);
  });

  it('损坏数据返回空列表且不会进入项目对象', () => {
    const storage = new MemoryStorage();
    storage.setItem('theloom-ai-sessions-v1:slot-a', '{bad json');

    expect(loadAiSessions('slot-a', storage)).toEqual([]);
    expect(newAiSession(100)).not.toHaveProperty('project');
  });

  it('限制会话、消息数量和正文长度', () => {
    const storage = new MemoryStorage();
    const sessions = Array.from({ length: 35 }, (_, index) => {
      const session = newAiSession(index + 1);
      session.updatedAt = index + 1;
      session.messages = Array.from({ length: 110 }, (__, messageIndex) => ({
        id: `${index}-${messageIndex}`,
        role: 'user' as const,
        text: messageIndex === 10 ? '字'.repeat(31_000) : '短消息',
        createdAt: messageIndex,
      }));
      return session;
    });
    saveAiSessions('slot-a', sessions, storage);

    const loaded = loadAiSessions('slot-a', storage);
    expect(loaded).toHaveLength(30);
    expect(loaded[0].messages).toHaveLength(100);
    expect(loaded[0].messages.some((message) => message.text.length === 30_000)).toBe(true);
  });
});
