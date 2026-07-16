/**
 * LLM 服务层:本地优先,三种可切换后端,零第三方依赖(原生 fetch)。
 * API Key 只存 localStorage(本浏览器 / 本机),不写入项目数据,不随云协作同步。
 */

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
}

/** 单轮补全:按配置分发到对应后端,返回纯文本 */
export async function chatComplete(cfg: LlmConfig, req: ChatRequest): Promise<string> {
  const maxTokens = req.maxTokens ?? 16000;
  if (cfg.provider === 'anthropic') {
    const res = await fetch(`${trimSlash(cfg.baseUrl)}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: 'user', content: req.user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}:${(await res.text()).slice(0, 400)}`);
    const data = await res.json() as { content?: { type: string; text?: string }[]; stop_reason?: string };
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    if (!text) throw new Error(`模型没有返回文本(stop_reason: ${data.stop_reason ?? '未知'})`);
    return text;
  }
  if (cfg.provider === 'ollama') {
    const res = await fetch(`${trimSlash(cfg.baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          { role: 'user', content: req.user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}:${(await res.text()).slice(0, 400)}(若为 403,需设置 OLLAMA_ORIGINS 允许跨域)`);
    const data = await res.json() as { message?: { content?: string } };
    const text = data.message?.content ?? '';
    if (!text) throw new Error('Ollama 没有返回文本');
    return text;
  }
  // OpenAI 兼容(OpenAI / DeepSeek / Moonshot / SiliconFlow / 任意自建网关)
  const res = await fetch(`${trimSlash(cfg.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}:${(await res.text()).slice(0, 400)}`);
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('模型没有返回文本');
  return text;
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
