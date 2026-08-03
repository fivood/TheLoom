/**
 * 脚本语义对拍(R20-4):TS 侧跑 examples/godot-demo/script_fixture.json。
 * Godot 侧 script_conformance_test.gd 跑同一份夹具,两边必须逐条一致 ——
 * 引擎拿到的条件走向、变量终值不能因为换了运行库就变。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyInstructions, evalCondition, evalNumber, type EvalCtx, type VarValue } from '../script';

interface Fixture {
  vars: Record<string, VarValue>;
  entityProps: Record<string, Record<string, VarValue>>;
  seenTech: string[];
  conditions: { src: string; expect: boolean | null }[];
  numbers: { src: string; expect: number }[];
  instructions: {
    src: string;
    vars?: Record<string, VarValue>;
    entityProps?: Record<string, Record<string, VarValue>>;
  }[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../examples/godot-demo/script_fixture.json', import.meta.url), 'utf8'),
) as Fixture;

const makeCtx = (entityProps: Record<string, Record<string, VarValue>>): EvalCtx => ({
  seen: (tn) => fixture.seenTech.includes(tn),
  entityProps,
});

describe('R20-4 脚本语义 · 条件', () => {
  for (const item of fixture.conditions) {
    it(`${item.src} → ${item.expect}`, () => {
      const vars = { ...fixture.vars };
      const props = structuredClone(fixture.entityProps);
      expect(evalCondition(item.src, vars, makeCtx(props))).toBe(item.expect);
    });
  }
});

describe('R20-4 脚本语义 · 数值表达式', () => {
  for (const item of fixture.numbers) {
    it(`${item.src || '(空)'} → ${item.expect}`, () => {
      const vars = { ...fixture.vars };
      const props = structuredClone(fixture.entityProps);
      expect(evalNumber(item.src, vars, makeCtx(props))).toBe(item.expect);
    });
  }
});

describe('R20-4 脚本语义 · 指令', () => {
  for (const item of fixture.instructions) {
    it(item.src, () => {
      const vars = { ...fixture.vars };
      const props = structuredClone(fixture.entityProps);
      applyInstructions(item.src, vars, makeCtx(props));
      for (const [name, value] of Object.entries(item.vars ?? {})) {
        expect(`${name}=${vars[name]}`).toBe(`${name}=${value}`);
      }
      for (const [tech, fields] of Object.entries(item.entityProps ?? {})) {
        for (const [field, value] of Object.entries(fields)) {
          expect(`${tech}.${field}=${props[tech]?.[field]}`).toBe(`${tech}.${field}=${value}`);
        }
      }
    });
  }
});
