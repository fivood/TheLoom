import { describe, expect, it } from 'vitest';
import { sampleProject } from './sample';
import { proofreadProject } from './proofreading';

describe('proofreadProject', () => {
  it('检查重复词、连续标点和全半角问题并定位到块', () => {
    const project = sampleProject();
    const document = project.documents[0];
    document.blocks = [{
      id: 'proof-block',
      type: 'paragraph',
      text: '天气天气真好！！Ａ座在这里,请确认。',
    }];
    const issues = proofreadProject(project);
    expect(issues.some((issue) => issue.category === 'duplicate' && issue.blockId === 'proof-block')).toBe(true);
    expect(issues.some((issue) => issue.category === 'punctuation' && issue.blockId === 'proof-block')).toBe(true);
    expect(issues.filter((issue) => issue.category === 'width' && issue.blockId === 'proof-block').length).toBeGreaterThanOrEqual(2);
  });

  it('检查同场景称谓混用、英文专名大小写与跨实体别名冲突', () => {
    const project = sampleProject();
    project.entities = [
      {
        id: 'lin', kind: 'character', name: '林默', aliases: ['阿默'], color: '#000', emoji: '',
        summary: '', fields: [], notes: '', createdAt: 1,
      },
      {
        id: 'other', kind: 'character', name: '林明', aliases: ['阿默'], color: '#000', emoji: '',
        summary: '', fields: [], notes: '', createdAt: 1,
      },
      {
        id: 'london', kind: 'location', name: 'London', color: '#000', emoji: '',
        summary: '', fields: [], notes: '', createdAt: 1,
      },
    ];
    project.documents[0].blocks = [{
      id: 'name-block',
      type: 'action',
      text: '林默走进 London。阿默说，london 的雨太大。',
    }];
    const issues = proofreadProject(project).filter((issue) => issue.category === 'name');
    expect(issues.some((issue) => issue.message.includes('同一场景混用称谓'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('大小写不一致'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('同时属于'))).toBe(true);
  });

  it('对白中的昵称不参与叙述称谓混用检查', () => {
    const project = sampleProject();
    project.entities = [{
      id: 'lin', kind: 'character', name: '林默', aliases: ['阿默'], color: '#000', emoji: '',
      summary: '', fields: [], notes: '', createdAt: 1,
    }];
    project.documents[0].blocks = [
      { id: 'a', type: 'action', text: '林默走进房间。' },
      { id: 'd', type: 'dialogue', speakerId: 'lin', text: '大家都叫我阿默。' },
    ];
    expect(proofreadProject(project).some((issue) => issue.message.includes('混用称谓'))).toBe(false);
  });
});

describe('全半角:实测里漏掉的那几个', () => {
  function scan(text: string) {
    const project = sampleProject();
    project.documents[0].blocks = [{ id: 'b', type: 'paragraph', text }];
    return proofreadProject(project).filter((i) => i.category === 'width' && i.blockId === 'b');
  }

  it('对白的直引号成对报出,并按奇偶给出上下引号', () => {
    // 收尾引号前面是「？」不是汉字 —— 旧的「前后有汉字」判定会整条漏掉
    const issues = scan('"人是几点发现的？"');
    expect(issues.length).toBe(2);
    expect(issues[0].suggestion).toContain('“');
    expect(issues[1].suggestion).toContain('”');
  });

  it('纯英文块里的直引号不报', () => {
    expect(scan('He said "yes" and left.').length).toBe(0);
  });

  it('汉字之间的半角句点与括号要报', () => {
    expect(scan('他走了.然后呢').some((i) => i.suggestion.includes('。'))).toBe(true);
    expect(scan('沈砚秋(华探)到场').some((i) => i.suggestion.includes('（'))).toBe(true);
  });

  it('小数点和英文括号不误报', () => {
    expect(scan('售价 3.14 元的相纸').every((i) => !i.suggestion.includes('。'))).toBe(true);
    expect(scan('用了 Kodak (1934) 的胶卷').every((i) => !i.suggestion.includes('（'))).toBe(true);
  });

  it('省略号只交给「连续标点」,不逐点报半角句点', () => {
    expect(scan('他说...然后就走了').every((i) => !i.suggestion.includes('。'))).toBe(true);
  });
});
