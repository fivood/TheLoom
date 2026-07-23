import { describe, expect, it } from 'vitest';
import { sampleProject } from './sample';
import { normalizeProject } from './util';
import {
  countDocumentWriting, countWritingText, dailyStatValue, recentWritingSeries, recordWritingProgress,
  writingDateKey,
} from './writingProgress';

describe('writingProgress', () => {
  it('支持中文字符、含标点字符与英文单词三种口径', () => {
    const text = '雾，London fog! It’s cold.';
    expect(countWritingText(text, 'cjk')).toBe(1);
    expect(countWritingText(text, 'characters')).toBe(21);
    expect(countWritingText(text, 'englishWords')).toBe(4);
  });

  it('仅正文会排除标题、条件、指令、选项和注释', () => {
    const document = structuredClone(sampleProject().documents[0]);
    document.blocks = [
      { id: 'p', type: 'paragraph', text: '正文甲。' },
      { id: 'h', type: 'heading', text: '标题乙' },
      { id: 'n', type: 'note', text: '注释丙' },
      { id: 'c', type: 'condition', text: '', condition: 'flag == true' },
      { id: 'l', type: 'list', text: '', items: ['清单丁'] },
    ];
    expect(countDocumentWriting(document, 'cjk', true)).toBe(6);
    expect(countDocumentWriting(document, 'cjk')).toBeGreaterThan(6);
  });

  it('只累计同一批文档中的正向正文增量，删除与结构操作不计入', () => {
    const prev = structuredClone(sampleProject());
    const next = structuredClone(prev);
    next.documents[0].blocks[0].type = 'paragraph';
    prev.documents[0].blocks[0].type = 'paragraph';
    next.documents[0].blocks[0].text += '新增文字。';
    const stamp = new Date(2026, 6, 23, 14).getTime();
    recordWritingProgress(prev, next, stamp);
    const stat = next.writingProgress?.daily?.[0];
    expect(stat?.date).toBe('2026-07-23');
    expect(stat?.cjk).toBe(4);
    expect(stat?.bodyCjk).toBe(4);

    const deleted = structuredClone(next);
    deleted.documents[0].blocks[0].text = '';
    recordWritingProgress(next, deleted, stamp);
    expect(deleted.writingProgress?.daily?.[0].cjk).toBe(4);

    const split = structuredClone(prev);
    split.documents.push({ ...structuredClone(split.documents[0]), id: 'new-document' });
    recordWritingProgress(prev, split, stamp);
    expect(split.writingProgress).toBeUndefined();
  });

  it('生成包含空白日的最近七日序列并按当前口径取值', () => {
    const stamp = new Date(2026, 6, 23, 14).getTime();
    const series = recentWritingSeries({
      daily: [{
        date: '2026-07-21',
        cjk: 20,
        characters: 24,
        englishWords: 2,
        bodyCjk: 16,
        bodyCharacters: 19,
        bodyEnglishWords: 1,
      }],
    }, stamp);
    expect(series).toHaveLength(7);
    expect(series.map((item) => item.date)).toContain('2026-07-21');
    expect(dailyStatValue(series.find((item) => item.date === '2026-07-21'), 'characters', true)).toBe(19);
    expect(dailyStatValue(series[series.length - 1], 'characters', true)).toBe(0);
    expect(writingDateKey(stamp)).toBe('2026-07-23');
  });

  it('迁移时清理失效目标、非法口径与每日脏数据', () => {
    const project = structuredClone(sampleProject());
    project.writingProgress = {
      countMode: 'bad' as never,
      projectTarget: -1,
      folderTargets: { missing: 1000, [project.folders.find((folder) => folder.documentRole)?.id ?? 'none']: 1200.8 },
      daily: [
        {
          date: '2026-07-23',
          cjk: 12.8,
          characters: -1,
          englishWords: Number.NaN,
          bodyCjk: 4,
          bodyCharacters: 5,
          bodyEnglishWords: 2,
        },
        { date: 'bad', cjk: 1, characters: 1, englishWords: 1, bodyCjk: 1, bodyCharacters: 1, bodyEnglishWords: 1 },
      ],
    };
    normalizeProject(project);
    expect(project.writingProgress?.countMode).toBe('characters');
    expect(project.writingProgress?.projectTarget).toBeUndefined();
    expect(project.writingProgress?.folderTargets?.missing).toBeUndefined();
    expect(project.writingProgress?.daily).toHaveLength(1);
    expect(project.writingProgress?.daily?.[0].cjk).toBe(12);
    expect(project.writingProgress?.daily?.[0].characters).toBe(0);
  });
});
