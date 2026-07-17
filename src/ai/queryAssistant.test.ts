import { describe, expect, it } from 'vitest';
import { sampleProject } from '../sample';
import { LlmRequestError } from './llm';
import { MockLlmClient } from './mock';
import { interpretProjectQuery } from './queryAssistant';

function response(folderId = 'any') {
  return {
    query: {
      objectType: 'document',
      text: '',
      folderId,
      attributeName: '状态',
      attributeValue: '草稿',
      tags: [],
      status: 'draft',
      references: 'any',
    },
    explanation: '查找所有草稿文档',
    suggestedName: '草稿文档',
  };
}

describe('AI 自然语言组合查询', () => {
  it('模型只生成条件，结果由本地 queryProject 执行', async () => {
    const project = sampleProject();
    const client = new MockLlmClient([{ type: 'structured', data: response(), usage: { totalTokens: 20 } }]);

    const result = await interpretProjectQuery(client, project, '找出仍是草稿的文档');

    expect(result.query.objectType).toBe('document');
    expect(result.hits.every((hit) => hit.objectType === 'document')).toBe(true);
    expect(result.hits.every((hit) => hit.status === 'draft')).toBe(true);
    expect(result.usage?.totalTokens).toBe(20);
  });

  it('拒绝模型捏造的文件夹 ID', async () => {
    const project = sampleProject();
    const client = new MockLlmClient([{ type: 'structured', data: response('invented-folder') }]);

    await expect(interpretProjectQuery(client, project, '某个文件夹里的草稿')).rejects.toBeInstanceOf(LlmRequestError);
    await expect(interpretProjectQuery(
      new MockLlmClient([{ type: 'structured', data: response('invented-folder') }]),
      project,
      '某个文件夹里的草稿',
    )).rejects.toMatchObject({ kind: 'invalid_response', retryable: false });
  });

  it('发送给模型的只有查询能力与文件夹目录，不包含项目正文', async () => {
    const project = sampleProject();
    project.documents[0].notes = '绝不能发送的正文标记';
    const client = new MockLlmClient([{ type: 'structured', data: response() }]);

    await interpretProjectQuery(client, project, '查找草稿');

    expect(client.calls[0].request.user).not.toContain('绝不能发送的正文标记');
    expect(client.calls[0].request.user).toContain('本地查询能力');
  });
});
