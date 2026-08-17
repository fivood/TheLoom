import { describe, expect, it } from 'vitest';
import {
  addIdea, editIdea, markUsed, mergeInbox, removeIdea, visibleIdeas, type IdeaCard,
} from './inbox';

function card(id: string, text: string, createdAt: number, updatedAt = createdAt): IdeaCard {
  return { id, text, createdAt, updatedAt };
}

describe('灵感库', () => {
  it('新增后按时间倒序可见', () => {
    let cards = addIdea([], '一个记不住脸的侦探');
    cards = addIdea(cards, '雨夜的最后一班船');
    const list = visibleIdeas(cards);
    expect(list).toHaveLength(2);
    expect(list[0].text).toBe('雨夜的最后一班船');
  });

  it('空白文字不产生卡片', () => {
    expect(addIdea([], '   ')).toHaveLength(0);
  });

  it('删除留墓碑:记录还在,但界面上看不到', () => {
    const cards = removeIdea([card('a', '甲', 1)], 'a');
    expect(cards).toHaveLength(1);
    expect(cards[0].deletedAt).toBeGreaterThan(0);
    expect(visibleIdeas(cards)).toHaveLength(0);
  });

  it('取用只记去向,不删卡片;同一项目不重复记', () => {
    let cards = markUsed([card('a', '甲', 1)], 'a', 'p1', '雨夜');
    cards = markUsed(cards, 'a', 'p1', '雨夜');
    expect(cards[0].usedIn).toHaveLength(1);
    cards = markUsed(cards, 'a', 'p2', '另一部');
    expect(cards[0].usedIn!.map((u) => u.projectName)).toEqual(['雨夜', '另一部']);
    expect(visibleIdeas(cards)).toHaveLength(1);
  });

  it('合并取并集 —— 两台设备各记各的都留下,不需要冲突判定', () => {
    const pc = [card('a', '甲', 1), card('b', '乙', 2)];
    const phone = [card('a', '甲', 1), card('c', '丙', 3)];
    const merged = mergeInbox(pc, phone);
    expect(merged.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('同一张卡两边都改过时取较新的', () => {
    const older = [card('a', '旧版', 1, 100)];
    const newer = [card('a', '新版', 1, 200)];
    expect(mergeInbox(older, newer)[0].text).toBe('新版');
    expect(mergeInbox(newer, older)[0].text).toBe('新版');
  });

  it('删除能通过合并传播 —— 没有墓碑的话它会被对端同步回来', () => {
    const kept = [card('a', '甲', 1, 100)];
    const deleted = removeIdea([card('a', '甲', 1, 100)], 'a');
    const merged = mergeInbox(kept, deleted);
    expect(merged[0].deletedAt).toBeGreaterThan(0);
    expect(visibleIdeas(merged)).toHaveLength(0);
  });

  it('删除后又在另一台设备改过:较新的编辑胜出,卡片复活', () => {
    const deleted = removeIdea([card('a', '甲', 1, 100)], 'a');
    const edited = editIdea([card('a', '甲', 1, 100)], 'a', '改过的');
    // 编辑发生在删除之后(updatedAt 更大)
    edited[0].updatedAt = deleted[0].updatedAt + 10;
    const merged = mergeInbox(deleted, edited);
    expect(merged[0].deletedAt).toBeUndefined();
    expect(visibleIdeas(merged)).toHaveLength(1);
  });
});
