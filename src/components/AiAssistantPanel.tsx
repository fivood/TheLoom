import { useEffect, useMemo, useRef, useState } from 'react';
import { askAiAssistant } from '../ai/assistant';
import {
  buildAiContextBundle,
  resolveAiContextSource,
  type AiContextBundle,
  type BuildAiContextOptions,
} from '../ai/context';
import {
  createLlmClient,
  hydrateDesktopLlmConfig,
  llmHasCredential,
  loadLlmConfig,
  PROVIDER_LABEL,
} from '../ai/llm';
import {
  loadAiSessions,
  newAiSession,
  saveAiSessions,
  type AiSession,
  type AiSessionMessage,
} from '../ai/sessions';
import type { Project } from '../types';
import type { NavTarget, NavTab } from '../search';
import { useNav } from '../search';
import { useLoom } from '../store';
import Icon from './Icon';

type ContextMode = 'current' | 'references' | 'query';

interface Props {
  currentTab: NavTab;
  onClose: () => void;
  onOpenSettings: () => void;
}

function firstNav(project: Project, tab: NavTab): NavTarget | null {
  if (tab === 'flow' && project.flows[0]) return { tab, flowId: project.flows[0].id };
  if (tab === 'entities' && project.entities[0]) return { tab, entityId: project.entities[0].id };
  if (tab === 'assets' && project.assets[0]) return { tab, assetId: project.assets[0].id };
  if (tab === 'documents' && project.documents[0]) return { tab, docId: project.documents[0].id };
  if (tab === 'research' && project.researchCards[0]) return { tab, cardId: project.researchCards[0].id };
  if (tab === 'timeline' && project.timelineEvents[0]) return { tab, eventId: project.timelineEvents[0].id };
  return null;
}

function messageId(): string {
  return `aim_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function updateSession(
  sessions: AiSession[],
  sessionId: string,
  fn: (session: AiSession) => void,
): AiSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const next = structuredClone(session);
    fn(next);
    next.updatedAt = Date.now();
    return next;
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

export default function AiAssistantPanel({ currentTab, onClose, onOpenSettings }: Props) {
  const project = useLoom((state) => state.project);
  const currentSlotId = useLoom((state) => state.currentSlotId);
  const navTarget = useNav((state) => state.target);
  const go = useNav((state) => state.go);
  const [mode, setMode] = useState<ContextMode>('current');
  const [queryId, setQueryId] = useState(project.savedQueries?.[0]?.id ?? '');
  const [bundle, setBundle] = useState<AiContextBundle | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [sessions, setSessions] = useState<AiSession[]>(() => {
    const loaded = loadAiSessions(currentSlotId);
    return loaded.length > 0 ? loaded : [newAiSession()];
  });
  const [sessionId, setSessionId] = useState(sessions[0].id);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionSlotRef = useRef(currentSlotId);

  const primary = useMemo(() => {
    if (navTarget?.tab === currentTab && resolveAiContextSource(project, navTarget)) return navTarget;
    return firstNav(project, currentTab);
  }, [project, navTarget, currentTab]);
  const activeSession = sessions.find((session) => session.id === sessionId) ?? sessions[0];
  const savedQuery = (project.savedQueries ?? []).find((item) => item.id === queryId);

  useEffect(() => {
    const loaded = loadAiSessions(currentSlotId);
    const next = loaded.length > 0 ? loaded : [newAiSession()];
    sessionSlotRef.current = currentSlotId;
    setSessions(next);
    setSessionId(next[0].id);
  }, [currentSlotId]);

  useEffect(() => {
    if (sessionSlotRef.current === currentSlotId) saveAiSessions(currentSlotId, sessions);
  }, [currentSlotId, sessions]);

  useEffect(() => {
    let cancelled = false;
    const build = async () => {
      setContextBusy(true);
      setContextError(null);
      try {
        const options: BuildAiContextOptions = mode === 'query'
          ? { query: savedQuery?.query, charBudget: 24_000 }
          : { primary: primary ?? undefined, includeReferences: mode === 'references', charBudget: 24_000 };
        if (mode === 'query' && !savedQuery) throw new Error('请先选择一个已保存的组合查询');
        if (mode !== 'query' && !primary) throw new Error('当前模块还没有可用对象');
        const next = await buildAiContextBundle(project, options);
        if (!cancelled) setBundle(next);
      } catch (cause) {
        if (!cancelled) {
          setBundle(null);
          setContextError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) setContextBusy(false);
      }
    };
    void build();
    return () => { cancelled = true; };
  }, [project, mode, primary, savedQuery]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const createSession = () => {
    const session = newAiSession();
    setSessions((current) => [session, ...current]);
    setSessionId(session.id);
    setQuestion('');
    setError(null);
  };

  const removeSession = () => {
    if (!activeSession) return;
    const remaining = sessions.filter((session) => session.id !== activeSession.id);
    const next = remaining.length > 0 ? remaining : [newAiSession()];
    setSessions(next);
    setSessionId(next[0].id);
  };

  const send = async () => {
    const text = question.trim();
    if (!text || !bundle || !activeSession || busy) return;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const cfg = await hydrateDesktopLlmConfig(loadLlmConfig());
      if (!llmHasCredential(cfg)) throw new Error('还没有配置 API Key');
      const userMessage: AiSessionMessage = {
        id: messageId(),
        role: 'user',
        text,
        createdAt: Date.now(),
        contextSourceKeys: bundle.items.map((item) => item.sourceRef.key),
      };
      setSessions((current) => updateSession(current, activeSession.id, (session) => {
        session.messages.push(userMessage);
        if (session.messages.length === 1) session.title = text.slice(0, 24);
      }));
      setQuestion('');
      const answer = await askAiAssistant(createLlmClient(cfg), bundle, text, controller.signal);
      const assistantMessage: AiSessionMessage = {
        id: messageId(),
        role: 'assistant',
        text: answer.text,
        createdAt: Date.now(),
        citations: answer.citations,
        usage: answer.usage,
      };
      setSessions((current) => updateSession(current, activeSession.id, (session) => {
        session.messages.push(assistantMessage);
      }));
      if (answer.ignoredCitationKeys.length > 0) {
        setError(`模型返回了 ${answer.ignoredCitationKeys.length} 个未知来源，已忽略`);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!controller.signal.aborted) setError(message);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  return (
    <aside className="ai-assistant" aria-label="AI 助手">
      <div className="ai-assistant-head">
        <Icon name="bulb" size={16} />
        <strong>AI 助手</strong>
        <span className="ai-readonly-badge">只读</span>
        <span className="spacer" />
        <button className="ghost icon-btn" title="AI 设置" onClick={onOpenSettings}><Icon name="braces" size={14} /></button>
        <button className="ghost icon-btn" title="关闭 AI 助手" onClick={onClose}>×</button>
      </div>

      <div className="ai-session-bar">
        <select
          aria-label="AI 会话"
          value={activeSession?.id}
          onChange={(event) => setSessionId(event.target.value)}
        >
          {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
        </select>
        <button className="ghost" onClick={createSession}>新对话</button>
        <button className="ghost icon-btn" title="删除当前对话" onClick={removeSession}><Icon name="trash" size={13} /></button>
      </div>

      <div className="ai-context-card">
        <div className="ai-section-title">发送范围</div>
        <select aria-label="AI 上下文范围" value={mode} onChange={(event) => setMode(event.target.value as ContextMode)}>
          <option value="current">当前对象</option>
          <option value="references">当前对象 + 一跳引用</option>
          <option value="query">已保存的组合查询</option>
        </select>
        {mode === 'query' && (
          <select aria-label="保存的组合查询" value={queryId} onChange={(event) => setQueryId(event.target.value)}>
            <option value="">选择查询…</option>
            {(project.savedQueries ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        )}
        {contextBusy ? (
          <div className="hint">正在整理本地上下文…</div>
        ) : contextError ? (
          <div className="ai-context-error">{contextError}</div>
        ) : bundle ? (
          <>
            <div className="ai-context-summary">
              <span>{bundle.summary.objectCount} 个对象</span>
              <span>{bundle.usedChars.toLocaleString()} 字符</span>
              <span>{bundle.summary.modules.join(' / ') || '无模块'}</span>
            </div>
            <div className="ai-context-flags">
              {bundle.summary.containsBody && <span>含正文</span>}
              {bundle.summary.containsResearch && <span>含资料</span>}
              <span>不含 AI 咨询记录</span>
            </div>
            <div className="ai-context-sources">
              {bundle.items.slice(0, 8).map((item) => (
                <button key={item.sourceRef.key} className="ghost" onClick={() => go(item.sourceRef.nav)}>
                  {item.sourceRef.title}{item.truncated ? ' · 已裁剪' : ''}
                </button>
              ))}
              {bundle.items.length > 8 && <span>另有 {bundle.items.length - 8} 项</span>}
            </div>
          </>
        ) : null}
      </div>

      <div className="ai-conversation">
        {activeSession?.messages.length ? activeSession.messages.map((message) => (
          <div key={message.id} className={`ai-message ${message.role}`}>
            <div className="ai-message-role">{message.role === 'user' ? '你' : '助手'}</div>
            <div className="ai-message-text">{message.text}</div>
            {message.citations && message.citations.length > 0 && (
              <div className="ai-citations">
                {message.citations.map((citation) => (
                  <button key={citation.key} className="ghost" onClick={() => go(citation.nav)}>
                    ↗ {citation.title}
                  </button>
                ))}
              </div>
            )}
            {message.usage?.totalTokens !== undefined && (
              <div className="ai-usage">{message.usage.totalTokens.toLocaleString()} tokens</div>
            )}
          </div>
        )) : (
          <div className="ai-empty">
            <strong>从当前叙事对象开始提问</strong>
            <span>助手只会收到上方列出的内容，并用可点击来源回答。</span>
          </div>
        )}
      </div>

      {error && (
        <div className="ai-assistant-error">
          {error}
          {error.includes('API Key') && <button className="ghost" onClick={onOpenSettings}>打开设置</button>}
        </div>
      )}

      <div className="ai-composer">
        <textarea
          aria-label="询问 AI 助手"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="询问当前对象、检查矛盾或梳理线索…"
          rows={3}
        />
        <div>
          <span className="hint">{bundle ? `${PROVIDER_LABEL[loadLlmConfig().provider]} · 发送前可见` : '等待上下文'}</span>
          {busy ? (
            <button onClick={() => abortRef.current?.abort()}>停止</button>
          ) : (
            <button className="primary" disabled={!question.trim() || !bundle || contextBusy} onClick={() => void send()}>发送</button>
          )}
        </div>
      </div>
    </aside>
  );
}
