import { describe, expect, it } from 'vitest';
import { blocksToText, textToBlocks } from './immersive';
import type { DocBlock, Entity } from './types';

const ENTS = [{ id: 'e1', name: '塞梅尔维斯' }] as Entity[];

function b(partial: Partial<DocBlock> & { id: string; type: DocBlock['type'] }): DocBlock {
  return { text: '', ...partial } as DocBlock;
}

describe('沉浸写作 块 ↔ 纯文本', () => {
  it('只改字时保住 id 与 unitId —— 批注和流程联动都挂在这两个上', () => {
    const prev = [b({ id: 'p1', type: 'paragraph', text: '雨下了一整夜。', unitId: 'u1' })];
    const next = textToBlocks('雨下了一整夜，屋檐在滴水。', prev, ENTS);
    expect(next[0].id).toBe('p1');
    expect(next[0].unitId).toBe('u1');
    expect(next[0].text).toBe('雨下了一整夜，屋檐在滴水。');
  });

  it('普通段落沿用原类型,action 不会被改成 paragraph', () => {
    const prev = [b({ id: 'a1', type: 'action', text: '他推开门。' })];
    expect(textToBlocks('他关上门。', prev, ENTS)[0].type).toBe('action');
  });

  it('对白往返保住说话人,前缀不进正文', () => {
    const prev = [b({ id: 'd1', type: 'dialogue', text: '你来晚了。', speakerId: 'e1' })];
    const text = blocksToText(prev, ENTS);
    expect(text).toBe('塞梅尔维斯：你来晚了。');
    const next = textToBlocks('塞梅尔维斯：你早到了。', prev, ENTS);
    expect(next[0].speakerId).toBe('e1');
    expect(next[0].text).toBe('你早到了。');
  });

  it('块级 Markdown 被识别:标题 / 引用 / 有序与无序列表', () => {
    const out = textToBlocks('# 第一章\n\n## 小节\n\n> 引用一行\n> 第二行\n\n- 甲\n- 乙\n\n1. 首\n2. 次', [], ENTS);
    expect(out.map((x) => x.type)).toEqual(['heading', 'subheading', 'quote', 'list', 'list']);
    expect(out[1].level).toBe(2);
    expect(out[2].text).toBe('引用一行\n第二行');
    expect(out[3].ordered).toBe(false);
    expect(out[3].items).toEqual(['甲', '乙']);
    expect(out[4].ordered).toBe(true);
  });

  it('往返:一篇混合文档转成文本再转回来,结构与文字不变', () => {
    const prev = [
      b({ id: '1', type: 'heading', text: '雨夜' }),
      b({ id: '2', type: 'paragraph', text: '第一段。', unitId: 'u2' }),
      b({ id: '3', type: 'dialogue', text: '进来吧。', speakerId: 'e1' }),
      b({ id: '4', type: 'quote', text: '一行\n两行' }),
      b({ id: '5', type: 'list', items: ['甲', '乙'], ordered: false }),
      b({ id: '6', type: 'subheading', text: '小节', level: 3 }),
    ];
    const round = textToBlocks(blocksToText(prev, ENTS), prev, ENTS);
    expect(round.map((x) => x.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(round.map((x) => x.type)).toEqual(prev.map((x) => x.type));
    expect(round[1].unitId).toBe('u2');
    expect(round[2].speakerId).toBe('e1');
    expect(round[4].items).toEqual(['甲', '乙']);
    expect(round[5].level).toBe(3);
  });

  it('新增段落建新块,删除段落只丢被删的那块', () => {
    const prev = [
      b({ id: '1', type: 'paragraph', text: '甲' }),
      b({ id: '2', type: 'paragraph', text: '乙' }),
    ];
    const added = textToBlocks('甲\n\n乙\n\n丙', prev, ENTS);
    expect(added).toHaveLength(3);
    expect(added.slice(0, 2).map((x) => x.id)).toEqual(['1', '2']);
    expect(added[2].id).not.toBe('2');

    const removed = textToBlocks('甲', prev, ENTS);
    expect(removed.map((x) => x.id)).toEqual(['1']);
  });

  it('空行与首尾空白不会产生空块', () => {
    expect(textToBlocks('\n\n甲\n\n\n\n乙  \n\n', [], ENTS).map((x) => x.text)).toEqual(['甲', '乙']);
  });

  it('剧本块的文字原样往返,不被当成普通段落改写语义', () => {
    const prev = [
      b({ id: 'c1', type: 'condition', condition: 'trust > 5', text: '' }),
      b({ id: 'i1', type: 'instruction', instruction: 'trust += 1', text: '' }),
    ];
    const round = textToBlocks(blocksToText(prev, ENTS), prev, ENTS);
    expect(round[0].type).toBe('condition');
    expect(round[0].condition).toBe('trust > 5');
    expect(round[1].instruction).toBe('trust += 1');
  });

  it('选项块渲染出 ▸ 选项行,往返保住选项 id 与 unitId', () => {
    const prev = [
      b({
        id: 'q1', type: 'choice', text: '如何回复?', unitId: 'u1',
        choices: [{ id: 'ch1', label: '回敬一句' }, { id: 'ch2', label: '装没看见' }],
      }),
    ];
    const text = blocksToText(prev, ENTS);
    expect(text).toBe('如何回复?\n▸ 回敬一句\n▸ 装没看见');
    const round = textToBlocks(text, prev, ENTS);
    expect(round[0].id).toBe('q1');
    expect(round[0].unitId).toBe('u1');
    expect(round[0].choices?.map((c) => [c.id, c.label])).toEqual([['ch1', '回敬一句'], ['ch2', '装没看见']]);
  });

  it('无提示语的选项块往返不吃掉第一个选项', () => {
    const prev = [
      b({
        id: 'q1', type: 'choice', text: '', unitId: 'u1',
        choices: [{ id: 'ch1', label: '去' }, { id: 'ch2', label: '不去' }],
      }),
    ];
    const text = blocksToText(prev, ENTS);
    expect(text).toBe('▸ 去\n▸ 不去');
    const round = textToBlocks(text, prev, ENTS);
    expect(round[0].id).toBe('q1');
    expect(round[0].unitId).toBe('u1');
    expect(round[0].text).toBe('');
    expect(round[0].choices?.map((c) => [c.id, c.label])).toEqual([['ch1', '去'], ['ch2', '不去']]);
  });

  it('无提示语且只有一个选项的选项块往返不降级成段落', () => {
    const prev = [
      b({ id: 'q1', type: 'choice', text: '', choices: [{ id: 'ch1', label: '唯一选项' }] }),
    ];
    const round = textToBlocks(blocksToText(prev, ENTS), prev, ENTS);
    expect(round[0].type).toBe('choice');
    expect(round[0].text).toBe('');
    expect(round[0].choices?.map((c) => [c.id, c.label])).toEqual([['ch1', '唯一选项']]);
  });

  it('纯文本新写无提示语选项块:全 ▸ 行', () => {
    const out = textToBlocks('▸ 去\n▸ 不去', [], ENTS);
    expect(out[0].type).toBe('choice');
    expect(out[0].text).toBe('');
    expect(out[0].choices?.map((c) => c.label)).toEqual(['去', '不去']);
  });

  it('选项行可增删:删一行丢对应选项,加一行建新选项', () => {
    const prev = [
      b({
        id: 'q1', type: 'choice', text: '如何回复?',
        choices: [{ id: 'ch1', label: '回敬一句' }, { id: 'ch2', label: '装没看见' }],
      }),
    ];
    const edited = textToBlocks('如何回复?\n▸ 回敬一句\n▸ 只发一个问号', prev, ENTS);
    expect(edited[0].choices?.map((c) => [c.id, c.label])).toEqual([['ch1', '回敬一句'], [expect.any(String), '只发一个问号']]);
  });

  it('删掉全部 ▸ 行只改提示语,选项静默保留不丢', () => {
    const prev = [
      b({
        id: 'q1', type: 'choice', text: '如何回复?',
        choices: [{ id: 'ch1', label: '回敬一句' }],
      }),
    ];
    const edited = textToBlocks('怎么回?', prev, ENTS);
    expect(edited[0].type).toBe('choice');
    expect(edited[0].text).toBe('怎么回?');
    expect(edited[0].choices).toEqual([{ id: 'ch1', label: '回敬一句' }]);
  });

  it('纯文本新写选项块:首行提示语 + ▸ 行', () => {
    const out = textToBlocks('去还是不去?\n▸ 去\n▸ 不去', [], ENTS);
    expect(out[0].type).toBe('choice');
    expect(out[0].text).toBe('去还是不去?');
    expect(out[0].choices?.map((c) => c.label)).toEqual(['去', '不去']);
  });
});
