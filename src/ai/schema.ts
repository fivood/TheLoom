export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

export interface SchemaIssue {
  path: string;
  message: string;
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (expected === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'null') return value === null;
  return typeof value === expected;
}

function validate(value: unknown, schema: JsonSchema, path: string, issues: SchemaIssue[]) {
  if (schema.anyOf?.length) {
    const matched = schema.anyOf.some((candidate) => validateJsonSchema(value, candidate).length === 0);
    if (!matched) issues.push({ path, message: '不符合 anyOf 中的任何一种结构' });
    return;
  }
  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    issues.push({ path, message: `必须等于 ${JSON.stringify(schema.const)}` });
    return;
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(value, candidate))) {
    issues.push({ path, message: `必须是 ${schema.enum.map((item) => JSON.stringify(item)).join(' / ')} 之一` });
    return;
  }
  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((type) => matchesType(value, type))) {
      issues.push({ path, message: `类型应为 ${expected.join(' / ')},实际为 ${valueType(value)}` });
      return;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push({ path, message: `长度不能小于 ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push({ path, message: `长度不能大于 ${schema.maxLength}` });
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push({ path, message: `不能小于 ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push({ path, message: `不能大于 ${schema.maximum}` });
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push({ path, message: `至少需要 ${schema.minItems} 项` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push({ path, message: `最多允许 ${schema.maxItems} 项` });
    }
    if (schema.items) value.forEach((item, index) => validate(item, schema.items!, `${path}[${index}]`, issues));
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const name of schema.required ?? []) {
      if (!(name in object)) issues.push({ path: `${path}.${name}`, message: '缺少必填字段' });
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (name in object) validate(object[name], child, `${path}.${name}`, issues);
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const name of Object.keys(object)) {
        if (!known.has(name)) issues.push({ path: `${path}.${name}`, message: '不允许的字段' });
      }
    }
  }
}

export function validateJsonSchema(value: unknown, schema: JsonSchema): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  validate(value, schema, '$', issues);
  return issues;
}
