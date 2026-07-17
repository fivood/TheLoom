import { describe, expect, it } from 'vitest';
import { LlmRequestError } from './llm';
import { MockLlmClient } from './mock';
import type { JsonSchema } from './schema';

const schema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: 'string', minLength: 1 } },
};

describe('可编程 Mock LLM', () => {
  it('按顺序返回文本和结构化结果并记录调用', async () => {
    const client = new MockLlmClient([
      { type: 'text', text: 'OK' },
      {
        type: 'structured',
        data: { answer: '完成' },
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        requestId: 'mock-1',
      },
    ]);

    expect(await client.chatComplete({ user: 'ping' })).toBe('OK');
    const result = await client.structuredComplete<{ answer: string }>({
      user: '回答',
      schemaName: 'answer',
      schema,
    });

    expect(result.data).toEqual({ answer: '完成' });
    expect(result.usage?.totalTokens).toBe(12);
    expect(result.requestId).toBe('mock-1');
    expect(client.calls.map((call) => call.kind)).toEqual(['text', 'structured']);
    expect(client.remainingSteps).toBe(0);
  });

  it('结构化结果仍执行本地 Schema 校验', async () => {
    const client = new MockLlmClient([{ type: 'structured', data: { answer: '', extra: true } }]);

    await expect(client.structuredComplete({
      user: '回答',
      schemaName: 'answer',
      schema,
    })).rejects.toMatchObject({
      name: 'LlmRequestError',
      kind: 'invalid_response',
      retryable: false,
    });
  });

  it('可模拟限流错误并保留重试分类', async () => {
    const client = new MockLlmClient([{
      type: 'error',
      message: '请求过多',
      kind: 'rate_limit',
      retryable: true,
      status: 429,
    }]);

    await expect(client.chatComplete({ user: 'ping' })).rejects.toMatchObject({
      kind: 'rate_limit',
      retryable: true,
      status: 429,
    });
  });

  it('延迟响应支持 AbortSignal 取消', async () => {
    const controller = new AbortController();
    const client = new MockLlmClient([{ type: 'text', text: '迟到', delayMs: 1_000 }]);
    const pending = client.chatComplete({ user: '等待', signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(LlmRequestError);
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });
});
