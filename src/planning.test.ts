import { describe, expect, it } from 'vitest';
import type { DocBlock, Document, Entity, Foreshadow, Project } from './types';
import { normalizeProject } from './util';
import { appearanceMatrix, foreshadowStatus, groupDocsByChapter, pacingPoints } from './planning';

function baseProject(): Project {
  return normalizeProject({ version: 1, name: 't', flows: [], updatedAt: 0 } as unknown as Project);
}

function makeDoc(id: string, name: string, extra?: Partial<Document>, blocks: Partial<DocBlock>[] = []): Document {
  return {
    id, name, category: '正文', notes: '',
    blocks: blocks.map((b, i) => ({ id: `${id}-b${i}`, type: 'action', text: '', ...b } as DocBlock)),
    createdAt: 1, updatedAt: 1,
    ...extra,
  };
}

function makeEntity(id: string, name: string): Entity {
  return {
    id, kind: 'character', name, color: '#000', emoji: '', summary: '', fields: [], notes: '', createdAt: 1,
  };
}

function planningProject(): Project {
  const p = baseProject();
  p.folders = [
    { id: 'v1', name: '第一卷', module: 'document' },
    { id: 'c1', name: '第一章', module: 'document', parentId: 'v1', order: 0 },
    { id: 'c2', name: '第二章', module: 'document', parentId: 'v1', order: 1 },
  ];
  p.entities = [makeEntity('alice', '爱丽丝'), makeEntity('bob', '柏博')];
  p.documents = [
    makeDoc('s1', '场景一', { folderId: 'c1', order: 0, povId: 'alice', status: 'draft', tension: 2 }, [
      { type: 'dialogue', speakerId: 'alice', text: '你好。' },
      { type: 'dialogue', speakerId: 'alice', text: '再见。' },
      { type: 'action', text: '柏博沉默地看着窗外。' },
    ]),
    makeDoc('s2', '场景二', { folderId: 'c1', order: 1, tension: 5 }, [
      { type: 'action', text: '空场景。' },
    ]),
    makeDoc('s3', '场景三', { folderId: 'c2' }, [
      { type: 'dialogue', speakerId: 'bob', text: '轮到我了。' },
    ]),
    makeDoc('s0', '未分组场景', {}),
  ];
  return normalizeProject(p);
}

describe('R4 章节分组', () => {
  it('按树序分组:子文件夹递归优先,未分组殿后', () => {
    const groups = groupDocsByChapter(planningProject().documents, planningProject().folders);
    expect(groups.map((g) => g.label)).toEqual(['第一卷 · 第一章', '第一卷 · 第二章', '未分组']);
    expect(groups[0].docs.map((d) => d.id)).toEqual(['s1', 's2']);
    expect(groups[1].docs.map((d) => d.id)).toEqual(['s3']);
    expect(groups[2].docs.map((d) => d.id)).toEqual(['s0']);
  });

  it('卷章角色存在时，小节场景归入最近章节', () => {
    const p = planningProject();
    p.folders[0].documentRole = 'volume';
    p.folders[1].documentRole = 'chapter';
    p.folders[2].documentRole = 'chapter';
    p.folders.push({ id: 'sec', name: '小节', module: 'document', parentId: 'c1', documentRole: 'section', order: 0 });
    p.documents[0].folderId = 'sec';
    const groups = groupDocsByChapter(p.documents, p.folders);
    expect(groups[0].folderId).toBe('c1');
    expect(groups[0].docs.map((d) => d.id)).toEqual(['s1', 's2']);
  });
});

describe('R4 登场统计', () => {
  it('统计说话 / POV / 提及,并按总场景数排序', () => {
    const m = appearanceMatrix(planningProject());
    expect(m.chapters).toHaveLength(3);
    const alice = m.rows.find((r) => r.entity.id === 'alice')!;
    const bob = m.rows.find((r) => r.entity.id === 'bob')!;
    // 爱丽丝:第一章 s1 说话 2 句 + POV
    expect(alice.cells[0]).toMatchObject({ scenes: 1, lines: 2, pov: 1 });
    expect(alice.cells[1].scenes).toBe(0);
    // 柏博:第一章 s1 被提及,第二章 s3 说话
    expect(bob.cells[0]).toMatchObject({ scenes: 1, lines: 0, mentions: 1 });
    expect(bob.cells[1]).toMatchObject({ scenes: 1, lines: 1 });
    expect(bob.totalScenes).toBe(2);
    // 总场景多的排前面
    expect(m.rows[0].entity.id).toBe('bob');
  });

  it('弧线阶段按关联场景落入对应章节', () => {
    const p = planningProject();
    p.arcs = [
      { id: 'a1', entityId: 'alice', title: '启程', note: '', docId: 's1' },
      { id: 'a2', entityId: 'alice', title: '误入', note: '', docId: 's3' },
      { id: 'a3', entityId: 'bob', title: '无关联', note: '' },
    ];
    const m = appearanceMatrix(p);
    const alice = m.rows.find((r) => r.entity.id === 'alice')!;
    expect(alice.cells[0].stages.map((s) => s.title)).toEqual(['启程']);
    expect(alice.cells[1].stages.map((s) => s.title)).toEqual(['误入']);
  });
});

describe('R4 节奏图数据', () => {
  it('树序展开、章节起点标记、字数与张力', () => {
    const pts = pacingPoints(planningProject());
    expect(pts.map((x) => x.doc.id)).toEqual(['s1', 's2', 's3', 's0']);
    expect(pts.map((x) => x.chapterStart)).toEqual([true, false, true, true]);
    expect(pts[0].words).toBe('你好。'.length + '再见。'.length + '柏博沉默地看着窗外。'.length);
    expect(pts[0].tension).toBe(2);
    expect(pts[2].tension).toBeUndefined();
  });
});

describe('R4 伏笔状态', () => {
  const mk = (extra: Partial<Foreshadow>): Foreshadow =>
    ({ id: 'f', title: '刀', note: '', plants: [], payoffs: [], createdAt: 1, ...extra });

  it('由埋设 / 回收推导,弃用优先', () => {
    expect(foreshadowStatus(mk({}))).toBe('idea');
    expect(foreshadowStatus(mk({ plants: [{ id: 'r1', docId: 's1' }] }))).toBe('planted');
    expect(foreshadowStatus(mk({
      plants: [{ id: 'r1', docId: 's1' }],
      payoffs: [{ id: 'r2', docId: 's3' }],
    }))).toBe('resolved');
    expect(foreshadowStatus(mk({ plants: [{ id: 'r1', docId: 's1' }], abandoned: true }))).toBe('abandoned');
  });
});

describe('R4 normalizeProject 清理', () => {
  it('剔除指向缺失实体 / 文档的关系、弧线与伏笔引用,校验张力', () => {
    const p = planningProject();
    p.relations = [
      { id: 'r1', fromId: 'alice', toId: 'bob', label: '同事' },
      { id: 'r2', fromId: 'alice', toId: 'ghost', label: '指向缺失' },
      { id: 'r3', fromId: 'alice', toId: 'alice', label: '自环' },
    ];
    p.arcs = [
      { id: 'a1', entityId: 'alice', title: '有效', note: '', docId: 's1' },
      { id: 'a2', entityId: 'alice', title: '场景缺失', note: '', docId: 'gone' },
      { id: 'a3', entityId: 'ghost', title: '实体缺失', note: '' },
    ];
    p.foreshadows = [{
      id: 'f1', title: '刀', note: '', createdAt: 1,
      plants: [{ id: 'p1', docId: 's1' }, { id: 'p2', docId: 'gone' }],
      payoffs: [{ id: 'p3', docId: 'gone' }],
    }];
    p.relationLayout = { alice: { x: 1, y: 2 }, ghost: { x: 0, y: 0 }, bob: { x: NaN, y: 0 } };
    p.documents[1].tension = 9;
    (p.documents[2] as { tension?: unknown }).tension = 'high';

    normalizeProject(p);

    expect(p.relations.map((r) => r.id)).toEqual(['r1']);
    expect(p.arcs.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(p.arcs[1].docId).toBeUndefined();
    expect(p.foreshadows[0].plants.map((r) => r.id)).toEqual(['p1']);
    expect(p.foreshadows[0].payoffs).toEqual([]);
    expect(Object.keys(p.relationLayout!)).toEqual(['alice']);
    expect(p.documents[1].tension).toBeUndefined();
    expect(p.documents[2].tension).toBeUndefined();
    expect(p.documents[0].tension).toBe(2);
  });
});
