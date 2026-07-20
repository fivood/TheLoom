import { describe, expect, it } from 'vitest';
import { parseExpression, parseInstructions, parseInstructionsTolerant, tokenize } from './parser';
import { evalExpr, execAssign, type RuntimeCtx } from './interp';
import { checkScript, describeSpan, type ScriptEnv } from './check';
import { renameIdentInScript, renameSeenArgInScript, rewriteProjectScripts } from './refactor';
import { normalizeProject } from '../util';
import type { Project } from '../types';

const ctx = (): RuntimeCtx => ({
  vars: { courage: 4, hasKey: true, name: 'Ada' },
  entityProps: { semelvie: { trust: 6, 信任: 3, partner: 'valentine' } },
  seen: (tn) => tn === 'intro',
});

describe('R6 词法与解析', () => {
  it('token 带精确位置', () => {
    const tokens = tokenize('a >= 10');
    expect(tokens.map((t) => [t.type, t.text, t.span.start, t.span.end])).toEqual([
      ['ident', 'a', 0, 1], ['op', '>=', 2, 4], ['number', '10', 5, 7], ['eof', '', 7, 7],
    ]);
  });

  it('解析错误定位到表达式位置', () => {
    const r1 = parseExpression('courage >');
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.issue.span).toEqual({ start: 9, end: 9 });

    const r2 = parseExpression('foo(1)');
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.issue.message).toContain('只有 seen / unseen');
      expect(r2.issue.span).toEqual({ start: 0, end: 3 });
    }

    const r3 = parseExpression('a.b.c');
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.issue.message).toContain('一层');

    expect(describeSpan('courage >', { start: 9, end: 9 })).toBe('第 10 列');
    expect(describeSpan('a = 1\nb ~', { start: 8, end: 9 })).toBe('第 2 行第 3 列');
  });

  it('中文标识符与字符串', () => {
    const r = parseExpression('semelvie.信任 > 2 && name == "Ada"');
    expect(r.ok).toBe(true);
    const broken = parseExpression('"没闭合');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.issue.message).toContain('引号');
  });

  it('宽容指令解析:坏语句不影响好语句', () => {
    const { stmts, issues } = parseInstructionsTolerant('a = 1; ~~; b += 2');
    expect(stmts).toHaveLength(2);
    expect(issues).toHaveLength(1);
    const strict = parseInstructions('a = 1; ~~; b += 2');
    expect(strict.ok).toBe(false);
  });
});

describe('R6 求值', () => {
  const evalSrc = (src: string) => {
    const r = parseExpression(src);
    if (!r.ok) throw new Error(r.issue.message);
    return evalExpr(r.value, ctx());
  };

  it('逻辑短路 / 比较 / 属性 / seen', () => {
    expect(evalSrc('courage >= 4 && hasKey')).toBe(true);
    expect(evalSrc('semelvie.trust > 5 && seen("intro")')).toBe(true);
    expect(evalSrc('unseen("ending")')).toBe(true);
    expect(evalSrc('semelvie.partner == "valentine"')).toBe(true);
    expect(evalSrc('!hasKey || courage > 100')).toBe(false);
    expect(evalSrc('"总长" + courage')).toBe('总长4');
  });

  it('运行时错误带位置', () => {
    const r = parseExpression('courage + ghost');
    if (!r.ok) throw new Error('should parse');
    try {
      evalExpr(r.value, ctx());
      throw new Error('should throw');
    } catch (e) {
      const err = e as { message: string; span?: { start: number } };
      expect(err.message).toContain('未定义的变量「ghost」');
      expect(err.span?.start).toBe(10);
    }
  });

  it('指令写实体属性', () => {
    const c = ctx();
    const r = parseInstructions('semelvie.trust += courage; done = true');
    if (!r.ok) throw new Error('should parse');
    for (const stmt of r.value) execAssign(stmt, c);
    expect(c.entityProps.semelvie.trust).toBe(10);
    expect(c.vars.done).toBe(true);
  });
});

describe('R6 类型检查', () => {
  const env: ScriptEnv = {
    vars: { courage: 'number', hasKey: 'boolean', name: 'string' },
    entities: { semelvie: { trust: 'number', partner: 'string' } },
  };

  it('未知标识符 / 实体误用 / 未知字段,位置精确', () => {
    const issues = checkScript('ghost && semelvie && semelvie.ghost', 'condition', env);
    expect(issues.map((i) => [i.severity, i.span.start])).toEqual([
      ['error', 0], ['error', 9], ['error', 30],
    ]);
    expect(issues[0].message).toContain('ghost');
    expect(issues[1].message).toContain('是实体');
    expect(issues[2].message).toContain('没有字段');
  });

  it('类型不匹配警告与合法脚本零问题', () => {
    expect(checkScript('courage >= 4 && hasKey && seen("intro")', 'condition', env)).toEqual([]);
    expect(checkScript('semelvie.trust + courage', 'number', env)).toEqual([]);
    const warn1 = checkScript('courage == name', 'condition', env);
    expect(warn1[0].severity).toBe('warning');
    const warn2 = checkScript('hasKey *= 2', 'instruction', env);
    expect(warn2.some((i) => i.severity === 'error' && i.message.includes('布尔'))).toBe(true);
    const warn3 = checkScript('newVar = 1', 'instruction', env);
    expect(warn3[0].message).toContain('临时创建');
    expect(checkScript('seen(courage)', 'condition', env)[0].message).toContain('技术名字符串');
  });
});

describe('R6 重命名联动', () => {
  it('标识符重命名跳过字段名与字符串', () => {
    expect(renameIdentInScript('trust > 1 && semelvie.trust > 2 && "trust" == name', 'trust', 'faith'))
      .toBe('faith > 1 && semelvie.trust > 2 && "trust" == name');
    expect(renameIdentInScript('semelvie.trust > 2', 'semelvie', 'sem'))
      .toBe('sem.trust > 2');
    expect(renameIdentInScript('a > 1', 'b', 'c')).toBeNull();
  });

  it('seen 参数字符串重命名', () => {
    expect(renameSeenArgInScript('seen("intro") && unseen(\'intro\') && "intro" == x', 'intro', 'opening'))
      .toBe('seen("opening") && unseen(\'opening\') && "intro" == x');
  });

  it('全项目改写覆盖流程 / 文档 / 单元', () => {
    const p = normalizeProject({ version: 1, name: 't', flows: [], updatedAt: 0 } as unknown as Project);
    p.flows = [{
      id: 'f1', name: 'F',
      nodes: [
        { id: 'n1', type: 'condition', position: { x: 0, y: 0 }, data: { title: '', text: 'flag && x > 1' } },
        {
          id: 'n2', type: 'fragment', position: { x: 0, y: 0 },
          data: {
            title: '', text: '',
            sub: {
              nodes: [{ id: 'n3', type: 'instruction', position: { x: 0, y: 0 }, data: { title: '', text: 'flag = false' } }],
              edges: [],
            },
          },
        },
        { id: 'n4', type: 'check', position: { x: 0, y: 0 }, data: { title: '', text: '', checkExpr: 'flag + 1' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', condition: 'flag', effect: 'flag = true' }],
    }];
    p.documents = [{
      id: 'd1', name: 'D', category: 'x', notes: '', createdAt: 1, updatedAt: 1,
      blocks: [{ id: 'b1', type: 'condition', text: '', condition: 'flag == true' }],
    }];
    normalizeProject(p);
    const changed = rewriteProjectScripts(p, (src) => renameIdentInScript(src, 'flag', 'door_open'));
    expect(changed).toBeGreaterThanOrEqual(6);
    expect(p.flows[0].nodes[0].data.text).toBe('door_open && x > 1');
    expect(p.flows[0].nodes[1].data.sub!.nodes[0].data.text).toBe('door_open = false');
    expect(p.flows[0].nodes[2].data.checkExpr).toBe('door_open + 1');
    expect(p.flows[0].edges[0].condition).toBe('door_open');
    expect(p.flows[0].edges[0].effect).toBe('door_open = true');
    expect(p.documents[0].blocks[0].condition).toBe('door_open == true');
    const unit = (p.units ?? []).find((u) => u.kind === 'condition' && u.text.includes('door_open'));
    expect(unit).toBeTruthy();
  });
});
