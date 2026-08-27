import { describe, expect, it } from 'vitest';
import { selectOutgoing, type WalkEdge } from './flowWalk';

const e = (id: string, x: Partial<WalkEdge> = {}): WalkEdge => ({ id, ...x });
const base = { isTaken: () => false, edgeAllowed: () => true };
const ids = (r: { usable: WalkEdge[] }) => r.usable.map((x) => x.id);

describe('出边选择规则', () => {
  it('命名出口优先接同名引脚,没有才落到默认引脚', () => {
    const edges = [e('named', { sourceHandle: 'exit:x' }), e('default')];
    expect(ids(selectOutgoing(edges, { ...base, exitId: 'x', nodeType: 'fragment' }))).toEqual(['named']);
    // 没有同名引脚时退到默认引脚
    expect(ids(selectOutgoing([e('default')], { ...base, exitId: 'x', nodeType: 'fragment' }))).toEqual(['default']);
  });

  it('从命名出口回来时不能被「片段默认引脚」规则吃掉', () => {
    // 回溯到父层后当前节点就是片段,若先清 exitId 再判断类型,命名边会被误过滤
    const edges = [e('named', { sourceHandle: 'exit:x' })];
    expect(ids(selectOutgoing(edges, { ...base, exitId: 'x', nodeType: 'fragment' }))).toEqual(['named']);
  });

  it('片段自然结束只走默认引脚', () => {
    const edges = [e('named', { sourceHandle: 'exit:x' }), e('default')];
    expect(ids(selectOutgoing(edges, { ...base, nodeType: 'fragment' }))).toEqual(['default']);
  });

  it('条件节点按结果选引脚;求不出来保留全部交人工选', () => {
    const edges = [e('t', { sourceHandle: 'true' }), e('f', { sourceHandle: 'false' })];
    expect(ids(selectOutgoing(edges, { ...base, nodeType: 'condition', condResult: true }))).toEqual(['t']);
    expect(ids(selectOutgoing(edges, { ...base, nodeType: 'condition', condResult: false }))).toEqual(['f']);
    expect(ids(selectOutgoing(edges, { ...base, nodeType: 'condition', condResult: null }))).toEqual(['t', 'f']);
  });

  it('条件为真但没有 true 引脚 = 走不通,不能退回全部边', () => {
    const edges = [e('f', { sourceHandle: 'false' })];
    expect(ids(selectOutgoing(edges, { ...base, nodeType: 'condition', condResult: true }))).toEqual([]);
  });

  it('检定按成败选引脚', () => {
    const edges = [e('s', { sourceHandle: 'success' }), e('x', { sourceHandle: 'fail' })];
    expect(ids(selectOutgoing(edges, { ...base, nodeType: 'check', checkPassed: true }))).toEqual(['s']);
    expect(ids(selectOutgoing(edges, { ...base, nodeType: 'check', checkPassed: false }))).toEqual(['x']);
  });

  it('一次性选项走过就消失', () => {
    const edges = [e('once', { once: true }), e('normal')];
    expect(ids(selectOutgoing(edges, { ...base, isTaken: (id) => id === 'once' }))).toEqual(['normal']);
  });

  it('边条件不放行则隐藏;求不出来算放行', () => {
    const edges = [e('gated', { condition: 'trust > 5' }), e('open')];
    expect(ids(selectOutgoing(edges, { ...base, edgeAllowed: () => false }))).toEqual(['open']);
    expect(ids(selectOutgoing(edges, base))).toEqual(['gated', 'open']);
  });

  it('还有别的可走时遮蔽 fallback;别的都不可走才放出来', () => {
    const edges = [e('fb', { fallback: true }), e('main', { condition: 'trust > 5' })];
    expect(ids(selectOutgoing(edges, base))).toEqual(['main']);
    expect(ids(selectOutgoing(edges, { ...base, edgeAllowed: () => false }))).toEqual(['fb']);
  });

  it('rawCount 区分「本来没出边」与「有出边但全被过滤」(卡死判定)', () => {
    const r1 = selectOutgoing([], base);
    expect([r1.rawCount, r1.usable.length]).toEqual([0, 0]);
    const r2 = selectOutgoing([e('a', { condition: 'x' })], { ...base, edgeAllowed: () => false });
    expect([r2.rawCount, r2.usable.length]).toEqual([1, 0]);
  });
});
