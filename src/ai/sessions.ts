import type { AiSourceRef } from './context';

export interface AiSessionMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  citations?: AiSourceRef[];
  contextSourceKeys?: string[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface AiSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AiSessionMessage[];
}

const MAX_SESSIONS = 30;
const MAX_MESSAGES = 100;
const MAX_TEXT = 30_000;

function key(slotId: string): string {
  return `theloom-ai-sessions-v1:${encodeURIComponent(slotId)}`;
}

function validSourceRef(value: unknown): value is AiSourceRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Partial<AiSourceRef>;
  return typeof ref.key === 'string'
    && typeof ref.kind === 'string'
    && typeof ref.id === 'string'
    && typeof ref.title === 'string'
    && Boolean(ref.nav && typeof ref.nav === 'object' && typeof ref.nav.tab === 'string');
}

function normalizeMessage(value: unknown): AiSessionMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Partial<AiSessionMessage>;
  if (typeof message.id !== 'string'
    || (message.role !== 'user' && message.role !== 'assistant')
    || typeof message.text !== 'string'
    || typeof message.createdAt !== 'number') return null;
  return {
    id: message.id,
    role: message.role,
    text: message.text.slice(0, MAX_TEXT),
    createdAt: message.createdAt,
    citations: Array.isArray(message.citations) ? message.citations.filter(validSourceRef).slice(0, 50) : undefined,
    contextSourceKeys: Array.isArray(message.contextSourceKeys)
      ? message.contextSourceKeys.filter((item): item is string => typeof item === 'string').slice(0, 200)
      : undefined,
    usage: message.usage && typeof message.usage === 'object' ? {
      inputTokens: typeof message.usage.inputTokens === 'number' ? message.usage.inputTokens : undefined,
      outputTokens: typeof message.usage.outputTokens === 'number' ? message.usage.outputTokens : undefined,
      totalTokens: typeof message.usage.totalTokens === 'number' ? message.usage.totalTokens : undefined,
    } : undefined,
  };
}

export function loadAiSessions(slotId: string, storage: Storage = localStorage): AiSession[] {
  try {
    const parsed = JSON.parse(storage.getItem(key(slotId)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value): AiSession | null => {
      if (!value || typeof value !== 'object') return null;
      const session = value as Partial<AiSession>;
      if (typeof session.id !== 'string'
        || typeof session.title !== 'string'
        || typeof session.createdAt !== 'number'
        || typeof session.updatedAt !== 'number'
        || !Array.isArray(session.messages)) return null;
      return {
        id: session.id,
        title: session.title.slice(0, 100),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages: session.messages.map(normalizeMessage).filter((item): item is AiSessionMessage => Boolean(item)).slice(-MAX_MESSAGES),
      };
    }).filter((item): item is AiSession => Boolean(item))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

export function saveAiSessions(slotId: string, sessions: AiSession[], storage: Storage = localStorage): void {
  const safe = sessions
    .map((session) => ({ ...session, messages: session.messages.slice(-MAX_MESSAGES) }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
  storage.setItem(key(slotId), JSON.stringify(safe));
}

export function newAiSession(now = Date.now()): AiSession {
  return {
    id: `ais_${Math.random().toString(36).slice(2, 10)}${now.toString(36).slice(-4)}`,
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}
