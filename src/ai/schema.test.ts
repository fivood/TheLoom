import { describe, expect, it } from 'vitest';
import { validateJsonSchema, type JsonSchema } from './schema';

const schema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'items'],
  properties: {
    name: { type: 'string', minLength: 1 },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'score'],
        properties: {
          kind: { type: 'string', enum: ['fact', 'idea'] },
          score: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

describe('AI JSON Schema 本地校验', () => {
  it('接受符合约束的嵌套结果', () => {
    expect(validateJsonSchema({
      name: '分析结果',
      items: [{ kind: 'fact', score: 0.8 }],
    }, schema)).toEqual([]);
  });

  it('报告缺失、枚举、范围和额外字段', () => {
    const issues = validateJsonSchema({
      name: '',
      items: [{ kind: 'guess', score: 2, extra: true }],
      unknown: true,
    }, schema);
    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      '$.name',
      '$.items[0].kind',
      '$.items[0].score',
      '$.items[0].extra',
      '$.unknown',
    ]));
  });

  it('支持 anyOf 和 nullable 类型', () => {
    const union: JsonSchema = {
      anyOf: [
        { type: 'string', minLength: 2 },
        { type: ['number', 'null'] },
      ],
    };
    expect(validateJsonSchema(null, union)).toEqual([]);
    expect(validateJsonSchema('好', union)).not.toEqual([]);
    expect(validateJsonSchema('很好', union)).toEqual([]);
  });
});
