import { LlmRequestError, type LlmClient, type LlmUsage } from './llm';
import { queryProject, type QueryHit } from '../query';
import type { FolderModule, Project, ProjectQuery, QueryObjectType } from '../types';
import type { JsonSchema } from './schema';

interface RawQueryInterpretation {
  query: ProjectQuery;
  explanation: string;
  suggestedName: string;
}

export interface AiQueryInterpretation extends RawQueryInterpretation {
  hits: QueryHit[];
  usage?: LlmUsage;
  requestId?: string;
}

export const AI_PROJECT_QUERY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'explanation', 'suggestedName'],
  properties: {
    query: {
      type: 'object',
      additionalProperties: false,
      required: ['objectType', 'text', 'folderId', 'attributeName', 'attributeValue', 'tags', 'status', 'references'],
      properties: {
        objectType: { type: 'string', enum: ['all', 'flow', 'entity', 'asset', 'document', 'research', 'timeline'] },
        text: { type: 'string', maxLength: 500 },
        folderId: { type: 'string', minLength: 1, maxLength: 160 },
        attributeName: { type: 'string', maxLength: 200 },
        attributeValue: { type: 'string', maxLength: 500 },
        tags: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 100 } },
        status: { type: 'string', enum: ['any', 'outline', 'draft', 'revising', 'done'] },
        references: { type: 'string', enum: ['any', 'referenced', 'unreferenced'] },
      },
    },
    explanation: { type: 'string', minLength: 1, maxLength: 2_000 },
    suggestedName: { type: 'string', minLength: 1, maxLength: 100 },
  },
};

const FOLDER_MODULE: Partial<Record<QueryObjectType, FolderModule>> = {
  flow: 'flow',
  entity: 'entity',
  asset: 'asset',
  document: 'document',
  research: 'research',
};

function validateFolder(project: Project, query: ProjectQuery): string | null {
  if (query.folderId === 'any' || query.folderId === 'ungrouped') return null;
  const folder = project.folders.find((item) => item.id === query.folderId);
  if (!folder) return `模型返回了不存在的文件夹 ID: ${query.folderId}`;
  const expected = FOLDER_MODULE[query.objectType];
  if (expected && folder.module !== expected) return `文件夹「${folder.name}」不属于 ${query.objectType} 模块`;
  return null;
}

function schemaSummary(project: Project): string {
  const folders = project.folders.map((folder) =>
    `- ${folder.name} | id=${folder.id} | module=${folder.module}`).join('\n');
  return [
    '可查询对象类型:all, flow, entity, asset, document, research, timeline',
    '可用字段:',
    '- text:名称、正文、技术名等全文包含',
    '- attributeName / attributeValue:索引中的属性名和值',
    '- tags:资源或资料标签，必须全部匹配',
    '- status:any / outline / draft / revising / done，仅文档有效',
    '- references:any / referenced / unreferenced',
    '- folderId:any / ungrouped / 下列真实文件夹 ID',
    folders || '- 当前项目没有文件夹',
  ].join('\n');
}

export async function interpretProjectQuery(
  client: LlmClient,
  project: Project,
  request: string,
  signal?: AbortSignal,
): Promise<AiQueryInterpretation> {
  const response = await client.structuredComplete<RawQueryInterpretation>({
    schemaName: 'theloom_project_query',
    schema: AI_PROJECT_QUERY_SCHEMA,
    signal,
    temperature: 0,
    system: [
      '把用户的自然语言查找要求转换为 TheLoom ProjectQuery。',
      '只能使用给出的查询字段和真实文件夹 ID，不得捏造字段、对象 ID 或结果。',
      '只负责生成查询条件；查询将在本地执行。',
    ].join('\n'),
    user: `查找要求:\n${request.trim()}\n\n本地查询能力:\n${schemaSummary(project)}`,
  });
  const folderError = validateFolder(project, response.data.query);
  if (folderError) throw new LlmRequestError(folderError, 'invalid_response', false);
  return {
    ...response.data,
    query: structuredClone(response.data.query),
    hits: queryProject(project, response.data.query),
    usage: response.usage,
    requestId: response.requestId,
  };
}
