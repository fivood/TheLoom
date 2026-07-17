import { describe, expect, it } from 'vitest';
import type { Entity, Flow, FlowEdge, FlowNode, Project, Variable } from '../types';
import { buildEnginePackage } from '../engine/package';
import { FlowRuntime } from './player';

let seq = 0;
const node = (id: string, type: FlowNode['type'], data: Partial<FlowNode['data']> = {}): FlowNode => ({
  id, type, position: { x: seq++ * 100, y: 0 }, data: { title: id, text: '', ...data },
});
const edge = (source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge => ({
  id: `e-${source}-${target}-${seq++}`, source, target, ...extra,
});

function project(flows: Flow[], variables: Variable[] = [], entities: Entity[] = []): Project {
  return {
    version: 1, name: '运行库测试', flows, entities,
    brainstormNotes: [], brainstormEdges: [], outlineColumns: [], outlineRows: [],
    timelineTracks: [], timelinePoints: [], timelineEvents: [], maps: [],
    researchCards: [], researchCategories: [], variables,
    assets: [], documents: [], documentCategories: [], attachments: {}, folders: [],
    updatedAt: 0,
  };
}

/** 模拟引擎消费:包序列化为 JSON 再读回,无任何应用运行态 */
function enginePkg(p: Project) {
  return JSON.parse(JSON.stringify(buildEnginePackage(p)));
}

const boolVar = (name: string, value: string): Variable => ({ id: name, name, type: 'boolean', value, description: '' });
const numVar = (name: string, value: string): Variable => ({ id: name, name, type: 'number', value, description: '' });

describe('FlowRuntime 基础演出(经 JSON 往返的引擎包)', () => {
  it('线性对白:beats 逐条产生,对白不自动前进,结束标记正确', () => {
    const p = project([{
      id: 'f1', name: '线性', technicalName: 'linear',
      nodes: [node('a', 'dialogue', { text: '你好' }), node('b', 'dialogue', { text: '再见' })],
      edges: [edge('a', 'b')],
    }]);
    const run = new FlowRuntime(enginePkg(p), 'linear');
    run.start();
    expect(run.log.map((b) => b.text)).toEqual(['你好']);
    expect(run.choices).toHaveLength(1);
    expect(run.ended).toBe(false);
    run.choose(0);
    expect(run.log.map((b) => b.text)).toEqual(['你好', '再见']);
    expect(run.ended).toBe(true);
  });

  it('汇聚点选项:标签、效果指令、一次性选项', () => {
    const p = project([{
      id: 'f1', name: '选项',
      nodes: [
        node('start', 'dialogue', { text: '开场' }),
        node('h', 'hub'),
        node('x', 'dialogue', { text: 'X' }),
        node('stay', 'dialogue', { text: '原地不动' }),
      ],
      edges: [
        edge('start', 'h'),
        edge('h', 'x', { label: '去X', effect: 'flag = true', once: true }),
        edge('h', 'stay', { label: '原地' }),
        edge('x', 'h'),
        edge('stay', 'h'),
      ],
    }], [boolVar('flag', 'false')]);
    const run = new FlowRuntime(enginePkg(p), 'f1');
    run.start();
    run.choose(0); // 开场 → h(hub 多出边:停下给选项)
    expect(run.choices.map((c) => c.label)).toEqual(['去X', '原地']);
    run.choose(0);
    expect(run.vars.flag).toBe(true);
    // X 是对白,单出边给一个「继续」;回到 h 时一次性选项已隐藏,
    // hub 只剩一个可用出边 → 自动前进走「原地」
    run.choose(0);
    expect(run.log.slice(-1)[0]?.text).toBe('原地不动');
  });

  it('指令 + 条件自动走向 + fallback 遮蔽', () => {
    const p = project([{
      id: 'f1', name: '条件',
      nodes: [
        node('set', 'instruction', { text: 'n = 3' }),
        node('c', 'condition', { text: 'n > 2' }),
        node('t', 'dialogue', { text: '真分支' }),
        node('fb', 'dialogue', { text: '兜底' }),
      ],
      edges: [
        edge('set', 'c'),
        edge('c', 't', { sourceHandle: 'true' }),
        edge('c', 'fb', { sourceHandle: 'true', fallback: true }),
      ],
    }], [numVar('n', '0')]);
    const run = new FlowRuntime(enginePkg(p), 'f1');
    run.start();
    // 指令与条件均自动前进,最终停在真分支对白
    expect(run.log.map((b) => b.kind)).toEqual(['instruction', 'condition', 'dialogue']);
    expect(run.log[2].text).toBe('真分支');
    expect(run.log[1].note).toBe('→ 真');
  });

  it('子流程:fragment 钻入、exit 命名引脚回父层', () => {
    const p = project([{
      id: 'f1', name: '嵌套',
      nodes: [
        node('frag', 'fragment', {
          sub: {
            nodes: [node('in', 'dialogue', { text: '子层' }), node('door', 'exit', { title: '东门' })],
            edges: [edge('in', 'door')],
          },
        }),
        node('east', 'dialogue', { text: '东侧' }),
        node('other', 'dialogue', { text: '默认' }),
      ],
      edges: [
        edge('frag', 'east', { sourceHandle: 'exit:door' }),
        edge('frag', 'other'),
      ],
    }]);
    const run = new FlowRuntime(enginePkg(p), 'f1');
    run.start();
    expect(run.log.map((b) => b.kind)).toEqual(['fragment', 'dialogue']);
    run.choose(0); // 子层对白 → exit → 命名引脚(exit 单选项自动前进)
    expect(run.log.map((b) => b.text).slice(-1)[0]).toBe('东侧');
    expect(run.log.some((b) => b.kind === 'exit')).toBe(true);
    expect(run.ended).toBe(true); // 东侧无出边 → 结束
  });

  it('实体属性:说话人名与 实体.字段 条件求值、指令写入', () => {
    const sem: Entity = {
      id: 'e1', kind: 'character', name: '林晚', color: '#333', emoji: '', summary: '', notes: '',
      technicalName: 'linwan',
      fields: [{ id: 'f1', label: 'trust', value: '5' }],
      createdAt: 0,
    };
    const p = project([{
      id: 'f1', name: '实体',
      nodes: [
        node('say', 'dialogue', { text: '……', speakerId: 'e1' }),
        node('up', 'instruction', { text: 'linwan.trust += 2' }),
        node('c', 'condition', { text: 'linwan.trust > 6' }),
        node('t', 'dialogue', { text: '信任了' }),
      ],
      edges: [edge('say', 'up'), edge('up', 'c'), edge('c', 't', { sourceHandle: 'true' })],
    }], [], [sem]);
    const run = new FlowRuntime(enginePkg(p), 'f1');
    run.start();
    expect(run.log[0].speakerName).toBe('林晚');
    run.choose(0);
    expect(run.entityProps.linwan.trust).toBe(7);
    expect(run.log.slice(-1)[0]?.text).toBe('信任了');
  });
});

describe('FlowRuntime 检定与存档', () => {
  const checkProject = () => project([{
    id: 'f1', name: '检定',
    nodes: [
      node('ck', 'check', { checkExpr: '2', checkDc: 9 }),
      node('win', 'dialogue', { text: '成功' }),
      node('lose', 'dialogue', { text: '失败' }),
    ],
    edges: [edge('ck', 'win', { sourceHandle: 'success' }), edge('ck', 'lose', { sourceHandle: 'fail' })],
  }]);

  it('同种子两次演出:掷骰记录完全一致', () => {
    const pkg = enginePkg(checkProject());
    const a = new FlowRuntime(pkg, 'f1', { seed: 42 });
    a.start();
    const b = new FlowRuntime(pkg, 'f1', { seed: 42 });
    b.start();
    expect(a.log[0].note).toBe(b.log[0].note);
    expect(a.log.slice(-1)[0]?.text).toBe(b.log.slice(-1)[0]?.text);
  });

  it('snapshot / restore:恢复后继续演出与原线完全一致', () => {
    const p = project([{
      id: 'f1', name: '存档',
      nodes: [
        node('h', 'hub'),
        node('ck', 'check', { checkExpr: '0', checkDc: 7 }),
        node('bye', 'dialogue', { text: '离开' }),
        node('win', 'dialogue', { text: '成功' }),
        node('lose', 'dialogue', { text: '失败' }),
      ],
      edges: [
        edge('h', 'ck', { label: '掷骰' }),
        edge('h', 'bye', { label: '离开' }),
        edge('ck', 'win', { sourceHandle: 'success' }),
        edge('ck', 'lose', { sourceHandle: 'fail' }),
      ],
    }]);
    const pkg = enginePkg(p);
    const a = new FlowRuntime(pkg, 'f1', { seed: 7 });
    a.start();
    const snap = a.snapshot();
    a.choose(0);
    const outcomeA = a.log.slice(-1)[0]?.text;

    const b = new FlowRuntime(pkg, 'f1');
    b.restore(snap);
    expect(b.choices.map((c) => c.label)).toEqual(['掷骰', '离开']);
    b.choose(0);
    expect(b.log.slice(-1)[0]?.text).toBe(outcomeA);
  });

  it('onBeat 回调逐条触发', () => {
    const seen: string[] = [];
    const run = new FlowRuntime(enginePkg(checkProject()), 'f1', {
      seed: 1,
      onBeat: (b) => seen.push(b.kind),
    });
    run.start();
    expect(seen[0]).toBe('check');
    expect(seen.slice(-1)[0]).toBe('dialogue');
  });
});
