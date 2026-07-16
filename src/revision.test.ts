import { describe, expect, it } from 'vitest';
import type { DocBlock, Document, Entity, Project } from './types';
import { normalizeProject } from './util';
import { diffLines, diffStats, docLines, findDocMatches, replaceInDocs } from './revision';

const alice: Entity = {
  id: 'alice', kind: 'character', name: '爱丽丝', color: '#000', emoji: '', summary: '', fields: [], notes: '', createdAt: 1,
};

function makeDoc(id: string, blocks: Partial<DocBlock>[], extra?: Partial<Document>): Document {
  return {
    id, name: `文档${id}`, category: '正文', notes: '',
    blocks: blocks.map((b, i) => ({ id: `${id}-b${i}`, type: 'action', text: '', ...b } as DocBlock)),
    createdAt: 1, updatedAt: 1, ...extra,
  };
}

function baseProject(docs: Document[]): Project {
  const p = normalizeProject({ version: 1, name: 't', flows: [], updatedAt: 0 } as unknown as Project);
  p.entities = [alice];
  p.documents = docs;
  return p;
}

describe('R5 行渲染', () => {
  it('各类块渲染为行:对白带说话人、列表带序号、引用带前缀', () => {
    const doc = makeDoc('d1', [
      { type: 'heading', text: '开场' },
      { type: 'dialogue', speakerId: 'alice', text: '你好。\n再见。' },
      { type: 'list', items: ['一', '二'], ordered: true },
      { type: 'quote', text: '旧信' },
      { type: 'choice', text: '怎么办', choices: [{ id: 'c1', label: '逃' }] },
    ]);
    expect(docLines(doc.blocks, [alice])).toEqual([
      '【场景】开场',
      '爱丽丝:你好。',
      '再见。',
      '1. 一',
      '2. 二',
      '> 旧信',
      '怎么办',
      '○ 逃',
    ]);
  });
});

describe('R5 行级差异', () => {
  it('识别新增 / 删除 / 未变行', () => {
    const ops = diffLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
    expect(ops).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'same', text: 'c' },
      { type: 'same', text: 'd' },
      { type: 'add', text: 'e' },
    ]);
    expect(diffStats(ops)).toEqual({ added: 2, removed: 1 });
  });

  it('完全相同与完全不同', () => {
    expect(diffLines(['a'], ['a'])).toEqual([{ type: 'same', text: 'a' }]);
    expect(diffStats(diffLines(['a', 'b'], []))).toEqual({ added: 0, removed: 2 });
    expect(diffStats(diffLines([], ['a', 'b']))).toEqual({ added: 2, removed: 0 });
  });
});

describe('R5 全局查找替换', () => {
  it('跨字段查找:正文 / 列表项 / 选项 / 条件 / 指令', () => {
    const p = baseProject([
      makeDoc('d1', [
        { type: 'action', text: '车票在抽屉里。车票很旧。' },
        { type: 'list', items: ['买车票', '烧掉'] },
        { type: 'choice', text: '选', choices: [{ id: 'c1', label: '拿走车票' }] },
        { type: 'condition', condition: 'seen("车票")' },
      ]),
      makeDoc('d2', [{ type: 'dialogue', speakerId: 'alice', text: '没有车票。' }]),
    ]);
    const matches = findDocMatches(p, '车票', true);
    expect(matches).toHaveLength(5);
    expect(matches[0].count).toBe(2);
    expect(matches.map((m) => m.field)).toEqual(['text', 'item', 'choice', 'condition', 'text']);
  });

  it('替换全部命中并返回次数,touched 文档更新 updatedAt', () => {
    const p = baseProject([
      makeDoc('d1', [{ type: 'action', text: '车票在抽屉里。车票很旧。' }]),
    ]);
    const n = replaceInDocs(p, '车票', '船票', true);
    expect(n).toBe(2);
    expect(p.documents[0].blocks[0].text).toBe('船票在抽屉里。船票很旧。');
    expect(p.documents[0].updatedAt).toBeGreaterThan(1);
  });

  it('按选中的 key 精确替换;大小写不敏感模式', () => {
    const p = baseProject([
      makeDoc('d1', [
        { type: 'action', text: 'Ticket here' },
        { type: 'action', text: 'ticket there' },
      ]),
    ]);
    const matches = findDocMatches(p, 'ticket', false);
    expect(matches).toHaveLength(2);
    const n = replaceInDocs(p, 'ticket', '票', false, new Set([matches[1].key]));
    expect(n).toBe(1);
    expect(p.documents[0].blocks[0].text).toBe('Ticket here');
    expect(p.documents[0].blocks[1].text).toBe('票 there');
  });

  it('替换文本包含 $ 时按字面写入', () => {
    const p = baseProject([makeDoc('d1', [{ type: 'action', text: 'ab' }])]);
    replaceInDocs(p, 'a', '$&x', true);
    expect(p.documents[0].blocks[0].text).toBe('$&xb');
  });
});

describe('R5 normalizeProject 清理', () => {
  it('批注 / 快照指向缺失文档剔除;块缺失退化为整篇;revision 校验', () => {
    const p = baseProject([makeDoc('d1', [{ type: 'action', text: 'x' }])]);
    p.annotations = [
      { id: 'a1', docId: 'd1', blockId: 'd1-b0', text: '好', createdAt: 1 },
      { id: 'a2', docId: 'd1', blockId: 'gone', text: '块没了', createdAt: 1 },
      { id: 'a3', docId: 'ghost', text: '文档没了', createdAt: 1 },
    ];
    p.docSnapshots = [
      { id: 's1', docId: 'd1', label: '一稿', blocks: [], createdAt: 1 },
      { id: 's2', docId: 'ghost', label: '孤儿', blocks: [], createdAt: 1 },
    ];
    p.documents[0].revision = 2.6;
    normalizeProject(p);
    expect(p.annotations.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(p.annotations[0].blockId).toBe('d1-b0');
    expect(p.annotations[1].blockId).toBeUndefined();
    expect(p.docSnapshots.map((s) => s.id)).toEqual(['s1']);
    expect(p.documents[0].revision).toBe(3);

    (p.documents[0] as { revision?: unknown }).revision = 0;
    normalizeProject(p);
    expect(p.documents[0].revision).toBeUndefined();
  });
});
