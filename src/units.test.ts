import { describe, expect, it } from 'vitest';
import { sampleProject } from './sample';
import type { Document, Flow, Project } from './types';
import { normalizeProject, syncNarrativeUnits, uid, walkFlowNodes } from './util';
import { documentToFlow, flowToDocument } from './modules/document/convert';
import { documentToMd, mdToDocument } from './storage';

function fixture(): { project: Project; doc: Document; flow: Flow } {
  const project = sampleProject();
  const doc: Document = {
    id: 'doc1',
    name: '测试文档',
    category: '未分类',
    blocks: [
      { id: 'b-head', type: 'heading', text: '雨夜酒馆' },
      { id: 'b-dlg', type: 'dialogue', text: '你来了。', speakerId: project.entities[0]?.id },
      { id: 'b-act', type: 'action', text: '门被推开。' },
      { id: 'b-cond', type: 'condition', text: '', condition: 'trust > 5' },
      { id: 'b-note', type: 'note', text: '写作备忘,不进流程' },
      { id: 'b-list', type: 'list', text: '', items: ['甲', '乙'], ordered: false },
    ],
    notes: '',
    createdAt: 1,
    updatedAt: 1,
  };
  const flow: Flow = {
    id: 'flow1',
    name: '测试流程',
    nodes: [
      {
        id: 'n-frag',
        type: 'fragment',
        position: { x: 0, y: 0 },
        data: {
          title: '第一幕',
          text: '',
          sub: {
            nodes: [{ id: 'n-sub-dlg', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '', text: '子流程台词' } }],
            edges: [],
          },
        },
      },
      { id: 'n-note', type: 'note', position: { x: 0, y: 0 }, data: { title: '', text: '画布注释' } },
    ],
    edges: [],
  };
  project.documents.push(doc);
  project.flows.push(flow);
  return { project, doc, flow };
}

describe('叙事单元迁移(normalizeProject)', () => {
  it('旧项目所有剧本块与叙事节点获得单元,写作块与注释节点不建单元', () => {
    const { project, doc, flow } = fixture();
    normalizeProject(project);

    expect(doc.blocks[0].unitId).toBeTruthy();
    expect(doc.blocks[1].unitId).toBeTruthy();
    expect(doc.blocks[2].unitId).toBeTruthy();
    expect(doc.blocks[3].unitId).toBeTruthy();
    expect(doc.blocks[4].unitId).toBeUndefined();
    expect(doc.blocks[5].unitId).toBeUndefined();

    expect(flow.nodes[0].data.unitId).toBeTruthy();
    expect(flow.nodes[0].data.sub!.nodes[0].data.unitId).toBeTruthy();
    expect(flow.nodes[1].data.unitId).toBeUndefined();

    const units = project.units!;
    const dlgUnit = units.find((u) => u.id === doc.blocks[1].unitId)!;
    expect(dlgUnit.kind).toBe('line');
    expect(dlgUnit.text).toBe('你来了。');
    expect(dlgUnit.speakerId).toBe(project.entities[0]?.id);
    const headUnit = units.find((u) => u.id === doc.blocks[0].unitId)!;
    expect(headUnit.kind).toBe('scene');
    expect(headUnit.title).toBe('雨夜酒馆');
    const condUnit = units.find((u) => u.id === doc.blocks[3].unitId)!;
    expect(condUnit.text).toBe('trust > 5');
  });

  it('迁移幂等:二次 normalize 不新建单元、内容不变', () => {
    const { project } = fixture();
    normalizeProject(project);
    const count = project.units!.length;
    const snapshot = JSON.stringify(project.units);
    normalizeProject(project);
    expect(project.units!.length).toBe(count);
    expect(JSON.stringify(project.units)).toBe(snapshot);
  });

  it('unitId 指向丢失的单元时按原 id 重建,引用不断裂', () => {
    const { project, doc } = fixture();
    normalizeProject(project);
    const id = doc.blocks[1].unitId!;
    project.units = project.units!.filter((u) => u.id !== id);
    normalizeProject(project);
    const rebuilt = project.units!.find((u) => u.id === id);
    expect(rebuilt).toBeTruthy();
    expect(rebuilt!.text).toBe('你来了。');
  });

  it('无人引用的单元被回收', () => {
    const { project, doc, flow } = fixture();
    normalizeProject(project);
    const before = project.units!.length;
    doc.blocks = [{ id: 'only', type: 'note', text: '' }];
    flow.nodes = [];
    normalizeProject(project);
    expect(project.units!.length).toBeLessThan(before);
    expect(project.units!.some((u) => u.text === '你来了。')).toBe(false);
  });
});

describe('文档转流程共享单元', () => {
  it('documentToFlow 生成的节点引用文档块的同一单元', () => {
    const { project, doc } = fixture();
    normalizeProject(project);
    const flow = documentToFlow(doc);
    expect(flow.nodes[0].data.unitId).toBe(doc.blocks[0].unitId);
    expect(flow.nodes[1].data.unitId).toBe(doc.blocks[1].unitId);
    expect(flow.nodes[3].data.unitId).toBe(doc.blocks[3].unitId);
  });

  it('普通正文默认不进流程,显式节拍正文才生成节点并记录文档关联', () => {
    const doc: Document = {
      id: 'doc-prose', name: '长篇场景', category: '正文', notes: '', createdAt: 1, updatedAt: 1,
      blocks: [
        { id: 'p1', type: 'paragraph', text: '普通正文', flowRole: 'none' },
        { id: 'p2', type: 'paragraph', text: '转折节拍', flowRole: 'beat', unitId: 'unit-p2' },
        { id: 'd1', type: 'dialogue', text: '继续走。', unitId: 'unit-d1' },
      ],
    };
    const flow = documentToFlow(doc);
    expect(flow.documentId).toBe(doc.id);
    expect(flow.nodes).toHaveLength(2);
    expect(flow.nodes.map((node) => node.data.unitId)).toEqual(['unit-p2', 'unit-d1']);
  });
});

describe('叙事单元双向同步(commit 语义)', () => {
  function linkedFixture() {
    const { project, doc } = fixture();
    normalizeProject(project);
    const converted = documentToFlow(doc);
    project.flows.push(converted);
    syncNarrativeUnits(project);
    return { project, doc, converted };
  }

  it('修改文档块文本后,共享单元与流程节点镜像同步', () => {
    const { project, doc, converted } = linkedFixture();
    const prev = structuredClone(project);
    doc.blocks[1].text = '你终于来了。';
    syncNarrativeUnits(project, prev);

    const unit = project.units!.find((u) => u.id === doc.blocks[1].unitId)!;
    expect(unit.text).toBe('你终于来了。');
    const node = converted.nodes.find((n) => n.data.unitId === doc.blocks[1].unitId)!;
    expect(node.data.text).toBe('你终于来了。');
  });

  it('修改流程节点文本后,文档块镜像同步', () => {
    const { project, doc, converted } = linkedFixture();
    const prev = structuredClone(project);
    const node = converted.nodes.find((n) => n.data.unitId === doc.blocks[1].unitId)!;
    node.data.text = '节点里改的台词';
    syncNarrativeUnits(project, prev);
    expect(doc.blocks[1].text).toBe('节点里改的台词');
  });

  it('说话人变更双向同步', () => {
    const { project, doc, converted } = linkedFixture();
    const prev = structuredClone(project);
    const node = converted.nodes.find((n) => n.data.unitId === doc.blocks[1].unitId)!;
    node.data.speakerId = undefined;
    syncNarrativeUnits(project, prev);
    expect(doc.blocks[1].speakerId).toBeUndefined();
  });

  it('条件块与条件节点共享表达式', () => {
    const { project, doc, converted } = linkedFixture();
    const prev = structuredClone(project);
    doc.blocks[3].condition = 'trust > 9';
    syncNarrativeUnits(project, prev);
    const node = converted.nodes.find((n) => n.data.unitId === doc.blocks[3].unitId)!;
    expect(node.data.text).toBe('trust > 9');
  });

  it('无 prev 时(外部 md 编辑后加载)文档内容优先写入单元', () => {
    const { project, doc, converted } = linkedFixture();
    doc.blocks[1].text = 'Obsidian 里改的';
    syncNarrativeUnits(project);
    const node = converted.nodes.find((n) => n.data.unitId === doc.blocks[1].unitId)!;
    expect(node.data.text).toBe('Obsidian 里改的');
    expect(project.units!.find((u) => u.id === doc.blocks[1].unitId)!.text).toBe('Obsidian 里改的');
  });
});

describe('R3 选项结构双向同步', () => {
  function choiceFixture() {
    const project = sampleProject();
    const doc: Document = {
      id: 'doc-c', name: '选项文档', category: '未分类', notes: '', createdAt: 1, updatedAt: 1,
      blocks: [
        { id: 'b-choice', type: 'choice', text: '怎么办?', choices: [{ id: 'c-a', label: '追上去' }, { id: 'c-b', label: '留下' }] },
        { id: 'b-after', type: 'action', text: '雨更大了。' },
      ],
    };
    project.documents.push(doc);
    normalizeProject(project);
    const flow = documentToFlow(doc);
    project.flows.push(flow);
    syncNarrativeUnits(project);
    const hub = flow.nodes.find((n) => n.type === 'hub')!;
    const after = flow.nodes.find((n) => n.type === 'dialogue')!;
    return { project, doc, flow, hub, after };
  }

  it('给未绑定出边写标签 → 升级为文档选项', () => {
    const { project, doc, flow, hub, after } = choiceFixture();
    const prev = structuredClone(project);
    const edge = flow.edges.find((e) => e.source === hub.id)!;
    edge.label = '第三条路';
    syncNarrativeUnits(project, prev);
    expect(edge.choiceId).toBeTruthy();
    expect(doc.blocks[0].choices!.map((c) => c.label)).toEqual(['追上去', '留下', '第三条路']);
    expect(after).toBeTruthy();
  });

  it('绑定边与选项标签双向同步', () => {
    const { project, doc, flow, hub, after } = choiceFixture();
    flow.edges.push({ id: uid(), source: hub.id, target: after.id, label: '追上去', choiceId: 'c-a' });
    syncNarrativeUnits(project);

    // 文档侧改标签 → 边跟随
    let prev = structuredClone(project);
    doc.blocks[0].choices![0].label = '拔腿就追';
    syncNarrativeUnits(project, prev);
    const edge = flow.edges.find((e) => e.choiceId === 'c-a')!;
    expect(edge.label).toBe('拔腿就追');

    // 边侧改标签 → 文档跟随
    prev = structuredClone(project);
    edge.label = '悄悄跟上';
    syncNarrativeUnits(project, prev);
    expect(doc.blocks[0].choices![0].label).toBe('悄悄跟上');
  });

  it('文档删除选项 → 对应边解绑并清标签,不复活', () => {
    const { project, doc, flow, hub, after } = choiceFixture();
    flow.edges.push({ id: 'e-bound', source: hub.id, target: after.id, label: '追上去', choiceId: 'c-a' });
    syncNarrativeUnits(project);

    const prev = structuredClone(project);
    doc.blocks[0].choices = doc.blocks[0].choices!.filter((c) => c.id !== 'c-a');
    syncNarrativeUnits(project, prev);
    const edge = flow.edges.find((e) => e.id === 'e-bound')!;
    expect(edge.choiceId).toBeUndefined();
    expect(edge.label).toBeUndefined();
    expect(doc.blocks[0].choices!.map((c) => c.id)).toEqual(['c-b']);

    // 再同步一轮不会把已删除的选项复活
    const prev2 = structuredClone(project);
    syncNarrativeUnits(project, prev2);
    expect(doc.blocks[0].choices!.map((c) => c.id)).toEqual(['c-b']);
  });
});

describe('R3 流程反向剧本视图', () => {
  it('flowToDocument 生成共享单元的文档,按边序线性化', () => {
    const { project } = (() => {
      const project = sampleProject();
      normalizeProject(project);
      return { project };
    })();
    const flow: Flow = {
      id: 'f-view', name: '夜谈',
      nodes: [
        { id: 'n1', type: 'fragment', position: { x: 0, y: 0 }, data: { title: '开场', text: '' } },
        { id: 'n2', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '', text: '你来了。', speakerId: project.entities[0]?.id } },
        { id: 'n3', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '', text: '门开了。' } },
        { id: 'n4', type: 'condition', position: { x: 0, y: 0 }, data: { title: '', text: 'trust > 5' } },
        { id: 'n5', type: 'note', position: { x: 0, y: 0 }, data: { title: '', text: '画布备注' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n3', target: 'n4' },
      ],
    };
    project.flows.push(flow);
    syncNarrativeUnits(project);

    const doc = flowToDocument(flow, project.units ?? []);
    expect(doc.blocks.map((b) => b.type)).toEqual(['heading', 'dialogue', 'action', 'condition']);
    expect(doc.blocks.map((b) => b.unitId)).toEqual([
      flow.nodes[0].data.unitId, flow.nodes[1].data.unitId, flow.nodes[2].data.unitId, flow.nodes[3].data.unitId,
    ]);

    // 挂进项目后:文档侧编辑 → 节点同步
    project.documents.push(doc);
    syncNarrativeUnits(project);
    const prev = structuredClone(project);
    doc.blocks[1].text = '你终于来了。';
    syncNarrativeUnits(project, prev);
    expect(flow.nodes[1].data.text).toBe('你终于来了。');
  });
});

describe('R1 unitId 存储往返', () => {
  it('documentToMd / mdToDocument 无损往返 unitId', () => {
    const { project, doc } = fixture();
    normalizeProject(project);
    const md = documentToMd(doc, project.entities);
    const back = mdToDocument('测试文档.md', md, 0);
    expect(back.blocks.map((b) => b.unitId)).toEqual(doc.blocks.map((b) => b.unitId));
  });
});

describe('walkFlowNodes', () => {
  it('遍历包含子流程在内的所有节点', () => {
    const { project, flow } = fixture();
    normalizeProject(project);
    const ids: string[] = [];
    walkFlowNodes(flow.nodes, (n) => ids.push(n.id));
    expect(ids).toContain('n-sub-dlg');
  });
});
