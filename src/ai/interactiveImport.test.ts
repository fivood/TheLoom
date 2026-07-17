import { describe, expect, it } from 'vitest';
import { sampleProject } from '../sample';
import { normalizeProject } from '../util';
import {
  buildInteractiveImportPreview, buildInteractiveGeneratePrompt, buildInteractivePlanPrompt,
  applyInteractiveImport, defaultInteractiveOptions,
  normalizeInteractiveGenerated, normalizeInteractivePlan, verifyInteractiveImport,
  type InteractiveGenerated,
} from './interactiveImport';
import type { SourceMaterial } from './projectImport';

const mat = (over: Partial<SourceMaterial> = {}): SourceMaterial => ({
  id: 'm1', name: '正文', kind: 'manuscript', trust: 'canon', text: '灯塔的故事……', ...over,
});

function planFixture() {
  return normalizeInteractivePlan({
    projectName: '雾岬灯塔:抉择',
    summary: '守灯人与无灯之船',
    volumes: [{ title: '第一卷', chapters: [{ title: '第一章', scenes: ['雨夜'] }] }],
    entities: [{ kind: 'character', name: '林晚', brief: '守灯人' }],
    timelineTracks: ['主线'],
    variables: [
      { name: 'trust', type: 'number', value: '0', description: '信任度' },
      { name: '中文名', type: 'boolean', value: 'false', description: '非法名' },
      { name: 'met_ghost', type: 'boolean', value: 'false', description: '' },
    ],
    endings: [
      { title: '留下', technicalName: 'ending_stay', summary: 'trust 高' },
      { title: '出海', technicalName: 'ending stay', summary: '技术名会被清洗并消歧' },
    ],
    pending: [],
  });
}

/** 一个通过全部验收的良构生成结果 */
function goodGenerated(): unknown {
  return {
    structure: [{ title: '第一卷', chapters: [{ title: '第一章', scenes: [
      { title: '雨夜', pov: '林晚', location: '', time: '', source: '正文', blocks: [
        { type: 'heading', text: '雨夜' }, { type: 'action', text: '雾漫上台阶。' },
      ] },
    ] }] }],
    entities: [{ kind: 'character', name: '林晚', summary: '守灯人', fields: [], source: '正文', evidence: '' }],
    relations: [], arcs: [], foreshadows: [], outline: [], timelinePoints: [], timelineEvents: [], brainstorm: [],
    variables: [{ name: 'trust', type: 'number', value: '0', description: '' }],
    flows: [{
      name: '第一章', technicalName: 'ch1',
      nodes: [
        { id: 'n1', type: 'dialogue', title: '开场', text: '雨夜。', speaker: '林晚' },
        { id: 'n2', type: 'hub', title: '怎么办?' },
        { id: 'n3', type: 'instruction', text: 'trust = trust + 1' },
        { id: 'n4', type: 'condition', text: 'trust > 0' },
        { id: 'n5', type: 'dialogue', title: '留下', text: '你留了下来。', ending: 'ending_stay' },
        { id: 'n6', type: 'dialogue', title: '出海', text: '你出海了。', ending: 'ending_sea' },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3', label: '帮忙修灯' },
        { from: 'n2', to: 'n4', label: '先观望', fallback: false },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5', handle: 'true' },
        { from: 'n4', to: 'n6', handle: 'false' },
      ],
    }],
    endingNodes: [
      { technicalName: 'ending_stay', title: '留下', flow: 'ch1', node: 'n5' },
      { technicalName: 'ending_sea', title: '出海', flow: 'ch1', node: 'n6' },
    ],
    pending: [],
  };
}

describe('normalizeInteractivePlan', () => {
  it('变量校验与结局技术名清洗消歧', () => {
    const { extras, warnings } = planFixture();
    expect(extras.variables.map((v) => v.name)).toEqual(['trust', 'met_ghost']);
    expect(warnings.some((w) => w.includes('中文名'))).toBe(true);
    expect(extras.endings).toHaveLength(2);
    expect(extras.endings[0].technicalName).toBe('ending_stay');
    expect(extras.endings[1].technicalName).not.toBe('ending_stay');
    expect(extras.endings[1].technicalName).toMatch(/^[a-z0-9_]+/i);
  });

  it('计划与生成 prompt 携带配置与脚本语法', () => {
    const options = defaultInteractiveOptions();
    const planPrompt = buildInteractivePlanPrompt(options);
    expect(planPrompt).toContain('endings');
    expect(planPrompt).toContain('3 个');
    const { plan, extras } = planFixture();
    const genPrompt = buildInteractiveGeneratePrompt(plan, extras, options);
    expect(genPrompt).toContain('seen("节点技术名")');
    expect(genPrompt).toContain('ending_stay');
    expect(genPrompt).toContain('success');
  });
});

describe('normalizeInteractiveGenerated', () => {
  it('坏节点 / 坏边丢弃,condition 出边缺 handle 自动补齐', () => {
    const { data, warnings } = normalizeInteractiveGenerated({
      ...goodGenerated() as Record<string, unknown>,
      flows: [{
        name: 'x', technicalName: 'x',
        nodes: [
          { id: 'a', type: 'condition', text: 'trust > 0' },
          { id: 'b', type: '外星类型', title: '降级成对白' },
          { id: 'c', type: 'dialogue', title: '' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'c' },
          { from: 'ghost', to: 'c' },
        ],
      }],
    });
    const f = data.flows[0];
    expect(f.nodes[1].type).toBe('dialogue');
    expect(f.edges).toHaveLength(2);
    expect(f.edges[0].handle).toBe('true');
    expect(f.edges[1].handle).toBe('false');
    expect(warnings.some((w) => w.includes('不存在的节点'))).toBe(true);
    expect(warnings.some((w) => w.includes('true/false'))).toBe(true);
  });

  it('节点上的 ending 标记自动并入 endingNodes', () => {
    const raw = goodGenerated() as Record<string, unknown>;
    delete raw.endingNodes;
    const { data } = normalizeInteractiveGenerated(raw);
    expect(data.endingNodes.map((e) => e.technicalName).sort()).toEqual(['ending_sea', 'ending_stay']);
  });
});

function previewFixture(generated?: InteractiveGenerated) {
  const project = sampleProject();
  normalizeProject(project);
  const { plan, extras } = planFixture();
  const gen = generated ?? normalizeInteractiveGenerated(goodGenerated()).data;
  const preview = buildInteractiveImportPreview(project, plan, extras, gen, [mat()]);
  return { project, plan, extras, preview };
}

describe('buildInteractiveImportPreview', () => {
  it('节点 id 重映射为 uid,边指向真实节点,布局与结局解析完成', () => {
    const { preview } = previewFixture();
    const flow = preview.newFlows[0];
    expect(flow.nodes).toHaveLength(6);
    const ids = new Set(flow.nodes.map((n) => n.id));
    expect(ids.has('n1')).toBe(false);
    expect(flow.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    expect(flow.nodes.some((n) => n.position.x > 0)).toBe(true);
    expect(preview.endings).toHaveLength(2);
    expect(ids.has(preview.endings[0].nodeId)).toBe(true);
    expect(preview.base.counts['流程(互动)'].add).toBe(1);
    expect(preview.base.counts['变量'].add).toBeGreaterThan(0);
    // speaker 关联到生成的实体
    const n1 = flow.nodes[0];
    expect(n1.data.speakerId).toBeTruthy();
  });

  it('与项目重名的变量跳过不覆盖', () => {
    const project = sampleProject();
    normalizeProject(project);
    project.variables.push({ id: 'v-old', name: 'trust', type: 'number', value: '99', description: '既有' });
    const { plan, extras } = planFixture();
    const gen = normalizeInteractiveGenerated(goodGenerated()).data;
    const preview = buildInteractiveImportPreview(project, plan, extras, gen, [mat()]);
    expect(preview.newVariables.some((v) => v.name === 'trust')).toBe(false);
    expect(preview.warnings.some((w) => w.includes('trust'))).toBe(true);
  });
});

describe('verifyInteractiveImport 验收闭环', () => {
  it('良构生成:pass / warning,且 apply 后落库完整', () => {
    const { project, preview } = previewFixture();
    const v = verifyInteractiveImport(project, preview);
    expect(v.status).not.toBe('blocked');
    expect(v.summary.newAuditErrors).toBe(0);
    expect(v.summary.unreachableEndings).toHaveLength(0);
    expect(v.summary.endingsChecked).toBe(2);

    const before = { flows: project.flows.length, vars: project.variables.length };
    applyInteractiveImport(project, preview);
    normalizeProject(project);
    expect(project.flows.length).toBe(before.flows + 1);
    expect(project.variables.length).toBeGreaterThan(before.vars);
  });

  it('脚本使用未声明变量 → 新增脚本 error → blocked', () => {
    const raw = goodGenerated() as Record<string, unknown>;
    const flows = raw.flows as { nodes: { id: string; type: string; text?: string }[] }[];
    flows[0].nodes.find((n) => n.id === 'n4')!.text = 'ghost_var > 3';
    const gen = normalizeInteractiveGenerated(raw).data;
    const { project, preview } = previewFixture(gen);
    const v = verifyInteractiveImport(project, preview);
    expect(v.status).toBe('blocked');
    expect(v.summary.newAuditErrors).toBeGreaterThan(0);
  });

  it('结局不可达 → blocked 并点名结局', () => {
    const raw = goodGenerated() as Record<string, unknown>;
    // 砍断通往 n6(出海)的 false 分支:条件恒真
    const flows = raw.flows as { nodes: { id: string; type: string; text?: string }[]; edges: { from: string; to: string; condition?: string; handle?: string }[] }[];
    flows[0].nodes.find((n) => n.id === 'n4')!.text = 'trust >= 0';
    const gen = normalizeInteractiveGenerated(raw).data;
    const { project, preview } = previewFixture(gen);
    const v = verifyInteractiveImport(project, preview);
    expect(v.status).toBe('blocked');
    expect(v.summary.unreachableEndings).toContain('出海');
  });

  it('没有任何结局 → blocked', () => {
    const raw = goodGenerated() as Record<string, unknown>;
    delete raw.endingNodes;
    const flows = raw.flows as { nodes: { id: string; ending?: string }[] }[];
    for (const n of flows[0].nodes) delete n.ending;
    const gen = normalizeInteractiveGenerated(raw).data;
    const { project, preview } = previewFixture(gen);
    const v = verifyInteractiveImport(project, preview);
    expect(v.status).toBe('blocked');
    expect(v.issues.some((i) => i.message.includes('结局'))).toBe(true);
  });
});
