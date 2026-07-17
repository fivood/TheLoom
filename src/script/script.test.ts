import { describe, expect, it } from 'vitest';
import { lex } from './lexer';
import { parseExpression, parseInstructions } from './parser';
import { checkCondition, checkInstructions, checkNumberExpr, type ScriptScope } from './check';
import { evalExpr, runStmt, type Env } from './eval';
import { renameEntityField, renameIdentifier, renameSeenTarget } from './rename';
import { applyInstructions, evalCondition, evalNumber } from '../script';

function env(vars: Env['vars'] = {}, entityProps: Env['entityProps'] = {}, seenSet: string[] = []): Env {
  return { vars, entityProps, seen: (tn) => seenSet.includes(tn) };
}

function scope(vars: Record<string, 'boolean' | 'number' | 'text' | 'unknown'> = {}, entities: Record<string, Record<string, 'boolean' | 'number' | 'text' | 'unknown'>> = {}, nodeTechNames?: string[]): ScriptScope {
  return {
    vars: new Map(Object.entries(vars)),
    entities: new Map(Object.entries(entities).map(([k, v]) => [k, new Map(Object.entries(v))])),
    nodeTechNames: nodeTechNames ? new Set(nodeTechNames) : undefined,
  };
}

describe('lexer', () => {
  it('中文标识符 / 字符串 / 运算符 / 位置', () => {
    const ts = lex('semelvie.信任 >= 5 && seen("x_1")');
    expect(ts.map((t) => t.kind)).toEqual([
      'ident', 'punct', 'ident', 'op', 'number', 'op', 'ident', 'punct', 'string', 'punct',
    ]);
    expect(ts[2].value).toBe('信任');
    expect(ts[8].value).toBe('x_1');
    expect(ts[3]).toMatchObject({ value: '>=', start: 12, end: 14 });
  });

  it('未闭合字符串与非法字符出 error token', () => {
    expect(lex('"abc').some((t) => t.kind === 'error')).toBe(true);
    expect(lex('a @ b').some((t) => t.kind === 'error')).toBe(true);
  });
});

describe('parser', () => {
  it('优先级与括号', () => {
    const { ast } = parseExpression('1 + 2 * 3 == 7');
    expect(ast).toMatchObject({ kind: 'binary', op: '==' });
    const { ast: ast2 } = parseExpression('(1 + 2) * 3');
    expect(ast2).toMatchObject({ kind: 'binary', op: '*' });
  });

  it('语法错误带精确位置', () => {
    const { ast, diagnostics } = parseExpression('trust >= ');
    expect(ast).toBeNull();
    expect(diagnostics[0].message).toContain('不完整');
    const { diagnostics: d2 } = parseExpression('a b');
    expect(d2[0]).toMatchObject({ start: 2, end: 3 });
  });

  it('指令列表:分号 / 换行分隔,单条错误不拖累其他', () => {
    const { stmts, diagnostics } = parseInstructions('a = 1; b += 2\nc = ??\nd.字段 = "x"');
    expect(stmts).toHaveLength(3);
    expect(stmts[2]).toMatchObject({ target: { kind: 'member', obj: 'd', prop: '字段' } });
    expect(diagnostics).toHaveLength(1);
  });
});

describe('type check', () => {
  const sc = scope(
    { trust: 'number', met: 'boolean', title: 'text' },
    { sem: { 信任: 'unknown', friend: 'text' } },
    ['n1'],
  );

  it('未定义变量 / 实体 / 字段,位置精确', () => {
    const d = checkCondition('ghost > 1', sc);
    expect(d[0]).toMatchObject({ message: '未定义的变量「ghost」', start: 0, end: 5 });
    expect(checkCondition('sem.血型 == "A"', sc)[0].severity).toBe('warning');
    expect(checkCondition('nobody.x == 1', sc)[0].message).toContain('未定义的实体技术名');
  });

  it('类型规则:大小比较要数字,条件要布尔', () => {
    expect(checkCondition('met > 3', sc)[0].message).toContain('大小比较需要数字');
    expect(checkCondition('trust + 1', sc)[0].message).toContain('条件结果应为布尔值');
    expect(checkCondition('trust >= 5 && met', sc)).toHaveLength(0);
    expect(checkNumberExpr('trust > 5', sc)[0].message).toContain('应为数字表达式');
    expect(checkNumberExpr('trust * 2 + 1', sc)).toHaveLength(0);
  });

  it('seen 校验参数与技术名存在性', () => {
    expect(checkCondition('seen("n1")', sc)).toHaveLength(0);
    expect(checkCondition('seen("nope")', sc)[0].severity).toBe('warning');
    expect(checkCondition('seen(trust)', sc)[0].message).toContain('字符串字面量');
  });

  it('指令检查:目标存在性与复合赋值类型', () => {
    expect(checkInstructions('trust += 1; met = true', sc)).toHaveLength(0);
    expect(checkInstructions('ghost = 1', sc)[0].message).toContain('未定义的变量');
    expect(checkInstructions('title += 1', sc)[0].message).toContain('只能用于数字');
    expect(checkInstructions('met = 3', sc)[0].message).toContain('类型不匹配');
    expect(checkInstructions('sem.信任 = trust + 1', sc)).toHaveLength(0);
  });
});

describe('interpreter', () => {
  it('逻辑 / 比较 / 算术 / 三元 / seen / 属性', () => {
    const e = env({ trust: 6, met: true }, { sem: { 信任: 7, friend: 'val' } }, ['n1']);
    const run = (src: string) => evalExpr(parseExpression(src).ast!, e);
    expect(run('trust >= 5 && met')).toBe(true);
    expect(run('sem.信任 + trust')).toBe(13);
    expect(run('sem.friend == "val"')).toBe(true);
    expect(run('seen("n1") && unseen("n2")')).toBe(true);
    expect(run('trust > 10 ? "a" : "b"')).toBe('b');
    expect(run('"分" + trust')).toBe('分6');
    expect(run('10 / 0')).toBe(0);
    expect(run('"5" == 5')).toBe(true);
    expect(run('"5" === 5')).toBe(false);
  });

  it('运行错误可捕获(未定义变量)', () => {
    expect(() => evalExpr(parseExpression('ghost + 1').ast!, env())).toThrow('未定义的变量');
  });

  it('指令执行:变量与实体字段读写', () => {
    const e = env({ trust: 1 }, { sem: { 信任: 2 } });
    const { stmts } = parseInstructions('trust += sem.信任; sem.信任 = trust * 10; fresh = "新"');
    for (const s of stmts) runStmt(s, e);
    expect(e.vars.trust).toBe(3);
    expect(e.entityProps.sem.信任).toBe(30);
    expect(e.vars.fresh).toBe('新');
  });
});

describe('门面兼容(旧 API 语义)', () => {
  const ctx = { seen: () => false, entityProps: { sem: { 信任: 7 } } };

  it('evalCondition:空 / 错误返回 null,正常返回布尔', () => {
    expect(evalCondition('', {}, ctx)).toBeNull();
    expect(evalCondition('ghost > 1', {}, ctx)).toBeNull();
    expect(evalCondition('sem.信任 > 5', {}, ctx)).toBe(true);
  });

  it('evalNumber:失败回 0', () => {
    expect(evalNumber('sem.信任 - 2', {}, ctx)).toBe(5);
    expect(evalNumber('oops +', {}, ctx)).toBe(0);
    expect(evalNumber(undefined, {}, ctx)).toBe(0);
  });

  it('applyInstructions:旧调用(无 ctx)与新实体写', () => {
    const vars: Record<string, boolean | number | string> = { gold: 10 };
    expect(applyInstructions('gold += 5; flag = true', vars)).toHaveLength(0);
    expect(vars.gold).toBe(15);
    expect(vars.flag).toBe(true);

    const props = { sem: { 信任: 1 } };
    const warns = applyInstructions('sem.信任 += 2; ?? = 1', vars, { seen: () => false, entityProps: props });
    expect(props.sem.信任).toBe(3);
    expect(warns).toHaveLength(1);
  });
});

describe('rename 联动重写', () => {
  it('变量 / 实体技术名:跳过字段位与字符串', () => {
    expect(renameIdentifier('trust >= 5 && sem.trust == trust', 'trust', 'faith'))
      .toBe('faith >= 5 && sem.trust == faith');
    expect(renameIdentifier('seen("trust") || trust > 1', 'trust', 'faith'))
      .toBe('seen("trust") || faith > 1');
    expect(renameIdentifier('sem.x = 1', 'sem', 'semel')).toBe('semel.x = 1');
  });

  it('实体字段:只改指定实体的字段', () => {
    expect(renameEntityField('sem.信任 > 5 && other.信任 == 1 && 信任 > 0', 'sem', '信任', '好感'))
      .toBe('sem.好感 > 5 && other.信任 == 1 && 信任 > 0');
  });

  it('seen 目标:只改 seen/unseen 的字符串参数', () => {
    expect(renameSeenTarget("seen('n1') && unseen(\"n1\") && x == 'n1'", 'n1', 'n2'))
      .toBe("seen('n2') && unseen(\"n2\") && x == 'n1'");
  });
});
