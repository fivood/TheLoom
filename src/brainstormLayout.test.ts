import { describe, expect, it } from 'vitest';
import type { BrainNote } from './types';
import {
  NOTE_COLUMNS, NOTE_COL_WIDTH, NOTE_ORIGIN, NOTE_ROW_HEIGHT, RING_STEP,
  mindmapLayout, nextNotePosition,
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

  it('从视口左上角起扫,不再把新便签丢到屏幕外', () => {
    // 便签都在下方(用户视口也在那里),而画布左上角那几格是空的
    const far = [note(80, 1100), note(310, 1240), note(600, 1380)];
    const view = { x: 60, y: 1000 };
    const pos = nextNotePosition(far, view);
    expect(pos.y).toBeGreaterThanOrEqual(view.y);
    for (const n of far) expect(overlaps(pos, n.position)).toBe(false);
    // 不传视口才回落到画布原点(旧行为)
    expect(nextNotePosition(far)).toEqual(NOTE_ORIGIN);
  });
});

describe('放射整理', () => {
  const link = (source: string, target: string) => ({ source, target });
  const n = (id: string) => ({ id, position: { x: 0, y: 0 } });

  it('中心留在原点,直接相连的落在第一圈上,同圈彼此不重叠', () => {
    const notes = ['root', 'a', 'b', 'c'].map(n);
    const pos = mindmapLayout(notes, [link('root', 'a'), link('root', 'b'), link('c', 'root')], 'root');
    const root = pos.get('root')!;
    const ring = ['a', 'b', 'c'].map((id) => pos.get(id)!);
    for (const p of ring) {
      expect(Math.hypot((p.x - root.x) / 1.4, p.y - root.y)).toBeCloseTo(RING_STEP, 0);
    }
    for (let i = 0; i < ring.length; i++) {
      for (let j = i + 1; j < ring.length; j++) expect(overlaps(ring[i], ring[j])).toBe(false);
    }
  });

  it('层级越深半径越大,散点不进圈而是排到下方网格', () => {
    const notes = ['root', 'a', 'deep', 'lonely'].map(n);
    const pos = mindmapLayout(notes, [link('root', 'a'), link('a', 'deep')], 'root');
    const root = pos.get('root')!;
    const d = (id: string) => Math.hypot((pos.get(id)!.x - root.x) / 1.4, pos.get(id)!.y - root.y);
    expect(d('deep')).toBeGreaterThan(d('a'));
    expect(pos.get('lonely')).toEqual({ x: NOTE_ORIGIN.x, y: expect.any(Number) });
    expect(pos.get('lonely')!.y).toBeGreaterThan(root.y + RING_STEP * 2);
  });

  it('不指定中心时取连线最多的那张', () => {
    const notes = ['x', 'hub', 'y', 'z'].map(n);
    const pos = mindmapLayout(notes, [link('hub', 'x'), link('hub', 'y'), link('hub', 'z')]);
    const others = ['x', 'y', 'z'].map((id) => pos.get(id)!);
    const hub = pos.get('hub')!;
    for (const p of others) expect(Math.hypot(p.x - hub.x, p.y - hub.y)).toBeGreaterThan(0);
    // hub 在中心 = 到三张卡的距离相等
    const ds = others.map((p) => Math.hypot((p.x - hub.x) / 1.4, p.y - hub.y));
    expect(Math.max(...ds) - Math.min(...ds)).toBeLessThan(1);
  });
});
