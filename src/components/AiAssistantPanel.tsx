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
import { generateFixProposal } from '../ai/fixAssistant';
import { useAiPanelBus } from '../ai/panelBus';
import {
  dryRunAiProposal,
  type AiProposal,
  type AiProposalDryRun,
} from '../ai/proposal';
import { interpretProjectQuery, type AiQueryInterpretation } from '../ai/queryAssistant';
import {
  loadAiSessions,
  newAiSession,
  saveAiSessions,
  type AiSession,
  type AiSessionMessage,
} from '../ai/sessions';
import type { Project } from '../types';
import type { ProjectIssue } from '../issues';
import type { NavTarget, NavTab } from '../search';
import { useNav } from '../search';
import { uid, useLoom } from '../store';
import Icon from './Icon';

type ContextMode = 'current' | 'references' | 'query' | 'issue';
type AssistantTask = 'ask' | 'query' | 'fix';

interface FixState {
  proposal: AiProposal;
  dryRun: AiProposalDryRun;
  selected: string[];
  confirmWarnings: boolean;
  ignoredEvidenceKeys: string[];
  appliedNote?: string;
}

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
  const addSavedQuery = useLoom((state) => state.addSavedQuery);
  const navTarget = useNav((state) => state.target);
  const go = useNav((state) => state.go);
  const [task, setTask] = useState<AssistantTask>('ask');
  const [mode, setMode] = useState<ContextMode>('current');
  const [queryId, setQueryId] = useState(project.savedQueries?.[0]?.id ?? '');
  const [issues, setIssues] = useState<ProjectIssue[]>([]);
  const [issueId, setIssueId] = useState('');
  const [issuesBusy, setIssuesBusy] = useState(false);
  const [bundle, setBundle] = useState<AiContextBundle | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [sessions, setSessions] = useState<AiSession[]>(() => {
    const loaded = loadAiSessions(currentSlotId);
    return loaded.length > 0 ? loaded : [newAiSession()];
  });
  const [sessionId, setSessionId] = useState(sessions[0].id);
  const [question, setQuestion] = useState('');
  const [queryResult, setQueryResult] = useState<AiQueryInterpretation | null>(null);
  const [queryName, setQueryName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fix, setFix] = useState<FixState | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const applyAiProposal = useLoom((state) => state.applyAiProposal);
  const panelRequest = useAiPanelBus((state) => state.request);
  const consumePanelRequest = useAiPanelBus((state) => state.consume);
  const abortRef = useRef<AbortController | null>(null);
  const sessionSlotRef = useRef(currentSlotId);

  const primary = useMemo(() => {
    if (navTarget?.tab === currentTab && resolveAiContextSource(project, navTarget)) return navTarget;
    return firstNav(project, currentTab);
  }, [project, navTarget, currentTab]);
  const activeSession = sessions.find((session) => session.id === sessionId) ?? sessions[0];
  const savedQuery = (project.savedQueries ?? []).find((item) => item.id === queryId);
  const selectedIssue = issues.find((issue) => issue.id === issueId);

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
    if (!panelRequest) return;
    setTask(panelRequest.task);
    if (panelRequest.task === 'fix' || panelRequest.issueId) setMode('issue');
    if (panelRequest.issueId) setIssueId(panelRequest.issueId);
    setFix(null);
    consumePanelRequest();
  }, [panelRequest, consumePanelRequest]);

  useEffect(() => {
    if (mode !== 'issue') return;
    let cancelled = false;
    setIssuesBusy(true);
    void import('../audit').then(({ auditProject }) => {
      if (cancelled) return;
      const next = auditProject(project);
      setIssues(next);
      setIssueId((current) => next.some((issue) => issue.id === current) ? current : next[0]?.id ?? '');
    }).catch((cause) => {
      if (!cancelled) setContextError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!cancelled) setIssuesBusy(false);
    });
    return () => { cancelled = true; };
  }, [mode, project]);

  useEffect(() => {
    let cancelled = false;
    const build = async () => {
      setContextBusy(true);
      setContextError(null);
      try {
        const options: BuildAiContextOptions = mode === 'query'
          ? { query: savedQuery?.query, charBudget: 24_000 }
          : mode === 'issue'
            ? { issue: selectedIssue, charBudget: 24_000 }
          : { primary: primary ?? undefined, includeReferences: mode === 'references', charBudget: 24_000 };
        if (mode === 'query' && !savedQuery) throw new Error('请先选择一个已保存的组合查询');
        if (mode === 'issue' && !selectedIssue) throw new Error(issuesBusy ? '正在运行项目体检…' : '当前项目没有可选择的体检问题');
        if (mode !== 'query' && mode !== 'issue' && !primary) throw new Error('当前模块还没有可用对象');
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
  }, [project, mode, primary, savedQuery, selectedIssue, issuesBusy]);

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

  const appendSessionMessages = (messages: AiSessionMessage[]) => {
    if (!activeSession) return;
    setSessions((current) => updateSession(current, activeSession.id, (session) => {
      session.messages.push(...messages);
      if (session.messages.length === messages.length && messages[0]) {
        session.title = messages[0].text.slice(0, 24);
      }
    }));
  };

  const generateFix = async () => {
    if (!bundle || !selectedIssue || fixBusy || busy) return;
    setFixBusy(true);
    setError(null);
    setFix(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const cfg = await hydrateDesktopLlmConfig(loadLlmConfig());
      if (!llmHasCredential(cfg)) throw new Error('还没有配置 API Key');
      const client = createLlmClient(cfg);
      const instruction = question.trim() || undefined;
      const result = await generateFixProposal(client, project, bundle, [selectedIssue], instruction, controller.signal);
      const dryRun = await dryRunAiProposal(project, result.proposal, {
        expectedContextSourceKeys: result.proposal.contextSourceKeys,
      });
      setFix({
        proposal: result.proposal,
        dryRun,
        selected: result.proposal.operations.map((operation) => operation.id),
        confirmWarnings: false,
        ignoredEvidenceKeys: result.ignoredEvidenceKeys,
      });
      appendSessionMessages([
        {
          id: messageId(),
          role: 'user',
          text: instruction ? `修复「${selectedIssue.kind}」:${instruction}` : `修复「${selectedIssue.kind}」`,
          createdAt: Date.now(),
          contextSourceKeys: bundle.items.map((item) => item.sourceRef.key),
        },
        {
          id: messageId(),
          role: 'assistant',
          text: `${result.proposal.summary}\n\n提案含 ${result.proposal.operations.length} 项操作,本地验证:${dryRun.status === 'pass' ? '通过' : dryRun.status === 'warning' ? '有警告' : '被拦截'}。`,
          createdAt: Date.now(),
          usage: result.usage,
        },
      ]);
      setQuestion('');
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setFixBusy(false);
    }
  };

  const reselectFix = async (ids: string[]) => {
    if (!fix || fix.appliedNote) return;
    const proposal = fix.proposal;
    setFix((current) => current && { ...current, selected: ids });
    const dryRun = await dryRunAiProposal(project, proposal, {
      selectedOperationIds: ids,
      expectedContextSourceKeys: proposal.contextSourceKeys,
    });
    setFix((current) => current && current.proposal.id === proposal.id
      ? { ...current, selected: ids, dryRun }
      : current);
  };

  const applyFix = async () => {
    if (!fix || fix.appliedNote || fixBusy) return;
    setFixBusy(true);
    setError(null);
    try {
      const result = await applyAiProposal(fix.proposal, {
        selectedOperationIds: fix.selected,
        expectedContextSourceKeys: fix.proposal.contextSourceKeys,
        confirmWarnings: fix.confirmWarnings,
      });
      if (result.applied) {
        setFix((current) => current && {
          ...current,
          dryRun: result.dryRun,
          appliedNote: `已应用 ${result.dryRun.metrics.appliedOperations} 项修改,可 Ctrl+Z 一步撤销`,
        });
        appendSessionMessages([{
          id: messageId(),
          role: 'assistant',
          text: `修复已应用(${result.dryRun.metrics.appliedOperations} 项操作,改动 ${result.dryRun.metrics.changedChars} 字符)。`,
          createdAt: Date.now(),
        }]);
      } else {
        setFix((current) => current && { ...current, dryRun: result.dryRun });
        setError(result.reason === 'project-changed'
          ? '项目在验证后发生了变化,请重新生成提案'
          : result.reason === 'warning-confirmation-required'
            ? '存在警告,请先勾选「已了解全部警告」'
            : '提案被本地验证拦截,无法应用');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setFixBusy(false);
    }
  };

  const send = async () => {
    if (task === 'fix') { void generateFix(); return; }
    const text = question.trim();
    if (!text || !activeSession || busy || (task === 'ask' && !bundle)) return;
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
        contextSourceKeys: task === 'ask' && bundle ? bundle.items.map((item) => item.sourceRef.key) : [],
      };
      setSessions((current) => updateSession(current, activeSession.id, (session) => {
        session.messages.push(userMessage);
        if (session.messages.length === 1) session.title = text.slice(0, 24);
      }));
      setQuestion('');
      const client = createLlmClient(cfg);
      if (task === 'query') {
        const result = await interpretProjectQuery(client, project, text, controller.signal);
        setQueryResult(result);
        setQueryName(result.suggestedName);
        const assistantMessage: AiSessionMessage = {
          id: messageId(),
          role: 'assistant',
          text: `${result.explanation}\n\n本地执行后找到 ${result.hits.length} 个对象。`,
          createdAt: Date.now(),
          usage: result.usage,
        };
        setSessions((current) => updateSession(current, activeSession.id, (session) => {
          session.messages.push(assistantMessage);
        }));
        return;
      }
      const answer = await askAiAssistant(client, bundle!, text, controller.signal);
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

  const saveGeneratedQuery = () => {
    if (!queryResult) return;
    const name = queryName.trim();
    if (!name) {
      setError('请先填写查询名称');
      return;
    }
    if ((project.savedQueries ?? []).some((item) => item.name === name)) {
      setError(`已有名为「${name}」的查询`);
      return;
    }
    const now = Date.now();
    addSavedQuery({
      id: uid(),
      name,
      query: structuredClone(queryResult.query),
      createdAt: now,
      updatedAt: now,
    });
    setError(null);
    setQueryResult(null);
  };

  return (
    <aside className="ai-assistant" aria-label="AI 助手">
      <div className="ai-assistant-head">
        <Icon name="bulb" size={16} />
        <strong>AI 助手</strong>
        <span className="ai-readonly-badge">{task === 'fix' ? '提案制' : '只读'}</span>
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

      <div className="ai-task-tabs">
        <button className={task === 'ask' ? 'active' : 'ghost'} onClick={() => setTask('ask')}>项目问答</button>
        <button className={task === 'query' ? 'active' : 'ghost'} onClick={() => setTask('query')}>自然语言查询</button>
        <button className={task === 'fix' ? 'active' : 'ghost'} onClick={() => { setTask('fix'); setMode('issue'); }}>修复提案</button>
      </div>

      {task !== 'query' ? <div className="ai-context-card">
        <div className="ai-section-title">{task === 'fix' ? '要修复的问题' : '发送范围'}</div>
        {task === 'ask' && (
          <select aria-label="AI 上下文范围" value={mode} onChange={(event) => setMode(event.target.value as ContextMode)}>
            <option value="current">当前对象</option>
            <option value="references">当前对象 + 一跳引用</option>
            <option value="query">已保存的组合查询</option>
            <option value="issue">体检问题</option>
          </select>
        )}
        {mode === 'query' && (
          <select aria-label="保存的组合查询" value={queryId} onChange={(event) => setQueryId(event.target.value)}>
            <option value="">选择查询…</option>
            {(project.savedQueries ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        )}
        {mode === 'issue' && (
          <select aria-label="体检问题" value={issueId} onChange={(event) => setIssueId(event.target.value)}>
            <option value="">{issuesBusy ? '正在体检…' : '选择问题…'}</option>
            {issues.slice(0, 200).map((issue) => (
              <option key={issue.id} value={issue.id}>[{issue.severity}] {issue.kind} · {issue.message.slice(0, 80)}</option>
            ))}
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
                <button
                  key={item.sourceRef.key}
                  className="ghost"
                  disabled={!item.sourceRef.nav}
                  onClick={() => { if (item.sourceRef.nav) go(item.sourceRef.nav); }}
                >
                  {item.sourceRef.title}{item.truncated ? ' · 已裁剪' : ''}
                </button>
              ))}
              {bundle.items.length > 8 && <span>另有 {bundle.items.length - 8} 项</span>}
            </div>
          </>
        ) : null}
      </div> : (
        <div className="ai-context-card">
          <div className="ai-section-title">本地查询转换</div>
          <div className="ai-context-summary">
            <span>7 类对象</span>
            <span>8 个固定字段</span>
            <span>{project.folders.length} 个文件夹</span>
          </div>
          <div className="ai-context-flags">
            <span>不发送项目正文</span>
            <span>结果在本地执行</span>
            <span>保存前预览</span>
          </div>
        </div>
      )}

      {task === 'query' && queryResult && (
        <div className="ai-query-preview">
          <div className="ai-section-title">本地结果 · {queryResult.hits.length} 项</div>
          <div className="ai-query-explanation">{queryResult.explanation}</div>
          <div className="ai-query-condition">
            {queryResult.query.objectType} · {queryResult.query.text || '无全文条件'} · {queryResult.query.references}
          </div>
          <div className="ai-query-hits">
            {queryResult.hits.slice(0, 20).map((hit) => (
              <button key={`${hit.objectType}:${hit.id}`} className="ghost" onClick={() => go(hit.nav)}>
                <span>{hit.module}</span><strong>{hit.title}</strong>
              </button>
            ))}
            {queryResult.hits.length === 0 && <span>没有对象满足生成的条件</span>}
            {queryResult.hits.length > 20 && <span>另有 {queryResult.hits.length - 20} 项</span>}
          </div>
          <div className="ai-query-save">
            <input aria-label="保存查询名称" value={queryName} onChange={(event) => setQueryName(event.target.value)} />
            <button className="primary" onClick={saveGeneratedQuery}>保存查询</button>
            <button className="ghost" onClick={() => setQueryResult(null)}>放弃</button>
          </div>
        </div>
      )}

      {task === 'fix' && fix && (
        <div className={`ai-fix-card ai-fix-${fix.dryRun.status}`}>
          <div className="ai-section-title">
            修复提案 · {fix.dryRun.status === 'pass' ? '✓ 验证通过' : fix.dryRun.status === 'warning' ? '⚠ 有警告' : '✕ 被拦截'}
          </div>
          <div className="ai-fix-summary">{fix.proposal.summary}</div>
          {fix.proposal.confirmations.length > 0 && (
            <ul className="ai-fix-confirmations">
              {fix.proposal.confirmations.map((item, index) => <li key={index}>待确认:{item}</li>)}
            </ul>
          )}
          {fix.ignoredEvidenceKeys.length > 0 && (
            <div className="hint">已忽略 {fix.ignoredEvidenceKeys.length} 个未知依据来源</div>
          )}
          <div className="ai-fix-ops">
            {fix.proposal.operations.map((operation) => {
              const opChange = fix.dryRun.changes.find((item) => item.operationId === operation.id);
              const opIssues = fix.dryRun.issues.filter((item) => item.operationId === operation.id);
              const checked = fix.selected.includes(operation.id);
              return (
                <div key={operation.id} className={`ai-fix-op ${checked ? '' : 'ai-fix-op-off'}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!!fix.appliedNote || fixBusy}
                      onChange={() => void reselectFix(checked
                        ? fix.selected.filter((id) => id !== operation.id)
                        : [...fix.selected, operation.id])}
                    />
                    <span className="ai-fix-op-target">{opChange?.target ?? operation.kind}</span>
                    <span className="ai-fix-op-confidence">信心 {Math.round(operation.confidence * 100)}%</span>
                  </label>
                  <div className="ai-fix-op-reason">{operation.reason}</div>
                  {opChange && (
                    <div className="ai-fix-diff">
                      <pre className="ai-fix-before">{opChange.before || '(空)'}</pre>
                      <pre className="ai-fix-after">{opChange.after || '(空)'}</pre>
                    </div>
                  )}
                  {opIssues.map((item, index) => (
                    <div key={index} className={item.severity === 'blocked' ? 'ai-fix-issue-blocked' : 'ai-fix-issue-warning'}>
                      {item.severity === 'blocked' ? '✕' : '⚠'} {item.message}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {fix.dryRun.issues.filter((item) => !item.operationId).map((item, index) => (
            <div key={index} className={item.severity === 'blocked' ? 'ai-fix-issue-blocked' : 'ai-fix-issue-warning'}>
              {item.severity === 'blocked' ? '✕' : '⚠'} {item.message}
            </div>
          ))}
          <div className="ai-fix-metrics">
            选中 {fix.selected.length}/{fix.proposal.operations.length} 项 · 改动 {fix.dryRun.metrics.changedChars.toLocaleString()} 字符
            {fix.dryRun.metrics.addedObjects > 0 && ` · 新增 ${fix.dryRun.metrics.addedObjects} 个对象`}
          </div>
          {fix.appliedNote ? (
            <div className="ai-fix-applied">✓ {fix.appliedNote}</div>
          ) : (
            <>
              {fix.dryRun.status === 'warning' && (
                <label className="ai-fix-confirm-warnings">
                  <input
                    type="checkbox"
                    checked={fix.confirmWarnings}
                    onChange={(event) => setFix((current) => current && { ...current, confirmWarnings: event.target.checked })}
                  />
                  已了解全部警告,仍要应用
                </label>
              )}
              <div className="ai-fix-actions">
                <button
                  className="primary"
                  disabled={fixBusy
                    || fix.dryRun.status === 'blocked'
                    || (fix.dryRun.status === 'warning' && !fix.confirmWarnings)}
                  onClick={() => void applyFix()}
                >
                  {fixBusy ? '处理中…' : '应用选中修改'}
                </button>
                <button className="ghost" disabled={fixBusy} onClick={() => setFix(null)}>放弃提案</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="ai-conversation">
        {activeSession?.messages.length ? activeSession.messages.map((message) => (
          <div key={message.id} className={`ai-message ${message.role}`}>
            <div className="ai-message-role">{message.role === 'user' ? '你' : '助手'}</div>
            <div className="ai-message-text">{message.text}</div>
            {message.citations && message.citations.length > 0 && (
              <div className="ai-citations">
                {message.citations.map((citation) => (
                  <button
                    key={citation.key}
                    className="ghost"
                    disabled={!citation.nav}
                    onClick={() => { if (citation.nav) go(citation.nav); }}
                  >
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
            <strong>{task === 'ask' ? '从当前叙事对象开始提问' : task === 'query' ? '用自然语言描述要找的内容' : '选择一个体检问题,生成修复提案'}</strong>
            <span>{task === 'ask'
              ? '助手只会收到上方列出的内容，并用可点击来源回答。'
              : task === 'query'
                ? '模型只生成固定查询条件，真实结果由本地索引计算。'
                : '提案先在项目副本上通过脚本、引用、体检和路径验证,预览差异后才能应用;应用可一步撤销。'}</span>
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
          placeholder={task === 'ask'
            ? '询问当前对象、检查矛盾或梳理线索…'
            : task === 'query'
              ? '例如：找出仍在草稿状态且未被引用的文档'
              : '可选:补充修复要求(如「优先复用已有变量」)…'}
          rows={3}
        />
        <div>
          <span className="hint">
            {task === 'query'
              ? `${PROVIDER_LABEL[loadLlmConfig().provider]} · 结果本地执行`
              : task === 'fix'
                ? `${PROVIDER_LABEL[loadLlmConfig().provider]} · 应用前本地验证`
              : bundle ? `${PROVIDER_LABEL[loadLlmConfig().provider]} · 发送前可见` : '等待上下文'}
          </span>
          {busy || fixBusy ? (
            <button onClick={() => abortRef.current?.abort()}>停止</button>
          ) : (
            <button
              className="primary"
              disabled={task === 'fix'
                ? (!bundle || contextBusy || !selectedIssue)
                : (!question.trim() || (task === 'ask' && (!bundle || contextBusy)))}
              onClick={() => void send()}
            >
              {task === 'ask' ? '发送' : task === 'query' ? '生成查询' : '生成修复提案'}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
