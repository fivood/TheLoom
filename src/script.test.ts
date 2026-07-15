import { describe, expect, it } from 'vitest';
import {
  applyInstructions, coerceScalar, coerceVar, evalCondition, evalNumber,
  type EvalCtx, type VarValue,
} from './script';

const context: EvalCtx = {
  seen: (name) => name === 'intro',
  entityProps: {
    semelvie: { trust: 6, active: true, partner: 'valentine' },
  },
};

describe('脚本表达式', () => {
  it('支持变量、实体属性和 seen/unseen', () => {
    const vars = { courage: 4, hasKey: true };
    expect(evalCondition('courage >= 4 && hasKey', vars, context)).toBe(true);
    expect(evalCondition('semelvie.trust > 5 && seen("intro")', vars, context)).toBe(true);
    expect(evalCondition('unseen("ending")', vars, context)).toBe(true);
  });

  it('对空白或损坏表达式安全回落', () => {
    expect(evalCondition('', {}, context)).toBeNull();
    expect(evalCondition('missing +', {}, context)).toBeNull();
    expect(evalNumber('1 / 0', {}, context)).toBe(0);
    expect(evalNumber('missing', {}, context)).toBe(0);
  });

  it('计算有限数值结果', () => {
    expect(evalNumber('semelvie.trust + skill', { skill: 2 }, context)).toBe(8);
  });
});

describe('脚本指令', () => {
  it('执行赋值、算术、变量引用与文本', () => {
    const vars: Record<string, VarValue> = { score: 2, bonus: 3 };
    const warnings = applyInstructions('score += bonus; score *= 2\nname = "Ada"; ready = true', vars);

    expect(warnings).toEqual([]);
    expect(vars).toEqual({ score: 10, bonus: 3, name: 'Ada', ready: true });
  });

  it('保留除零前的值并报告无法解析的指令', () => {
    const vars: Record<string, VarValue> = { score: 8 };
    const warnings = applyInstructions('score /= 0; score += unknown; bad statement', vars);

    expect(vars.score).toBe(8);
    expect(warnings).toEqual(['未知的值:score += unknown', '无法解析:bad statement']);
  });

  it('按变量和实体字段规则转换标量', () => {
    expect(coerceVar('number', 'not-number')).toBe(0);
    expect(coerceVar('boolean', 'true')).toBe(true);
    expect(coerceScalar(' 12.5 ')).toBe(12.5);
    expect(coerceScalar('false')).toBe(false);
    expect(coerceScalar(' London ')).toBe('London');
  });
});
