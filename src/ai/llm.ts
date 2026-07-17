/**
 * LLM 服务层:本地优先,三种可切换后端,零第三方依赖(原生 fetch)。
 * API Key 只存 localStorage(本浏览器 / 本机),不写入项目数据,不随云协作同步。
 */

import { validateJsonSchema, type JsonSchema, type SchemaIssue } from './schema';

export type LlmProvider = 'openai' | 'anthropic' | 'ollama';

export interface LlmConfig {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  openai: 'OpenAI 兼容 API',
  anthropic: 'Anthropic',
  ollama: 'Ollama(本地)',
};

export const PROVIDER_DEFAULTS: Record<LlmProvider, Omit<LlmConfig, 'apiKey'>> = {
  openai: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-4-8' },
  ollama: { provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3:8b' },
};

const CONFIG_KEY = 'theloom-llm-v1';

export function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LlmConfig>;
      const provider: LlmProvider = parsed.provider === 'anthropic' || parsed.provider === 'ollama' ? parsed.provider : 'openai';
      const defaults = PROVIDER_DEFAULTS[provider];
      return {
        provider,
        baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? parsed.baseUrl : defaults.baseUrl,
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
        model: typeof parsed.model === 'string' && parsed.model ? parsed.model : defaults.model,
      };
    }
  } catch { /* 忽略损坏配置 */ }
  return { ...PROVIDER_DEFAULTS.openai, apiKey: '' };
}

export function saveLlmConfig(cfg: LlmConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export interface ChatRequest {
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export type LlmErrorKind = 'cancelled' | 'auth' | 'rate_limit' | 'unsupported' | 'server' | 'request' | 'network' | 'invalid_response';

export class LlmRequestError extends Error {
  constructor(
    message: string,
    public readonly kind: LlmErrorKind,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmRequestError';
  }
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface StructuredRequest extends ChatRequest {
  schemaName: string;
  schema: JsonSchema;
  allowFallback?: boolean;
}

export interface StructuredResponse<T> {
  data: T;
  mode: 'native' | 'fallback';
  usage?: LlmUsage;
  stopReason?: string;
  requestId?: string;
}

function classifyStatus(status: number): { kind: LlmErrorKind; retryable: boolean } {
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false };
  if (status === 429) return { kind: 'rate_limit', retryable: true };
  if (status === 400 || status === 404 || status === 415 || status === 422) return { kind: 'unsupported', retryable: false };
  if (status >= 500) return { kind: 'server', retryable: true };
  return { kind: 'request', retryable: false };
}

async function requestJson(provider: string, url: string, init: RequestInit): Promise<{ data: unknown; response: Response }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new LlmRequestError('请求已取消', 'cancelled', false);
    }
    throw new LlmRequestError(`${provider} 网络请求失败:${error instanceof Error ? error.message : String(error)}`, 'network', true);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    const classified = classifyStatus(response.status);
    throw new LlmRequestError(`${provider} ${response.status}:${detail}`, classified.kind, classified.retryable, response.status);
  }
  try {
    return { data: await response.json(), response };
  } catch {
    throw new LlmRequestError(`${provider} 返回的不是有效 JSON`, 'invalid_response', false, response.status);
  }
}

/** 单轮补全:按配置分发到对应后端,返回纯文本 */
export async function chatComplete(cfg: LlmConfig, req: ChatRequest): Promise<string> {
  const maxTokens = req.maxTokens ?? 16000;
  if (cfg.provider === 'anthropic') {
    const { data: raw } = await requestJson('Anthropic', `${trimSlash(cfg.baseUrl)}/v1/messages`, {
      method: 'POST',
      signal: req.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: 'user', content: req.user }],
      }),
    });
    const data = raw as { content?: { type: string; text?: string }[]; stop_reason?: string };
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    if (!text) throw new LlmRequestError(`模型没有返回文本(stop_reason: ${data.stop_reason ?? '未知'})`, 'invalid_response', false);
    return text;
  }
  if (cfg.provider === 'ollama') {
    const { data: raw } = await requestJson('Ollama', `${trimSlash(cfg.baseUrl)}/api/chat`, {
      method: 'POST',
      signal: req.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        options: {
          num_predict: maxTokens,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          { role: 'user', content: req.user },
        ],
      }),
    });
    const data = raw as { message?: { content?: string } };
    const text = data.message?.content ?? '';
    if (!text) throw new LlmRequestError('Ollama 没有返回文本', 'invalid_response', false);
    return text;
  }
  // OpenAI 兼容(OpenAI / DeepSeek / Moonshot / SiliconFlow / 任意自建网关)
  const { data: raw } = await requestJson('API', `${trimSlash(cfg.baseUrl)}/chat/completions`, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.user },
      ],
    }),
  });
  const data = raw as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new LlmRequestError('模型没有返回文本', 'invalid_response', false);
  return text;
}

function usageFrom(raw: Record<string, unknown>, provider: LlmProvider): LlmUsage | undefined {
  if (provider === 'ollama') {
    const inputTokens = typeof raw.prompt_eval_count === 'number' ? raw.prompt_eval_count : undefined;
    const outputTokens = typeof raw.eval_count === 'number' ? raw.eval_count : undefined;
    return inputTokens === undefined && outputTokens === undefined
      ? undefined
      : { inputTokens, outputTokens, totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0) };
  }
  const usage = raw.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;
  if (provider === 'anthropic') {
    const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined;
    const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined;
    return { inputTokens, outputTokens, totalTokens: inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined };
  }
  return {
    inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
    totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
  };
}

function ensureStructured<T>(value: unknown, schema: JsonSchema): T {
  const issues = validateJsonSchema(value, schema);
  if (issues.length) {
    const detail = issues.slice(0, 5).map((issue: SchemaIssue) => `${issue.path}:${issue.message}`).join('; ');
    throw new LlmRequestError(`模型输出未通过本地结构校验:${detail}`, 'invalid_response', false);
  }
  return value as T;
}

async function nativeStructured<T>(cfg: LlmConfig, req: StructuredRequest): Promise<StructuredResponse<T>> {
  const maxTokens = req.maxTokens ?? 16000;
  if (cfg.provider === 'anthropic') {
    const { data: unknownData, response } = await requestJson('Anthropic', `${trimSlash(cfg.baseUrl)}/v1/messages`, {
      method: 'POST',
      signal: req.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: 'user', content: req.user }],
        tools: [{
          name: req.schemaName,
          description: '返回符合指定结构的最终结果。只在准备好最终答案时调用。',
          input_schema: req.schema,
        }],
        tool_choice: { type: 'tool', name: req.schemaName, disable_parallel_tool_use: true },
      }),
    });
    const data = unknownData as Record<string, unknown>;
    const content = Array.isArray(data.content) ? data.content as Record<string, unknown>[] : [];
    const tool = content.find((block) => block.type === 'tool_use' && block.name === req.schemaName);
    if (!tool) throw new LlmRequestError('Anthropic 没有返回要求的结构化工具结果', 'invalid_response', false);
    return {
      data: ensureStructured<T>(tool.input, req.schema),
      mode: 'native',
      usage: usageFrom(data, cfg.provider),
      stopReason: typeof data.stop_reason === 'string' ? data.stop_reason : undefined,
      requestId: response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? undefined,
    };
  }
  if (cfg.provider === 'ollama') {
    const { data: unknownData, response } = await requestJson('Ollama', `${trimSlash(cfg.baseUrl)}/api/chat`, {
      method: 'POST',
      signal: req.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        format: req.schema,
        options: {
          num_predict: maxTokens,
          temperature: req.temperature ?? 0,
        },
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          { role: 'user', content: req.user },
        ],
      }),
    });
    const data = unknownData as Record<string, unknown>;
    const message = data.message as Record<string, unknown> | undefined;
    const content = typeof message?.content === 'string' ? message.content : '';
    if (!content) throw new LlmRequestError('Ollama 没有返回结构化内容', 'invalid_response', false);
    return {
      data: ensureStructured<T>(parseModelJson(content), req.schema),
      mode: 'native',
      usage: usageFrom(data, cfg.provider),
      stopReason: typeof data.done_reason === 'string' ? data.done_reason : undefined,
      requestId: response.headers.get('x-request-id') ?? undefined,
    };
  }
  const { data: unknownData, response } = await requestJson('API', `${trimSlash(cfg.baseUrl)}/chat/completions`, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.schemaName, schema: req.schema, strict: true },
      },
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.user },
      ],
    }),
  });
  const data = unknownData as Record<string, unknown>;
  const choices = Array.isArray(data.choices) ? data.choices as Record<string, unknown>[] : [];
  const message = choices[0]?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === 'string' ? message.content : '';
  if (!content) throw new LlmRequestError('模型没有返回结构化内容', 'invalid_response', false);
  return {
    data: ensureStructured<T>(parseModelJson(content), req.schema),
    mode: 'native',
    usage: usageFrom(data, cfg.provider),
    stopReason: typeof choices[0]?.finish_reason === 'string' ? choices[0].finish_reason as string : undefined,
    requestId: response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined,
  };
}

export async function structuredComplete<T>(cfg: LlmConfig, req: StructuredRequest): Promise<StructuredResponse<T>> {
  try {
    return await nativeStructured<T>(cfg, req);
  } catch (error) {
    if (!(error instanceof LlmRequestError) || error.kind !== 'unsupported' || req.allowFallback === false) throw error;
  }
  const schemaText = JSON.stringify(req.schema);
  const text = await chatComplete(cfg, {
    ...req,
    system: [req.system, `只输出一个符合以下 JSON Schema 的 JSON 对象,不要 Markdown 或解释:\n${schemaText}`].filter(Boolean).join('\n\n'),
  });
  return { data: ensureStructured<T>(parseModelJson(text), req.schema), mode: 'fallback' };
}

/** 连接测试:发一个极小请求,返回耗时毫秒;失败抛错 */
export async function testLlmConnection(cfg: LlmConfig): Promise<number> {
  const t0 = Date.now();
  await chatComplete(cfg, { user: '回复"OK"两个字母,不要其他内容。', maxTokens: 1024 });
  return Date.now() - t0;
}

/**
 * 宽容解析模型输出的 JSON:剥掉 ```json 围栏、截取首个 { 到最后一个 },
 * 解析失败抛出带片段的错误
 */
export function parseModelJson(text: string): unknown {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`模型输出不是有效 JSON:${s.slice(0, 200)}…`);
  }
}
