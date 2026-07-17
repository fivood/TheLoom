/**
 * LLM 服务层:本地优先,多服务商兼容后端,零第三方依赖(原生 fetch)。
 * API Key 网页版存当前浏览器,Windows 桌面版存系统凭据管理器,不写入项目数据或云协作。
 */

import { validateJsonSchema, type JsonSchema, type SchemaIssue } from './schema';

export type LlmProvider =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'kimi'
  | 'qwen'
  | 'glm'
  | 'minimax'
  | 'ollama'
  | 'custom-openai'
  | 'custom-anthropic';

export type LlmProtocol = 'openai' | 'anthropic' | 'ollama';
export type LlmAuthMode = 'bearer' | 'x-api-key' | 'none';

export interface LlmConfig {
  provider: LlmProvider;
  protocol: LlmProtocol;
  authMode: LlmAuthMode;
  baseUrl: string;
  apiKey: string;
  credentialStored: boolean;
  model: string;
}

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  openai: 'OpenAI 兼容 API',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  qwen: '通义千问 · 阿里百炼',
  glm: '智谱 GLM',
  minimax: 'MiniMax',
  ollama: 'Ollama(本地)',
  'custom-openai': '自定义 · OpenAI 兼容',
  'custom-anthropic': '自定义 · Anthropic 兼容',
};

export const PROVIDER_DEFAULTS: Record<LlmProvider, Omit<LlmConfig, 'apiKey'>> = {
  openai: { provider: 'openai', protocol: 'openai', authMode: 'bearer', credentialStored: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { provider: 'anthropic', protocol: 'anthropic', authMode: 'x-api-key', credentialStored: false, baseUrl: 'https://api.anthropic.com', model: 'claude-opus-4-8' },
  deepseek: { provider: 'deepseek', protocol: 'openai', authMode: 'bearer', credentialStored: false, baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  kimi: { provider: 'kimi', protocol: 'openai', authMode: 'bearer', credentialStored: false, baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3' },
  qwen: { provider: 'qwen', protocol: 'openai', authMode: 'bearer', credentialStored: false, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  glm: { provider: 'glm', protocol: 'openai', authMode: 'bearer', credentialStored: false, baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2' },
  minimax: { provider: 'minimax', protocol: 'openai', authMode: 'bearer', credentialStored: false, baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.7' },
  ollama: { provider: 'ollama', protocol: 'ollama', authMode: 'none', credentialStored: false, baseUrl: 'http://localhost:11434', model: 'qwen3:8b' },
  'custom-openai': { provider: 'custom-openai', protocol: 'openai', authMode: 'bearer', credentialStored: false, baseUrl: '', model: '' },
  'custom-anthropic': { provider: 'custom-anthropic', protocol: 'anthropic', authMode: 'x-api-key', credentialStored: false, baseUrl: '', model: '' },
};

export const PROVIDER_META: Record<LlmProvider, { consoleUrl?: string; hint: string }> = {
  openai: { consoleUrl: 'https://platform.openai.com/api-keys', hint: 'OpenAI API 与 ChatGPT 订阅分开计费' },
  anthropic: { consoleUrl: 'https://console.anthropic.com/settings/keys', hint: 'Claude API 与 Claude 网页订阅分开计费' },
  deepseek: { consoleUrl: 'https://platform.deepseek.com/api_keys', hint: '支持 OpenAI / Anthropic 兼容协议；此处默认使用 OpenAI 兼容' },
  kimi: { consoleUrl: 'https://platform.kimi.com/', hint: 'Kimi K3，OpenAI 兼容，适合长上下文叙事任务' },
  qwen: { consoleUrl: 'https://bailian.console.aliyun.com/', hint: '默认使用中国大陆百炼公共端点；工作空间端点可手动替换' },
  glm: { consoleUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys', hint: '智谱 OpenAI 兼容接口' },
  minimax: { consoleUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', hint: '默认使用 OpenAI 兼容；也可通过自定义 Anthropic 兼容接入' },
  ollama: { consoleUrl: 'https://ollama.com/library', hint: '模型在本机运行，不需要 API Key' },
  'custom-openai': { hint: '适用于硅基流动、火山方舟、企业代理和自建 OpenAI 兼容网关' },
  'custom-anthropic': { hint: '适用于提供 Anthropic Messages 兼容协议的代理或模型服务' },
};

const CONFIG_KEY = 'theloom-llm-v2';
const LEGACY_CONFIG_KEY = 'theloom-llm-v1';
const PROVIDERS = new Set<LlmProvider>(Object.keys(PROVIDER_DEFAULTS) as LlmProvider[]);
const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function storedConfig(cfg: LlmConfig, keepApiKey: boolean) {
  return JSON.stringify({ ...cfg, apiKey: keepApiKey ? cfg.apiKey : '' });
}

export function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY) ?? localStorage.getItem(LEGACY_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LlmConfig>;
      const provider = typeof parsed.provider === 'string' && PROVIDERS.has(parsed.provider as LlmProvider)
        ? parsed.provider as LlmProvider
        : 'openai';
      const defaults = PROVIDER_DEFAULTS[provider];
      return {
        provider,
        protocol: parsed.protocol === 'anthropic' || parsed.protocol === 'ollama' || parsed.protocol === 'openai'
          ? parsed.protocol
          : defaults.protocol,
        authMode: parsed.authMode === 'x-api-key' || parsed.authMode === 'none' || parsed.authMode === 'bearer'
          ? parsed.authMode
          : defaults.authMode,
        baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? parsed.baseUrl : defaults.baseUrl,
        apiKey: !isDesktop && typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
        credentialStored: typeof parsed.credentialStored === 'boolean'
          ? parsed.credentialStored
          : isDesktop && typeof parsed.apiKey === 'string' && Boolean(parsed.apiKey),
        model: typeof parsed.model === 'string' && parsed.model ? parsed.model : defaults.model,
      };
    }
  } catch {}
  return { ...PROVIDER_DEFAULTS.openai, apiKey: '' };
}

async function invokeDesktop<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function hydrateDesktopLlmConfig(cfg: LlmConfig): Promise<LlmConfig> {
  if (!isDesktop || cfg.authMode === 'none') return cfg;
  const raw = localStorage.getItem(CONFIG_KEY) ?? localStorage.getItem(LEGACY_CONFIG_KEY);
  let legacySecret = '';
  try {
    const parsed = raw ? JSON.parse(raw) as Partial<LlmConfig> : {};
    legacySecret = typeof parsed.apiKey === 'string' ? parsed.apiKey : '';
  } catch { /* 忽略损坏配置 */ }
  if (legacySecret) {
    await invokeDesktop('set_llm_secret', { provider: cfg.provider, secret: legacySecret });
    const next = { ...cfg, apiKey: '', credentialStored: true };
    localStorage.setItem(CONFIG_KEY, storedConfig(next, false));
    localStorage.removeItem(LEGACY_CONFIG_KEY);
    return next;
  }
  if (cfg.credentialStored) return cfg;
  const credentialStored = await invokeDesktop<boolean>('has_llm_secret', { provider: cfg.provider });
  return { ...cfg, apiKey: '', credentialStored };
}

export async function saveLlmConfig(cfg: LlmConfig): Promise<LlmConfig> {
  if (!isDesktop) {
    const next = cfg.authMode === 'none' ? { ...cfg, apiKey: '', credentialStored: false } : cfg;
    localStorage.setItem(CONFIG_KEY, storedConfig(next, true));
    return next;
  }
  let credentialStored = cfg.credentialStored;
  if (cfg.authMode === 'none') {
    if (credentialStored) {
      await invokeDesktop('delete_llm_secret', { provider: cfg.provider });
    }
    credentialStored = false;
  } else if (cfg.apiKey) {
    await invokeDesktop('set_llm_secret', { provider: cfg.provider, secret: cfg.apiKey });
    credentialStored = true;
  }
  const next = { ...cfg, apiKey: '', credentialStored };
  localStorage.setItem(CONFIG_KEY, storedConfig(next, false));
  localStorage.removeItem(LEGACY_CONFIG_KEY);
  return next;
}

export async function deleteLlmCredential(cfg: LlmConfig): Promise<LlmConfig> {
  if (isDesktop) {
    await invokeDesktop('delete_llm_secret', { provider: cfg.provider });
  }
  const next = { ...cfg, apiKey: '', credentialStored: false };
  localStorage.setItem(CONFIG_KEY, storedConfig(next, !isDesktop));
  return next;
}

export const llmNeedsApiKey = (cfg: LlmConfig) => cfg.authMode !== 'none';
export const llmHasCredential = (cfg: LlmConfig) => !llmNeedsApiKey(cfg) || Boolean(cfg.apiKey) || cfg.credentialStored;

const trimSlash = (s: string) => s.replace(/\/+$/, '');

function authHeaders(cfg: LlmConfig): Record<string, string> {
  if (!cfg.apiKey || cfg.authMode === 'none') return {};
  return cfg.authMode === 'x-api-key'
    ? { 'x-api-key': cfg.apiKey }
    : { authorization: `Bearer ${cfg.apiKey}` };
}

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

interface DesktopHttpResponse {
  status: number;
  body: string;
  requestId?: string;
}

async function desktopRequest(cfg: LlmConfig, url: string, init: RequestInit): Promise<Response> {
  await hydrateDesktopLlmConfig(cfg);
  const pending = invokeDesktop<DesktopHttpResponse>('llm_http_request', {
    request: {
      provider: cfg.provider,
      protocol: cfg.protocol,
      authMode: cfg.authMode,
      url,
      body: typeof init.body === 'string' ? init.body : '',
    },
  });
  if (!init.signal) {
    const result = await pending;
    return new Response(result.body, { status: result.status, headers: result.requestId ? { 'x-request-id': result.requestId } : {} });
  }
  if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
  const result = await Promise.race([
    pending,
    new Promise<never>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })),
  ]);
  return new Response(result.body, { status: result.status, headers: result.requestId ? { 'x-request-id': result.requestId } : {} });
}

async function requestJson(cfg: LlmConfig, provider: string, url: string, init: RequestInit): Promise<{ data: unknown; response: Response }> {
  let response: Response;
  try {
    response = isDesktop ? await desktopRequest(cfg, url, init) : await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new LlmRequestError('请求已取消', 'cancelled', false);
    }
    const detail = error instanceof Error ? error.message : String(error);
    const auth = detail.includes('API Key') || detail.includes('凭据');
    throw new LlmRequestError(`${provider} ${auth ? '认证失败' : '网络请求失败'}:${detail}`, auth ? 'auth' : 'network', !auth);
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
  if (cfg.protocol === 'anthropic') {
    const { data: raw } = await requestJson(cfg, 'Anthropic', `${trimSlash(cfg.baseUrl)}/v1/messages`, {
      method: 'POST',
      signal: req.signal,
      headers: {
        'content-type': 'application/json',
        ...authHeaders(cfg),
        'anthropic-version': '2023-06-01',
        ...(cfg.provider === 'anthropic' ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
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
  if (cfg.protocol === 'ollama') {
    const { data: raw } = await requestJson(cfg, 'Ollama', `${trimSlash(cfg.baseUrl)}/api/chat`, {
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
  const { data: raw } = await requestJson(cfg, 'API', `${trimSlash(cfg.baseUrl)}/chat/completions`, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'content-type': 'application/json',
      ...authHeaders(cfg),
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

function usageFrom(raw: Record<string, unknown>, protocol: LlmProtocol): LlmUsage | undefined {
  if (protocol === 'ollama') {
    const inputTokens = typeof raw.prompt_eval_count === 'number' ? raw.prompt_eval_count : undefined;
    const outputTokens = typeof raw.eval_count === 'number' ? raw.eval_count : undefined;
    return inputTokens === undefined && outputTokens === undefined
      ? undefined
      : { inputTokens, outputTokens, totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0) };
  }
  const usage = raw.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;
  if (protocol === 'anthropic') {
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
  if (cfg.protocol === 'anthropic') {
    const { data: unknownData, response } = await requestJson(cfg, 'Anthropic', `${trimSlash(cfg.baseUrl)}/v1/messages`, {
      method: 'POST',
      signal: req.signal,
      headers: {
        'content-type': 'application/json',
        ...authHeaders(cfg),
        'anthropic-version': '2023-06-01',
        ...(cfg.provider === 'anthropic' ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
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
      usage: usageFrom(data, cfg.protocol),
      stopReason: typeof data.stop_reason === 'string' ? data.stop_reason : undefined,
      requestId: response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? undefined,
    };
  }
  if (cfg.protocol === 'ollama') {
    const { data: unknownData, response } = await requestJson(cfg, 'Ollama', `${trimSlash(cfg.baseUrl)}/api/chat`, {
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
      usage: usageFrom(data, cfg.protocol),
      stopReason: typeof data.done_reason === 'string' ? data.done_reason : undefined,
      requestId: response.headers.get('x-request-id') ?? undefined,
    };
  }
  const { data: unknownData, response } = await requestJson(cfg, 'API', `${trimSlash(cfg.baseUrl)}/chat/completions`, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'content-type': 'application/json',
      ...authHeaders(cfg),
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
    usage: usageFrom(data, cfg.protocol),
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
