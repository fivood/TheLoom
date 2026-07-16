import { describe, expect, it } from 'vitest';
import { sampleProject } from './sample';
import type { Document, Flow, Project } from './types';
import { normalizeProject, syncNarrativeUnits, walkFlowNodes } from './util';
import { documentToFlow } from './modules/document/convert';
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
