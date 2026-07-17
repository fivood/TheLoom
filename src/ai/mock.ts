import {
  LlmRequestError,
  type ChatRequest,
  type LlmClient,
  type LlmErrorKind,
  type LlmUsage,
  type StructuredRequest,
  type StructuredResponse,
} from './llm';
import { validateJsonSchema } from './schema';

export type MockLlmStep =
  | {
    type: 'text';
    text: string;
    delayMs?: number;
  }
  | {
    type: 'structured';
    data: unknown;
    mode?: 'native' | 'fallback';
    usage?: LlmUsage;
    stopReason?: string;
    requestId?: string;
    delayMs?: number;
  }
  | {
    type: 'error';
    message: string;
    kind: LlmErrorKind;
    retryable?: boolean;
    status?: number;
    delayMs?: number;
  };

export interface MockLlmCall {
  kind: 'text' | 'structured';
  request: ChatRequest | StructuredRequest;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new LlmRequestError('请求已取消', 'cancelled', false));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LlmRequestError('请求已取消', 'cancelled', false));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class MockLlmClient implements LlmClient {
  readonly calls: MockLlmCall[] = [];
  private cursor = 0;

  constructor(private readonly steps: MockLlmStep[]) {}

  get remainingSteps(): number {
    return this.steps.length - this.cursor;
  }

  private next(expected: 'text'): Extract<MockLlmStep, { type: 'text' | 'error' }>;
  private next(expected: 'structured'): Extract<MockLlmStep, { type: 'structured' | 'error' }>;
  private next(expected: 'text' | 'structured'): MockLlmStep {
    const step = this.steps[this.cursor++];
    if (!step) throw new Error(`Mock LLM 没有为第 ${this.cursor} 次调用配置响应`);
    if (step.type !== 'error' && step.type !== expected) {
      throw new Error(`Mock LLM 响应类型不匹配:需要 ${expected},实际 ${step.type}`);
    }
    return step;
  }

  async chatComplete(request: ChatRequest): Promise<string> {
    this.calls.push({ kind: 'text', request });
    const step = this.next('text');
    await wait(step.delayMs ?? 0, request.signal);
    if (step.type === 'error') {
      throw new LlmRequestError(step.message, step.kind, step.retryable ?? false, step.status);
    }
    return step.text;
  }

  async structuredComplete<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
    this.calls.push({ kind: 'structured', request });
    const step = this.next('structured');
    await wait(step.delayMs ?? 0, request.signal);
    if (step.type === 'error') {
      throw new LlmRequestError(step.message, step.kind, step.retryable ?? false, step.status);
    }
    const issues = validateJsonSchema(step.data, request.schema);
    if (issues.length > 0) {
      const detail = issues.slice(0, 5).map((issue) => `${issue.path}:${issue.message}`).join('; ');
      throw new LlmRequestError(`模型输出未通过本地结构校验:${detail}`, 'invalid_response', false);
    }
    return {
      data: structuredClone(step.data) as T,
      mode: step.mode ?? 'native',
      usage: step.usage,
      stopReason: step.stopReason,
      requestId: step.requestId,
    };
  }
}
