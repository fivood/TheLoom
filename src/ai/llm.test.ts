import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chatComplete, structuredComplete, type LlmConfig,
} from './llm';
import type { JsonSchema } from './schema';

const resultSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: 'string', minLength: 1 } },
};

const config = (provider: LlmConfig['provider']): LlmConfig => ({
  provider,
  baseUrl: provider === 'ollama' ? 'http://localhost:11434' : `https://${provider}.example`,
  apiKey: 'secret',
  model: 'test-model',
});

const jsonResponse = (data: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI Provider 结构化输出', () => {
  it('OpenAI 兼容使用严格 JSON Schema 并读取 usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"answer":"完成"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }, 200, { 'x-request-id': 'req-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await structuredComplete<{ answer: string }>(config('openai'), {
      schemaName: 'assistant_result',
      schema: resultSchema,
      user: '分析',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'assistant_result', strict: true },
    });
    expect(result).toMatchObject({
      data: { answer: '完成' },
      mode: 'native',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      requestId: 'req-1',
    });
  });

  it('Anthropic 使用强制 client tool 返回结构对象', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      content: [{ type: 'tool_use', name: 'assistant_result', input: { answer: '完成' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 8, output_tokens: 3 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await structuredComplete<{ answer: string }>(config('anthropic'), {
      schemaName: 'assistant_result',
      schema: resultSchema,
      user: '分析',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(body.tools[0]).toMatchObject({ name: 'assistant_result', input_schema: resultSchema });
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'assistant_result', disable_parallel_tool_use: true });
    expect(result.usage?.totalTokens).toBe(11);
    expect(result.data.answer).toBe('完成');
  });

  it('Ollama 把 JSON Schema 放入 format 并读取计数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      message: { content: '{"answer":"本地完成"}' },
      prompt_eval_count: 12,
      eval_count: 5,
      done_reason: 'stop',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await structuredComplete<{ answer: string }>(config('ollama'), {
      schemaName: 'assistant_result',
      schema: resultSchema,
      user: '分析',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(body.format).toEqual(resultSchema);
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17 });
    expect(result.data.answer).toBe('本地完成');
  });

  it('兼容网关不支持原生 schema 时降级,但仍做本地校验', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'unsupported response_format' }, 400))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: '```json\n{"answer":"降级完成"}\n```' } }],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await structuredComplete<{ answer: string }>(config('openai'), {
      schemaName: 'assistant_result',
      schema: resultSchema,
      user: '分析',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ data: { answer: '降级完成' }, mode: 'fallback' });
  });

  it('服务端返回的结构仍必须通过本地校验', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"wrong":true}' } }],
    })));

    await expect(structuredComplete(config('openai'), {
      schemaName: 'assistant_result',
      schema: resultSchema,
      user: '分析',
    })).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('取消请求返回不可重试的 cancelled 错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));

    await expect(chatComplete(config('openai'), {
      user: '分析',
      signal: new AbortController().signal,
    })).rejects.toEqual(expect.objectContaining({
      kind: 'cancelled',
      retryable: false,
    }));
  });
});
