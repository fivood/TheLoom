import { describe, expect, it } from 'vitest';
import type { Entity, Flow, FlowEdge, FlowNode, FlowTest, Project, Variable } from './types';
import { flowFingerprint, isTestStale, runAllFlowTests, runFlowTest } from './flowTest';

let seq = 0;
const node = (id: string, type: FlowNode['type'], data: Partial<FlowNode['data']> = {}): FlowNode => ({
  id, type, position: { x: seq++ * 100, y: 0 }, data: { title: id, text: '', ...data },
});
const edge = (source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge => ({
  id: `e-${source}-${target}`, source, target, ...extra,
});
const numVar = (name: string, value: string): Variable => ({ id: name, name, type: 'number', value, description: '' });

function project(flows: Flow[], variables: Variable[] = [], entities: Entity[] = []): Project {
  return {
    version: 1, name: '回归测试', flows, entities,
    brainstormNotes: [], brainstormEdges: [], outlineColumns: [], outlineRows: [],
    timelineTracks: [], timelinePoints: [], timelineEvents: [], maps: [],
    researchCards: [], researchCategories: [], variables,
    assets: [], documents: [], documentCategories: [], attachments: {}, folders: [],
    updatedAt: 0,
  };
}

const test = (over: Partial<FlowTest> = {}): FlowTest => ({
  id: 't1', name: '测试', flowRef: 'main', seed: 42, choices: [], assertions: [], updatedAt: 0, ...over,
});

describe('runFlowTest 回放与断言', () => {
  it('按选择序列回放,断言结局节点与变量终值', () => {
    const p = project([{
      id: 'f', name: '主线', technicalName: 'main',
      nodes: [
        node('start', 'dialogue', { text: '开场' }),
        node('h', 'hub'),
        node('left', 'instruction', { text: 'score = 10' }),
        node('right', 'instruction', { text: 'score = 1' }),
        node('endL', 'dialogue', { text: '左结局', technicalName: 'ending_left' }),
        node('endR', 'dialogue', { text: '右结局', technicalName: 'ending_right' }),
      ],
      edges: [
        edge('start', 'h'),
        edge('h', 'left', { label: '走左边' }),
        edge('h', 'right', { label: '走右边' }),
        edge('left', 'endL'), edge('right', 'endR'),
      ],
    }], [numVar('score', '0')]);

    const r = runFlowTest(p, test({
      choices: [0, 0],   // start→h,然后在 hub 选第 0 个「走左边」
      assertions: [
        { kind: 'ended', node: 'ending_left' },
        { kind: 'variable', name: 'score', op: '==', value: '10' },
        { kind: 'nodeVisited', node: 'ending_right', expect: false },
      ],
    }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(r.finalVars.score).toBe(10);
  });

  it('断言失败时给出实际值,且与回放错误区分开', () => {
    const p = project([{
      id: 'f', name: '主线', technicalName: 'main',
      nodes: [node('a', 'instruction', { text: 'score = 3' }), node('b', 'dialogue', { text: '完' })],
      edges: [edge('a', 'b')],
    }], [numVar('score', '0')]);

    const r = runFlowTest(p, test({
      assertions: [{ kind: 'variable', name: 'score', op: '>', value: '5' }],
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toBeUndefined();               // 回放本身没问题
    expect(r.results[0].ok).toBe(false);
    expect(r.results[0].detail).toContain('实际 3');
  });

  it('选项下标越界与选择序列用完都记为回放错误', () => {
    const p = project([{
      id: 'f', name: '主线', technicalName: 'main',
      nodes: [node('h', 'hub'), node('x', 'dialogue'), node('y', 'dialogue')],
      edges: [edge('h', 'x', { label: 'X' }), edge('h', 'y', { label: 'Y' })],
    }]);
    expect(runFlowTest(p, test({ choices: [5] })).error).toContain('越界');
    expect(runFlowTest(p, test({ choices: [] })).error).toContain('用完');
  });

  it('初始变量覆盖生效,且不改动原项目', () => {
    const p = project([{
      id: 'f', name: '主线', technicalName: 'main',
      nodes: [
        node('c', 'condition', { text: 'gate > 0' }),
        node('t', 'dialogue', { text: '真' }),
        node('e', 'dialogue', { text: '假' }),
      ],
      edges: [edge('c', 't', { sourceHandle: 'true' }), edge('c', 'e', { sourceHandle: 'false' })],
    }], [numVar('gate', '0')]);

    const r = runFlowTest(p, test({
      initialVars: [{ name: 'gate', value: '5' }],
      assertions: [{ kind: 'nodeVisited', node: 't', expect: true }],
    }));
    expect(r.ok).toBe(true);
    expect(p.variables[0].value).toBe('0');        // 原项目未被改动
  });

  it('覆盖率统计节点与边(含子流程),不把别的流程算进来', () => {
    const p = project([
      {
        id: 'f', name: '主线', technicalName: 'main',
        nodes: [node('a', 'dialogue'), node('b', 'dialogue'), node('dead', 'dialogue')],
        edges: [edge('a', 'b')],
      },
      { id: 'other', name: '别的', technicalName: 'other', nodes: [node('z', 'dialogue')], edges: [] },
    ]);
    // dead 没有入边,所以它也算起点 —— 开局先选起点(选 a),再从 a 走到 b
    const r = runFlowTest(p, test({ choices: [0, 0] }));
    expect(r.coverage.totalNodes).toBe(3);
    expect(r.coverage.visitedNodes).toBe(2);   // dead 未覆盖
    expect(r.coverage.totalEdges).toBe(1);
    expect(r.coverage.takenEdges).toBe(1);
  });
});

describe('runFlowTest · 补上 R19-2 / R19-3 留下的口子', () => {
  it('R19-2:跨流程调用按真实语义走,能验到「调用后确实回到了调用点」', () => {
    const p = project([
      {
        id: 'main', name: '主线', technicalName: 'main',
        nodes: [
          node('m1', 'call', { targetFlow: 'side' }),
          node('m2', 'dialogue', { text: '回来了', technicalName: 'after_call' }),
        ],
        edges: [edge('m1', 'm2')],
      },
      {
        id: 'side', name: '支线', technicalName: 'side',
        nodes: [node('s1', 'instruction', { text: 'n = 7' })],
        edges: [],
      },
    ], [numVar('n', '0')]);

    const r = runFlowTest(p, test({
      assertions: [
        { kind: 'ended', node: 'after_call' },
        { kind: 'variable', name: 'n', op: '==', value: '7' },
        { kind: 'nodeVisited', node: 's1', expect: true },
      ],
    }));
    expect(r.ok).toBe(true);
  });

  it('R19-2:被调流程 jump 走掉后,调用帧仍在栈上 —— 目标流程结束时照样返回调用点', () => {
    const p = project([
      {
        id: 'main', name: '主线', technicalName: 'main',
        nodes: [
          node('m1', 'call', { targetFlow: 'side' }),
          node('m2', 'dialogue', { text: '不该到这', technicalName: 'after_call' }),
        ],
        edges: [edge('m1', 'm2')],
      },
      {
        id: 'side', name: '支线', technicalName: 'side',
        nodes: [node('s1', 'jump', { targetFlow: 'far' })],
        edges: [],
      },
      { id: 'far', name: '远方', technicalName: 'far', nodes: [node('z', 'dialogue', { text: '终点' })], edges: [] },
    ]);

    // jump 是 goto 而不是 return:它只切流程,不弹调用栈。
    // 所以 far 走完时,栈顶那帧仍然把控制权交回 main 的调用点。
    // 这是路径遍历完全看不到的运行期行为,只有真跑一遍才能确认。
    const r = runFlowTest(p, test({
      assertions: [
        { kind: 'nodeVisited', node: 'z', expect: true },
        { kind: 'nodeVisited', node: 'after_call', expect: true },
        { kind: 'ended', node: 'after_call' },
      ],
    }));
    expect(r.ok).toBe(true);
    expect(r.visitedNodes).toEqual(['m1', 's1', 'z', 'm2']);
  });

  it('R19-3:外部事件按预置响应回值,能验到事件触发与回值影响的分支', () => {
    const p = project([{
      id: 'f', name: '主线', technicalName: 'main',
      nodes: [
        node('e1', 'event', { eventName: 'play_anim' }),
        node('e2', 'event', { eventName: 'solve', eventWait: 'value', eventResultVar: 'score' }),
        node('c', 'condition', { text: 'score > 5' }),
        node('win', 'dialogue', { text: '解开了', technicalName: 'ending_win' }),
        node('lose', 'dialogue', { text: '没解开', technicalName: 'ending_lose' }),
      ],
      edges: [
        edge('e1', 'e2'), edge('e2', 'c'),
        edge('c', 'win', { sourceHandle: 'true' }), edge('c', 'lose', { sourceHandle: 'false' }),
      ],
    }], [numVar('score', '0')]);
    p.externalEvents = [
      { id: 'ev1', name: 'play_anim' },
      { id: 'ev2', name: 'solve', returnType: 'number' },
    ];

    const win = runFlowTest(p, test({
      eventResponses: [{ event: 'solve', value: '9' }],
      assertions: [
        { kind: 'eventFired', event: 'play_anim', expect: true },
        { kind: 'ended', node: 'ending_win' },
        { kind: 'variable', name: 'score', op: '==', value: '9' },
      ],
    }));
    expect(win.ok).toBe(true);
    expect(win.firedEvents.map((f) => f.event)).toEqual(['play_anim', 'solve']);

    // 换一个回值就该走另一条结局 —— 同一份流程,两条测试守住两个分支
    const lose = runFlowTest(p, test({
      eventResponses: [{ event: 'solve', value: '1' }],
      assertions: [{ kind: 'ended', node: 'ending_lose' }],
    }));
    expect(lose.ok).toBe(true);
  });

  it('没配事件响应时按声明的返回类型取零值,结果仍然确定', () => {
    const p = project([{
      id: 'f', name: '主线', technicalName: 'main',
      nodes: [node('e', 'event', { eventName: 'solve', eventWait: 'value', eventResultVar: 'score' }), node('b', 'dialogue')],
      edges: [edge('e', 'b')],
    }], [numVar('score', '3')]);
    p.externalEvents = [{ id: 'ev', name: 'solve', returnType: 'number' }];
    const r = runFlowTest(p, test({ assertions: [{ kind: 'variable', name: 'score', op: '==', value: '0' }] }));
    expect(r.ok).toBe(true);
  });
});

describe('批量运行与受影响标记', () => {
  const base = () => project([{
    id: 'f', name: '主线', technicalName: 'main',
    nodes: [node('a', 'dialogue'), node('b', 'dialogue')],
    edges: [edge('a', 'b')],
  }]);

  it('runAllFlowTests 按声明顺序返回', () => {
    const p = base();
    p.flowTests = [
      test({ id: 't1', name: '一', choices: [0] }),
      test({ id: 't2', name: '二', choices: [0] }),
    ];
    expect(runAllFlowTests(p).map((r) => r.testId)).toEqual(['t1', 't2']);
  });

  it('流程内容变化后标为受影响;改别的流程不受影响', () => {
    const p = base();
    p.flows.push({ id: 'other', name: '别的', technicalName: 'other', nodes: [], edges: [] });
    const t = test({ flowHash: flowFingerprint(p.flows[0]) });
    expect(isTestStale(p, t)).toBe(false);

    p.flows[1].nodes.push(node('newone', 'dialogue'));     // 改别的流程
    expect(isTestStale(p, t)).toBe(false);

    p.flows[0].nodes.push(node('c', 'dialogue'));          // 改目标流程
    expect(isTestStale(p, t)).toBe(true);
  });

  it('目标流程不存在时报回放错误并视为受影响', () => {
    const p = base();
    const r = runFlowTest(p, test({ flowRef: '不存在' }));
    expect(r.error).toContain('流程不存在');
    expect(isTestStale(p, test({ flowRef: '不存在', flowHash: 'x' }))).toBe(true);
  });
});
