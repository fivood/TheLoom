import { auditProject } from '../audit';
import type { ProjectIssue } from '../issues';
import type {
  Project,
  ProjectQuery,
  QueryObjectType,
  VariableType,
} from '../types';
import { DOC_STATUS_LABEL } from '../types';
import { normalizeProject, resolveSub, syncNarrativeUnits, validateTechnicalName } from '../util';
import { fingerprintValue } from './context';
import { validateJsonSchema, type JsonSchema, type SchemaIssue } from './schema';

export type AiProposalTask =
  | 'query'
  | 'script-fix'
  | 'content-edit'
  | 'entity-edit'
  | 'variable-edit';

interface AiOperationBase {
  id: string;
  reason: string;
  confidence: number;
}

export interface AiSaveQueryOperation extends AiOperationBase {
  kind: 'save_query';
  queryId: string;
  name: string;
  query: ProjectQuery;
}

export interface AiUpdateEntityFieldOperation extends AiOperationBase {
  kind: 'update_entity_field';
  entityId: string;
  fieldId: string;
  value: string;
}

export interface AiUpdateDocumentBlockTextOperation extends AiOperationBase {
  kind: 'update_document_block_text';
  documentId: string;
  blockId: string;
  text: string;
}

export interface AiUpdateFlowNodeTextOperation extends AiOperationBase {
  kind: 'update_flow_node_text';
  flowId: string;
  path: string[];
  nodeId: string;
  text: string;
}

export interface AiReplaceFlowEdgeScriptOperation extends AiOperationBase {
  kind: 'replace_flow_edge_script';
  flowId: string;
  path: string[];
  edgeId: string;
  field: 'condition' | 'effect';
  value: string;
}

export interface AiReplaceFlowNodeScriptOperation extends AiOperationBase {
  kind: 'replace_flow_node_script';
  flowId: string;
  path: string[];
  nodeId: string;
  field: 'condition' | 'instruction' | 'checkExpr';
  value: string;
}

export interface AiReplaceDocumentBlockScriptOperation extends AiOperationBase {
  kind: 'replace_document_block_script';
  documentId: string;
  blockId: string;
  field: 'condition' | 'instruction';
  value: string;
}

export interface AiAddVariableOperation extends AiOperationBase {
  kind: 'add_variable';
  variableId: string;
  name: string;
  variableType: VariableType;
  value: string;
  description: string;
}

export type AiProposalOperation =
  | AiSaveQueryOperation
  | AiUpdateEntityFieldOperation
  | AiUpdateDocumentBlockTextOperation
  | AiUpdateFlowNodeTextOperation
  | AiReplaceFlowEdgeScriptOperation
  | AiReplaceFlowNodeScriptOperation
  | AiReplaceDocumentBlockScriptOperation
  | AiAddVariableOperation;

export interface AiProposal {
  version: 1;
  id: string;
  task: AiProposalTask;
  summary: string;
  baselineProjectFingerprint: string;
  contextSourceKeys: string[];
  evidenceSourceKeys: string[];
  operations: AiProposalOperation[];
  confirmations: string[];
}

export type AiValidationSeverity = 'warning' | 'blocked';

export interface AiProposalValidationIssue {
  code: string;
  severity: AiValidationSeverity;
  message: string;
  operationId?: string;
}

export interface AiProposalChange {
  operationId: string;
  kind: AiProposalOperation['kind'];
  target: string;
  before: string;
  after: string;
}

export interface AiProposalDryRun {
  status: 'pass' | 'warning' | 'blocked';
  proposal?: AiProposal;
  preview?: Project;
  changes: AiProposalChange[];
  issues: AiProposalValidationIssue[];
  metrics: {
    requestedOperations: number;
    appliedOperations: number;
    changedChars: number;
    characterDelta: number;
    addedObjects: number;
  };
}

export interface DryRunAiProposalOptions {
  selectedOperationIds?: string[];
  expectedContextSourceKeys?: string[];
  maxChangedChars?: number;
}

const ID = { type: 'string', minLength: 1, maxLength: 160 } satisfies JsonSchema;
const SHORT_TEXT = { type: 'string', maxLength: 500 } satisfies JsonSchema;
const BODY_TEXT = { type: 'string', maxLength: 50_000 } satisfies JsonSchema;
const STRING_LIST = { type: 'array', maxItems: 200, items: ID } satisfies JsonSchema;
const OP_BASE = {
  id: ID,
  reason: { type: 'string', minLength: 1, maxLength: 1_000 },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
} satisfies Record<string, JsonSchema>;

const QUERY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['objectType', 'text', 'folderId', 'attributeName', 'attributeValue', 'tags', 'status', 'references'],
  properties: {
    objectType: { type: 'string', enum: ['all', 'flow', 'entity', 'asset', 'document', 'research', 'timeline'] },
    text: SHORT_TEXT,
    folderId: ID,
    attributeName: SHORT_TEXT,
    attributeValue: SHORT_TEXT,
    tags: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 100 } },
    status: { type: 'string', enum: ['any', ...Object.keys(DOC_STATUS_LABEL)] },
    references: { type: 'string', enum: ['any', 'referenced', 'unreferenced'] },
  },
};

function operationSchema(
  kind: AiProposalOperation['kind'],
  required: string[],
  properties: Record<string, JsonSchema>,
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'id', 'reason', 'confidence', ...required],
    properties: { kind: { const: kind }, ...OP_BASE, ...properties },
  };
}

export const AI_PROPOSAL_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version', 'id', 'task', 'summary', 'baselineProjectFingerprint',
    'contextSourceKeys', 'evidenceSourceKeys', 'operations', 'confirmations',
  ],
  properties: {
    version: { const: 1 },
    id: ID,
    task: { type: 'string', enum: ['query', 'script-fix', 'content-edit', 'entity-edit', 'variable-edit'] },
    summary: { type: 'string', minLength: 1, maxLength: 2_000 },
    baselineProjectFingerprint: { type: 'string', minLength: 71, maxLength: 71 },
    contextSourceKeys: STRING_LIST,
    evidenceSourceKeys: STRING_LIST,
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: {
        anyOf: [
          operationSchema('save_query', ['queryId', 'name', 'query'], {
            queryId: ID,
            name: { type: 'string', minLength: 1, maxLength: 120 },
            query: QUERY_SCHEMA,
          }),
          operationSchema('update_entity_field', ['entityId', 'fieldId', 'value'], {
            entityId: ID, fieldId: ID, value: BODY_TEXT,
          }),
          operationSchema('update_document_block_text', ['documentId', 'blockId', 'text'], {
            documentId: ID, blockId: ID, text: BODY_TEXT,
          }),
          operationSchema('update_flow_node_text', ['flowId', 'path', 'nodeId', 'text'], {
            flowId: ID, path: STRING_LIST, nodeId: ID, text: BODY_TEXT,
          }),
          operationSchema('replace_flow_edge_script', ['flowId', 'path', 'edgeId', 'field', 'value'], {
            flowId: ID,
            path: STRING_LIST,
            edgeId: ID,
            field: { type: 'string', enum: ['condition', 'effect'] },
            value: BODY_TEXT,
          }),
          operationSchema('replace_flow_node_script', ['flowId', 'path', 'nodeId', 'field', 'value'], {
            flowId: ID,
            path: STRING_LIST,
            nodeId: ID,
            field: { type: 'string', enum: ['condition', 'instruction', 'checkExpr'] },
            value: BODY_TEXT,
          }),
          operationSchema('replace_document_block_script', ['documentId', 'blockId', 'field', 'value'], {
            documentId: ID,
            blockId: ID,
            field: { type: 'string', enum: ['condition', 'instruction'] },
            value: BODY_TEXT,
          }),
          operationSchema('add_variable', ['variableId', 'name', 'variableType', 'value', 'description'], {
            variableId: ID,
            name: { type: 'string', minLength: 1, maxLength: 64 },
            variableType: { type: 'string', enum: ['boolean', 'number', 'string'] },
            value: { type: 'string', maxLength: 10_000 },
            description: { type: 'string', maxLength: 1_000 },
          }),
        ],
      },
    },
    confirmations: { type: 'array', maxItems: 50, items: SHORT_TEXT },
  },
};

function schemaIssues(issues: SchemaIssue[]): AiProposalValidationIssue[] {
  return issues.map((issue) => ({
    code: 'schema.invalid',
    severity: 'blocked',
    message: `${issue.path}: ${issue.message}`,
  }));
}

function validateFingerprint(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

export function parseAiProposal(value: unknown): { proposal?: AiProposal; issues: AiProposalValidationIssue[] } {
  const issues = validateJsonSchema(value, AI_PROPOSAL_SCHEMA);
  if (issues.length > 0) return { issues: schemaIssues(issues) };
  const proposal = value as AiProposal;
  const semantic: AiProposalValidationIssue[] = [];
  if (!validateFingerprint(proposal.baselineProjectFingerprint)) {
    semantic.push({ code: 'schema.fingerprint', severity: 'blocked', message: '基线项目指纹格式无效' });
  }
  const operationIds = new Set<string>();
  for (const operation of proposal.operations) {
    if (operationIds.has(operation.id)) {
      semantic.push({
        code: 'schema.duplicate-operation',
        severity: 'blocked',
        message: `操作 ID 重复: ${operation.id}`,
        operationId: operation.id,
      });
    }
    operationIds.add(operation.id);
  }
  if (new Set(proposal.contextSourceKeys).size !== proposal.contextSourceKeys.length) {
    semantic.push({ code: 'schema.duplicate-context', severity: 'blocked', message: '上下文来源清单包含重复项' });
  }
  if (new Set(proposal.evidenceSourceKeys).size !== proposal.evidenceSourceKeys.length) {
    semantic.push({ code: 'schema.duplicate-evidence', severity: 'blocked', message: '依据来源清单包含重复项' });
  }
  return semantic.length > 0 ? { issues: semantic } : { proposal, issues: [] };
}

function blocked(
  code: string,
  message: string,
  operationId?: string,
): AiProposalValidationIssue {
  return { code, severity: 'blocked', message, operationId };
}

function warning(
  code: string,
  message: string,
  operationId?: string,
): AiProposalValidationIssue {
  return { code, severity: 'warning', message, operationId };
}

function issueKey(issue: ProjectIssue): string {
  return `${issue.code}\n${issue.severity}\n${issue.scope}\n${issue.objectId ?? ''}\n${issue.message}`;
}

function queryFolderIssue(p: Project, query: ProjectQuery): string | null {
  if (query.folderId === 'any' || query.folderId === 'ungrouped') return null;
  const folder = p.folders.find((item) => item.id === query.folderId);
  if (!folder) return '保存查询引用的文件夹不存在';
  const expected: Partial<Record<QueryObjectType, string>> = {
    flow: 'flow',
    entity: 'entity',
    asset: 'asset',
    document: 'document',
    research: 'research',
  };
  const module = expected[query.objectType];
  return module && folder.module !== module ? '保存查询的对象类型与文件夹模块不匹配' : null;
}

function variableValueIssue(type: VariableType, value: string): string | null {
  if (type === 'boolean' && value !== 'true' && value !== 'false') return '布尔变量默认值只能是 true 或 false';
  if (type === 'number' && (!value.trim() || !Number.isFinite(Number(value)))) return '数值变量默认值必须是有限数字';
  return null;
}

interface ApplyResult {
  change?: AiProposalChange;
  issue?: AiProposalValidationIssue;
  added?: boolean;
}

function change(operation: AiProposalOperation, target: string, before: string, after: string): ApplyResult {
  return {
    change: {
      operationId: operation.id,
      kind: operation.kind,
      target,
      before,
      after,
    },
  };
}

function applyOperation(p: Project, operation: AiProposalOperation): ApplyResult {
  if (operation.kind === 'save_query') {
    if ((p.savedQueries ?? []).some((item) => item.id === operation.queryId)) {
      return { issue: blocked('target.duplicate-id', '保存查询 ID 已存在', operation.id) };
    }
    const folderError = queryFolderIssue(p, operation.query);
    if (folderError) return { issue: blocked('target.invalid-folder', folderError, operation.id) };
    const now = p.updatedAt;
    p.savedQueries ??= [];
    p.savedQueries.push({
      id: operation.queryId,
      name: operation.name.trim(),
      query: structuredClone(operation.query),
      createdAt: now,
      updatedAt: now,
    });
    return {
      ...change(operation, `保存查询 ${operation.name}`, '', JSON.stringify(operation.query)),
      added: true,
    };
  }

  if (operation.kind === 'update_entity_field') {
    const entity = p.entities.find((item) => item.id === operation.entityId);
    const field = entity?.fields.find((item) => item.id === operation.fieldId);
    if (!entity || !field) return { issue: blocked('target.missing', '实体或已有字段不存在', operation.id) };
    const spec = (p.entityTemplates?.[entity.kind] ?? [])
      .map((item) => typeof item === 'string' ? { label: item } : item)
      .find((item) => item.label === field.label);
    if (spec?.readonly) return { issue: blocked('permission.readonly-field', `字段「${field.label}」为只读`, operation.id) };
    if (spec?.enumValues?.length && !spec.enumValues.includes(operation.value)) {
      return { issue: blocked('constraint.enum', `字段「${field.label}」的值不在模板枚举内`, operation.id) };
    }
    const before = field.value;
    field.value = operation.value;
    return change(operation, `实体 ${entity.name} · ${field.label}`, before, field.value);
  }

  if (operation.kind === 'update_document_block_text') {
    const document = p.documents.find((item) => item.id === operation.documentId);
    const block = document?.blocks.find((item) => item.id === operation.blockId);
    if (!document || !block) return { issue: blocked('target.missing', '文档或正文块不存在', operation.id) };
    const before = block.text;
    block.text = operation.text;
    return change(operation, `文档 ${document.name} · ${block.id}`, before, block.text);
  }

  if (operation.kind === 'update_flow_node_text') {
    const flow = p.flows.find((item) => item.id === operation.flowId);
    const sub = flow ? resolveSub(flow, operation.path) : null;
    const node = sub?.nodes.find((item) => item.id === operation.nodeId);
    if (!flow || !node) return { issue: blocked('target.missing', '流程、路径或节点不存在', operation.id) };
    if (node.type === 'condition' || node.type === 'instruction') {
      return { issue: blocked('permission.script-via-text', '脚本节点必须使用专用脚本操作修改', operation.id) };
    }
    const before = node.data.text;
    node.data.text = operation.text;
    return change(operation, `流程 ${flow.name} · ${node.data.title || node.id}`, before, node.data.text);
  }

  if (operation.kind === 'replace_flow_edge_script') {
    const flow = p.flows.find((item) => item.id === operation.flowId);
    const sub = flow ? resolveSub(flow, operation.path) : null;
    const edge = sub?.edges.find((item) => item.id === operation.edgeId);
    if (!flow || !edge) return { issue: blocked('target.missing', '流程、路径或连线不存在', operation.id) };
    const before = edge[operation.field] ?? '';
    edge[operation.field] = operation.value;
    return change(operation, `流程 ${flow.name} · 连线 ${edge.id} · ${operation.field}`, before, operation.value);
  }

  if (operation.kind === 'replace_flow_node_script') {
    const flow = p.flows.find((item) => item.id === operation.flowId);
    const sub = flow ? resolveSub(flow, operation.path) : null;
    const node = sub?.nodes.find((item) => item.id === operation.nodeId);
    if (!flow || !node) return { issue: blocked('target.missing', '流程、路径或节点不存在', operation.id) };
    const expected = operation.field === 'condition' ? 'condition'
      : operation.field === 'instruction' ? 'instruction' : 'check';
    if (node.type !== expected) {
      return { issue: blocked('target.wrong-node-type', `字段 ${operation.field} 不适用于 ${node.type} 节点`, operation.id) };
    }
    if (operation.field === 'checkExpr') {
      const before = typeof node.data.checkExpr === 'string' ? node.data.checkExpr : '';
      node.data.checkExpr = operation.value;
      return change(operation, `流程 ${flow.name} · ${node.data.title || node.id} · 检定`, before, operation.value);
    }
    const before = node.data.text;
    node.data.text = operation.value;
    return change(operation, `流程 ${flow.name} · ${node.data.title || node.id} · ${operation.field}`, before, operation.value);
  }

  if (operation.kind === 'replace_document_block_script') {
    const document = p.documents.find((item) => item.id === operation.documentId);
    const block = document?.blocks.find((item) => item.id === operation.blockId);
    if (!document || !block) return { issue: blocked('target.missing', '文档或脚本块不存在', operation.id) };
    if (block.type !== operation.field) {
      return { issue: blocked('target.wrong-block-type', `字段 ${operation.field} 不适用于 ${block.type} 块`, operation.id) };
    }
    const before = block[operation.field] ?? '';
    block[operation.field] = operation.value;
    return change(operation, `文档 ${document.name} · ${block.id} · ${operation.field}`, before, operation.value);
  }

  if (p.variables.some((item) => item.id === operation.variableId || item.name === operation.name)) {
    return { issue: blocked('target.duplicate-variable', '变量 ID 或名称已存在', operation.id) };
  }
  const nameError = validateTechnicalName(operation.name);
  if (nameError) return { issue: blocked('constraint.variable-name', nameError, operation.id) };
  const valueError = variableValueIssue(operation.variableType, operation.value);
  if (valueError) return { issue: blocked('constraint.variable-value', valueError, operation.id) };
  p.variables.push({
    id: operation.variableId,
    name: operation.name,
    type: operation.variableType,
    value: operation.value,
    description: operation.description,
  });
  return {
    ...change(operation, `变量 ${operation.name}`, '', `${operation.variableType} = ${operation.value}`),
    added: true,
  };
}

function contextIssues(proposal: AiProposal, expected?: string[]): AiProposalValidationIssue[] {
  if (!expected) return [];
  const allowed = new Set(expected);
  const issues: AiProposalValidationIssue[] = [];
  for (const key of proposal.contextSourceKeys) {
    if (!allowed.has(key)) issues.push(blocked('context.unknown-source', `提案声明了未发送的上下文来源: ${key}`));
  }
  for (const key of proposal.evidenceSourceKeys) {
    if (!allowed.has(key)) issues.push(blocked('context.unknown-evidence', `提案引用了未发送的依据来源: ${key}`));
  }
  return issues;
}

export async function dryRunAiProposal(
  project: Project,
  rawProposal: unknown,
  options: DryRunAiProposalOptions = {},
): Promise<AiProposalDryRun> {
  const parsed = parseAiProposal(rawProposal);
  const emptyMetrics = {
    requestedOperations: 0,
    appliedOperations: 0,
    changedChars: 0,
    characterDelta: 0,
    addedObjects: 0,
  };
  if (!parsed.proposal) {
    return { status: 'blocked', changes: [], issues: parsed.issues, metrics: emptyMetrics };
  }

  const proposal = parsed.proposal;
  const issues = [...contextIssues(proposal, options.expectedContextSourceKeys)];
  const currentFingerprint = await fingerprintValue(project);
  if (currentFingerprint !== proposal.baselineProjectFingerprint) {
    issues.push(blocked('baseline.stale', '项目已在提案生成后发生变化，请重新生成或重新验证提案'));
  }
  const selected = options.selectedOperationIds
    ? new Set(options.selectedOperationIds)
    : new Set(proposal.operations.map((operation) => operation.id));
  const knownIds = new Set(proposal.operations.map((operation) => operation.id));
  for (const id of selected) {
    if (!knownIds.has(id)) issues.push(blocked('selection.unknown-operation', `选择了不存在的操作: ${id}`));
  }
  const operations = proposal.operations.filter((operation) => selected.has(operation.id));
  if (operations.length === 0) issues.push(blocked('selection.empty', '没有选择可试运行的操作'));

  const preview = structuredClone(project);
  const beforeIssues = new Set(auditProject(project).map(issueKey));
  const changes: AiProposalChange[] = [];
  let addedObjects = 0;
  for (const operation of operations) {
    const result = applyOperation(preview, operation);
    if (result.issue) issues.push(result.issue);
    if (result.change) changes.push(result.change);
    if (result.added) addedObjects++;
  }

  if (!issues.some((issue) => issue.severity === 'blocked')) {
    syncNarrativeUnits(preview, project);
    normalizeProject(preview);
    const afterIssues = auditProject(preview).filter((issue) => !beforeIssues.has(issueKey(issue)));
    for (const issue of afterIssues) {
      issues.push(issue.severity === 'error'
        ? blocked('audit.new-error', `${issue.kind}: ${issue.message}`)
        : warning('audit.new-warning', `${issue.kind}: ${issue.message}`));
    }
  }

  const changedChars = changes.reduce((total, item) => {
    let prefix = 0;
    while (prefix < item.before.length && prefix < item.after.length && item.before[prefix] === item.after[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < item.before.length - prefix
      && suffix < item.after.length - prefix
      && item.before[item.before.length - 1 - suffix] === item.after[item.after.length - 1 - suffix]
    ) suffix++;
    return total + item.before.length - prefix - suffix + item.after.length - prefix - suffix;
  }, 0);
  const characterDelta = changes.reduce((total, item) => total + item.after.length - item.before.length, 0);
  if (changedChars > (options.maxChangedChars ?? 100_000)) {
    issues.push(blocked('limit.changed-characters', `改动字符数 ${changedChars} 超过安全上限`));
  }
  for (const operation of operations) {
    if (operation.confidence < 0.5) {
      issues.push(warning('confidence.low', `操作信心较低: ${operation.confidence}`, operation.id));
    }
  }

  const status = issues.some((issue) => issue.severity === 'blocked')
    ? 'blocked'
    : issues.some((issue) => issue.severity === 'warning') ? 'warning' : 'pass';
  return {
    status,
    proposal,
    preview: status === 'blocked' ? undefined : preview,
    changes,
    issues,
    metrics: {
      requestedOperations: operations.length,
      appliedOperations: changes.length,
      changedChars,
      characterDelta,
      addedObjects,
    },
  };
}
