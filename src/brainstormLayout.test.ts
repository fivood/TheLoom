import { describe, expect, it } from 'vitest';
import type { BrainNote } from './types';
import {
  NOTE_COLUMNS, NOTE_COL_WIDTH, NOTE_ORIGIN, NOTE_ROW_HEIGHT, nextNotePosition,
} from './brainstormLayout';

function note(x: number, y: number, id = `${x}-${y}`): BrainNote {
  return { id, text: '', color: '#fff', position: { x, y } };
}

/** 便签宽 210 高约 100,判定两张是否会在画布上叠住 */
function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 210 && Math.abs(a.y - b.y) < 100;
}

describe('便签自动摆放', () => {
  it('空板从原点开始', () => {
    expect(nextNotePosition([])).toEqual(NOTE_ORIGIN);
  });

  it('连续记 12 条互不重叠 —— 原来的随机定位在这里两两几乎全叠', () => {
    const notes: BrainNote[] = [];
    for (let i = 0; i < 12; i++) {
      const pos = nextNotePosition(notes);
      notes.push(note(pos.x, pos.y, `n${i}`));
    }
    let overlapping = 0;
    for (let i = 0; i < notes.length; i++) {
      for (let j = i + 1; j < notes.length; j++) {
        if (overlaps(notes[i].position, notes[j].position)) overlapping++;
      }
    }
    expect(overlapping).toBe(0);
  });

  it('排满一行后换行,不无限向右长', () => {
    const notes: BrainNote[] = [];
    for (let i = 0; i < NOTE_COLUMNS; i++) {
      const pos = nextNotePosition(notes);
      notes.push(note(pos.x, pos.y, `n${i}`));
    }
    expect(nextNotePosition(notes)).toEqual({
      x: NOTE_ORIGIN.x,
      y: NOTE_ORIGIN.y + NOTE_ROW_HEIGHT,
    });
  });

  it('不与不在格点上的历史便签重叠 —— 只按格记占用会算出 190px 的距离,而便签宽 210px', () => {
    const legacy = [note(120, 80), note(430, 40), note(430, 220), note(120, 260), note(740, 40), note(740, 200)];
    const next = nextNotePosition(legacy);
    for (const n of legacy) expect(overlaps(next, n.position)).toBe(false);
  });

  it('复用被拖走后留下的空位', () => {
    const notes = [
      note(NOTE_ORIGIN.x, NOTE_ORIGIN.y),
      note(NOTE_ORIGIN.x + NOTE_COL_WIDTH * 2, NOTE_ORIGIN.y),
    ];
    expect(nextNotePosition(notes)).toEqual({
      x: NOTE_ORIGIN.x + NOTE_COL_WIDTH,
      y: NOTE_ORIGIN.y,
    });
  });

  it('已有便签坐标不在格点上也能归位,不会重叠', () => {
    const notes = [note(NOTE_ORIGIN.x + 12, NOTE_ORIGIN.y - 9)];
    const next = nextNotePosition(notes);
    expect(overlaps(next, notes[0].position)).toBe(false);
  });

  it('坐标损坏的便签不影响摆放', () => {
    const broken = { id: 'x', text: '', color: '#fff', position: { x: NaN, y: 0 } } as BrainNote;
    expect(nextNotePosition([broken])).toEqual(NOTE_ORIGIN);
  });
});
