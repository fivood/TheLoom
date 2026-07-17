import { describe, expect, it } from 'vitest';
import type { Entity, Flow, Project } from '../types';
import { buildEngineDelta, buildEnginePackage, contentHash, diffManifests } from './package';
import { generateTypes } from './typegen';
import { ENGINE_PACKAGE_SCHEMA } from './schema';

function baseProject(): Project {
  const entities: Entity[] = [
    {
      id: 'e1', kind: 'character', name: '林晚', color: '#333', emoji: '', summary: '主角', notes: '',
      technicalName: 'linwan',
      fields: [
        { id: 'ff1', label: 'trust', value: '5' },
        { id: 'ff2', label: '挚友', value: 'e2', type: 'entity' },
      ],
      createdAt: 0,
    },
    {
      id: 'e2', kind: 'character', name: '瓦伦', color: '#444', emoji: '', summary: '', notes: '',
      technicalName: 'valen', fields: [], createdAt: 0,
    },
    {
      id: 'e3', kind: 'location', name: '无人巷', color: '#555', emoji: '', summary: '', notes: '',
      fields: [], createdAt: 0,
    },
  ];
  const flows: Flow[] = [
    {
      id: 'f1', name: '第一幕', technicalName: 'act1',
      nodes: [
        { id: 'n1', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '开场', text: '雨夜', speakerId: 'e1', technicalName: 'opening' } },
        { id: 'note1', type: 'note', position: { x: 9, y: 9 }, data: { title: '备忘', text: '画布注释' } },
        {
          id: 'frag', type: 'fragment', position: { x: 1, y: 1 }, data: {
            title: '片段', text: '',
            sub: {
              nodes: [{ id: 'sub1', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '', text: '子层', technicalName: 'sub_line' } }],
              edges: [],
            },
          },
        },
      ],
      edges: [
        { id: 'ed1', source: 'n1', target: 'frag', label: '继续' },
        { id: 'ed2', source: 'n1', target: 'note1' },
      ],
    },
    { id: 'f2', name: '第二幕', nodes: [], edges: [] },
  ];
  return {
    version: 1, name: '引擎包测试', flows, entities,
    brainstormNotes: [], brainstormEdges: [], outlineColumns: [], outlineRows: [],
    timelineTracks: [], timelinePoints: [], timelineEvents: [], maps: [],
    researchCards: [], researchCategories: [],
    variables: [{ id: 'v1', name: 'trust', type: 'number', value: '0', description: '信任度' }],
    assets: [
      {
        id: 'a1', name: '主题曲', kind: 'audio', mime: 'audio/wav', size: 10, tags: [], source: '', notes: '',
        technicalName: 'theme', createdAt: 0,
        hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', ext: 'wav', license: 'CC0',
      },
      { id: 'a2', name: '未挂接', kind: 'image', mime: 'image/png', size: 5, tags: [], source: '', notes: '', createdAt: 0 },
    ],
    documents: [], documentCategories: [],
    attachments: { n1: ['a1'], ghost: ['a1'] },
    folders: [],
    updatedAt: 0,
  };
}

describe('buildEnginePackage', () => {
  it('默认规则:剥注释与布局,索引齐全,附件限定导出范围', () => {
    const pkg = buildEnginePackage(baseProject());
    expect(pkg.schema).toBe('theloom-package');
    const f1 = pkg.flows.find((f) => f.id === 'f1')!;
    expect(f1.nodes.map((n) => n.id)).toEqual(['n1', 'frag']);
    expect(f1.edges.map((e) => e.id)).toEqual(['ed1']); // 指向注释的边同步剥除
    expect(f1.nodes[0].position).toBeUndefined();

    expect(pkg.index.technicalNames.act1).toEqual({ kind: 'flow', id: 'f1' });
    expect(pkg.index.technicalNames.opening).toEqual({ kind: 'node', id: 'n1', flowId: 'f1' });
    expect(pkg.index.technicalNames.sub_line.kind).toBe('node');
    expect(pkg.index.nodes.sub1).toEqual({ flowId: 'f1', path: ['frag'], type: 'dialogue' });
    expect(pkg.index.speakers.e1).toEqual(['n1']);
    expect(pkg.index.assetOwners.a1).toEqual(['n1']);
    expect(pkg.attachments.ghost).toBeUndefined(); // 不在导出范围的 owner 剔除

    const theme = pkg.assets.find((a) => a.id === 'a1')!;
    expect(theme.fileName).toBe('asset-ba7816bf8f01cfea.wav');
    expect(theme.license).toBe('CC0');
    expect(pkg.manifest['flow:f1']).toMatch(/^[0-9a-f]{16}$/);
  });

  it('导出规则:选流程 / 保留布局与注释 / 仅引用实体与资源', () => {
    const pkg = buildEnginePackage(baseProject(), {
      flowIds: ['f1'],
      includeLayout: true,
      includeAnnotations: true,
      entities: 'referenced',
      assets: 'referenced',
    });
    expect(pkg.flows.map((f) => f.id)).toEqual(['f1']);
    expect(pkg.flows[0].nodes.some((n) => n.type === 'note')).toBe(true);
    expect(pkg.flows[0].nodes[0].position).toEqual({ x: 0, y: 0 });
    // 说话人 e1 + 其 entity 字段引用的 e2;无引用的 e3 剔除
    expect(pkg.entities.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    // 仅挂接的 a1
    expect(pkg.assets.map((a) => a.id)).toEqual(['a1']);
  });

  it('包可 JSON 往返且结构自洽(节点索引与实际节点一致)', () => {
    const pkg = JSON.parse(JSON.stringify(buildEnginePackage(baseProject())));
    const ids = new Set<string>();
    const walk = (sub: { nodes: { id: string; data: { sub?: unknown } }[] }) => {
      for (const n of sub.nodes) {
        ids.add(n.id);
        if (n.data.sub) walk(n.data.sub as typeof sub);
      }
    };
    for (const f of pkg.flows) walk(f);
    expect(new Set(Object.keys(pkg.index.nodes))).toEqual(ids);
  });
});

describe('增量导出', () => {
  it('contentHash 稳定,内容变化才变', () => {
    const a = contentHash({ x: 1, y: [1, 2] });
    expect(contentHash({ x: 1, y: [1, 2] })).toBe(a);
    expect(contentHash({ x: 2, y: [1, 2] })).not.toBe(a);
  });

  it('diffManifests + buildEngineDelta:只带变更对象,删除只带键', () => {
    const p = baseProject();
    const pkg1 = buildEnginePackage(p);

    const p2 = structuredClone(p);
    p2.flows[0].nodes[0].data.text = '雪夜';       // 改 f1
    p2.flows = p2.flows.filter((f) => f.id !== 'f2'); // 删 f2
    p2.entities.push({
      id: 'e4', kind: 'item', name: '新道具', color: '#111', emoji: '', summary: '', notes: '',
      fields: [], createdAt: 0,
    });
    const pkg2 = buildEnginePackage(p2);

    const diff = diffManifests(pkg1.manifest, pkg2.manifest);
    expect(diff.changed).toContain('flow:f1');
    expect(diff.removed).toContain('flow:f2');
    expect(diff.added).toContain('entity:e4');

    const delta = buildEngineDelta(pkg2, pkg1.manifest);
    expect(delta.schema).toBe('theloom-delta');
    expect(delta.changed.flows.map((f) => f.id)).toEqual(['f1']);
    expect(delta.changed.entities.map((e) => e.id)).toEqual(['e4']);
    expect(delta.changed.variables).toBeUndefined(); // 变量没变
    expect(delta.removed).toEqual(['flow:f2']);
  });
});

describe('类型生成与 Schema', () => {
  it('generateTypes 产出字面量联合与变量接口', () => {
    const dts = generateTypes(buildEnginePackage(baseProject()));
    expect(dts).toContain("export type FlowTechnicalName = 'act1';");
    expect(dts).toContain("'linwan' | 'valen'");
    expect(dts).toContain("'opening' | 'sub_line'");
    expect(dts).toContain('trust: number;');
    expect(dts).toContain('/** 信任度 */');
  });

  it('无技术名时联合类型为 never', () => {
    const p = baseProject();
    for (const f of p.flows) delete f.technicalName;
    const dts = generateTypes(buildEnginePackage(p));
    expect(dts).toContain('export type FlowTechnicalName = never;');
  });

  it('Schema 顶层与包一致', () => {
    const pkg = buildEnginePackage(baseProject());
    for (const key of ENGINE_PACKAGE_SCHEMA.required) {
      expect(pkg).toHaveProperty(key);
    }
  });
});
