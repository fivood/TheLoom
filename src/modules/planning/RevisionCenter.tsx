import { useEffect, useMemo, useState } from 'react';
import { alertDialog, confirmDialog } from '../../dialog';
import { proofreadProject, PROOFREADING_CATEGORY_LABEL, type ProofreadingCategory } from '../../proofreading';
import { useNav } from '../../search';
import { useLoom } from '../../store';
import type { RevisionDecision } from '../../types';
import {
  createRevisionTask, revisionTaskCounts, revisionTaskStatus, setRevisionDecision,
  type RevisionTaskStatus,
} from '../../revisionWorkflow';

const STATUS_LABEL: Record<RevisionTaskStatus, string> = {
  open: '待审阅',
  discuss: '待议',
  completed: '已完成',
};

const DECISION_LABEL: Record<RevisionDecision, string> = {
  accept: '接受修改',
  keep: '保留原文',
  discuss: '标记待议',
};

type CenterTab = 'tasks' | 'proofreading';
type TaskFilter = 'all' | RevisionTaskStatus;

export default function RevisionCenter() {
  const project = useLoom((state) => state.project);
  const update = useLoom((state) => state.update);
  const go = useNav((state) => state.go);
  const tasks = useMemo(
    () => [...(project.revisionTasks ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
    [project.revisionTasks],
  );
  const snapshots = useMemo(
    () => [...(project.docSnapshots ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [project.docSnapshots],
  );
  const proofIssues = useMemo(() => proofreadProject(project), [project]);
  const ignored = useMemo(() => new Set(project.proofreadingIgnores ?? []), [project.proofreadingIgnores]);
  const [tab, setTab] = useState<CenterTab>('tasks');
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(tasks[0]?.id ?? null);
  const [proofCategory, setProofCategory] = useState<ProofreadingCategory | 'all'>('all');
  const [proofQuery, setProofQuery] = useState('');
  const [showReviewed, setShowReviewed] = useState(false);

  const taskStatusCounts = useMemo(() => ({
    open: tasks.filter((task) => revisionTaskStatus(task) === 'open').length,
    discuss: tasks.filter((task) => revisionTaskStatus(task) === 'discuss').length,
    completed: tasks.filter((task) => revisionTaskStatus(task) === 'completed').length,
  }), [tasks]);
  const visibleTasks = tasks.filter((task) => taskFilter === 'all' || revisionTaskStatus(task) === taskFilter);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedDocument = selectedTask
    ? project.documents.find((document) => document.id === selectedTask.docId)
    : null;
  const openProofCount = proofIssues.filter((issue) => !ignored.has(issue.id)).length;
  const proofCategoryCounts = useMemo(() => ({
    duplicate: proofIssues.filter((issue) => issue.category === 'duplicate' && !ignored.has(issue.id)).length,
    punctuation: proofIssues.filter((issue) => issue.category === 'punctuation' && !ignored.has(issue.id)).length,
    width: proofIssues.filter((issue) => issue.category === 'width' && !ignored.has(issue.id)).length,
    name: proofIssues.filter((issue) => issue.category === 'name' && !ignored.has(issue.id)).length,
  }), [proofIssues, ignored]);
  const visibleProof = proofIssues.filter((issue) => {
    if (!showReviewed && ignored.has(issue.id)) return false;
    if (proofCategory !== 'all' && issue.category !== proofCategory) return false;
    if (!proofQuery.trim()) return true;
    const documentName = issue.docId
      ? project.documents.find((document) => document.id === issue.docId)?.name ?? ''
      : '';
    const query = proofQuery.trim().toLocaleLowerCase();
    return `${documentName} ${issue.message} ${issue.excerpt}`.toLocaleLowerCase().includes(query);
  });

  useEffect(() => {
    if (selectedTaskId && tasks.some((task) => task.id === selectedTaskId)) return;
    setSelectedTaskId(visibleTasks[0]?.id ?? tasks[0]?.id ?? null);
  }, [tasks, selectedTaskId, taskFilter]);

  const createTask = async (snapshotId: string) => {
    const task = createRevisionTask(project, snapshotId);
    if (!task) {
      await alertDialog({ message: '这个快照与当前正文没有可审阅的行级差异。' });
      return;
    }
    update((draft) => {
      draft.revisionTasks ??= [];
      draft.revisionTasks.push(task);
    });
    setSelectedTaskId(task.id);
    setTab('tasks');
    setTaskFilter('all');
  };
  const decide = (changeId: string, decision: RevisionDecision | undefined) => {
    if (!selectedTask) return;
    update((draft) => {
      setRevisionDecision(draft, selectedTask.id, changeId, decision);
    });
  };
  const removeTask = async () => {
    if (!selectedTask || !await confirmDialog({
      message: `删除修订任务「${selectedTask.title}」？正文和快照都不会受影响。`,
      danger: true,
      confirmText: '删除任务',
    })) return;
    update((draft) => {
      draft.revisionTasks = (draft.revisionTasks ?? []).filter((task) => task.id !== selectedTask.id);
    });
  };
  const setReviewed = (issueId: string, reviewed: boolean) => {
    update((draft) => {
      const ids = new Set(draft.proofreadingIgnores ?? []);
      if (reviewed) ids.add(issueId);
      else ids.delete(issueId);
      draft.proofreadingIgnores = [...ids];
    });
  };
  const openIssue = (issue: typeof proofIssues[number]) => {
    if (issue.docId) go({ tab: 'documents', docId: issue.docId, blockId: issue.blockId });
    else if (issue.entityId) go({ tab: 'entities', entityId: issue.entityId });
  };

  return (
    <div className="revision-center">
      <div className="revision-center-head">
        <div>
          <h2>修订与校对</h2>
          <p>把快照差异变成逐项决策；校对结论只做记录，不会自动覆盖正文。</p>
        </div>
        <div className="revision-center-tabs">
          <button className={tab === 'tasks' ? 'primary' : undefined} onClick={() => setTab('tasks')}>
            修订任务 {tasks.length}
          </button>
          <button className={tab === 'proofreading' ? 'primary' : undefined} onClick={() => setTab('proofreading')}>
            中文校对 {openProofCount}
          </button>
        </div>
      </div>

      <div className="revision-summary-grid">
        <div><span>待审阅</span><strong>{taskStatusCounts.open}</strong></div>
        <div><span>待议</span><strong>{taskStatusCounts.discuss}</strong></div>
        <div><span>已完成</span><strong>{taskStatusCounts.completed}</strong></div>
        <div><span>可用快照</span><strong>{snapshots.length}</strong></div>
        <div><span>待校对</span><strong>{openProofCount}</strong></div>
      </div>

      {tab === 'tasks' ? (
        <div className="revision-workspace">
          <aside className="revision-sidebar">
            <div className="revision-filter-row">
              {(['all', 'open', 'discuss', 'completed'] as TaskFilter[]).map((status) => (
                <button
                  key={status}
                  className={taskFilter === status ? 'active' : undefined}
                  onClick={() => setTaskFilter(status)}
                >
                  {status === 'all' ? `全部 ${tasks.length}` : `${STATUS_LABEL[status]} ${taskStatusCounts[status]}`}
                </button>
              ))}
            </div>
            <div className="revision-task-list">
              {visibleTasks.map((task) => {
                const status = revisionTaskStatus(task);
                const counts = revisionTaskCounts(task);
                return (
                  <button
                    key={task.id}
                    className={selectedTaskId === task.id ? 'active' : undefined}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <span><i className={`revision-status-dot status-${status}`} />{STATUS_LABEL[status]}</span>
                    <strong>{task.title}</strong>
                    <small>{counts.decided} / {counts.total} 项已有结论 · {new Date(task.updatedAt).toLocaleDateString()}</small>
                  </button>
                );
              })}
              {visibleTasks.length === 0 && <div className="empty-hint">这个筛选下没有修订任务</div>}
            </div>
            <div className="revision-snapshot-source">
              <h3>从快照建立任务</h3>
              <p>任务会冻结当前差异，之后继续改正文也不会改变已审阅内容。</p>
              {snapshots.slice(0, 20).map((snapshot) => {
                const document = project.documents.find((item) => item.id === snapshot.docId);
                const existing = tasks.find((task) => task.snapshotId === snapshot.id);
                return (
                  <div key={snapshot.id}>
                    <span>
                      <strong>{document?.name ?? '已删除场景'}</strong>
                      <small>{snapshot.label} · {new Date(snapshot.createdAt).toLocaleDateString()}</small>
                    </span>
                    <button
                      className="ghost"
                      onClick={() => {
                        if (existing) setSelectedTaskId(existing.id);
                        else void createTask(snapshot.id);
                      }}
                    >{existing ? '打开' : '建立'}</button>
                  </div>
                );
              })}
              {snapshots.length === 0 && <div className="empty-hint">先在场景属性中保存快照</div>}
            </div>
          </aside>

          <section className="revision-detail">
            {selectedTask ? (
              <>
                <div className="revision-detail-head">
                  <div>
                    <span className={`revision-task-state state-${revisionTaskStatus(selectedTask)}`}>
                      {STATUS_LABEL[revisionTaskStatus(selectedTask)]}
                    </span>
                    <h3>{selectedTask.title}</h3>
                    <p>
                      快照「{selectedTask.snapshotLabel}」 · {revisionTaskCounts(selectedTask).decided} / {selectedTask.changes.length} 项已有结论
                    </p>
                  </div>
                  <div>
                    <button
                      className="ghost"
                      disabled={!selectedDocument}
                      onClick={() => selectedDocument && go({ tab: 'documents', docId: selectedDocument.id })}
                    >打开场景</button>
                    <button className="ghost danger" onClick={() => void removeTask()}>删除任务</button>
                  </div>
                </div>
                <div className="revision-change-list">
                  {selectedTask.changes.map((change, index) => (
                    <article key={change.id} className={`revision-change-card decision-${change.decision ?? 'none'}`}>
                      <header>
                        <strong>差异 {index + 1}</strong>
                        <span>{change.decision ? DECISION_LABEL[change.decision] : '尚未决定'}</span>
                      </header>
                      <div className="revision-change-compare">
                        <div>
                          <label>快照原文</label>
                          {change.oldText.length
                            ? change.oldText.map((line, lineIndex) => <p key={lineIndex} className="revision-old">− {line || '（空行）'}</p>)
                            : <p className="revision-empty">（原文没有这一段）</p>}
                        </div>
                        <div>
                          <label>当前修改</label>
                          {change.newText.length
                            ? change.newText.map((line, lineIndex) => <p key={lineIndex} className="revision-new">+ {line || '（空行）'}</p>)
                            : <p className="revision-empty">（当前版本已删除）</p>}
                        </div>
                      </div>
                      <footer>
                        {(['accept', 'keep', 'discuss'] as RevisionDecision[]).map((decision) => (
                          <button
                            key={decision}
                            className={change.decision === decision ? 'primary' : 'ghost'}
                            title={decision === 'accept'
                              ? '认可当前修改，不改正文'
                              : decision === 'keep'
                                ? '记录为应保留快照原文，稍后手工处理'
                                : '暂不定稿，保持任务未完成'}
                            onClick={() => decide(change.id, change.decision === decision ? undefined : decision)}
                          >{DECISION_LABEL[decision]}</button>
                        ))}
                      </footer>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-hint">从左侧快照建立修订任务，或选择已有任务继续审阅。</div>
            )}
          </section>
        </div>
      ) : (
        <div className="proofreading-workspace">
          <div className="proofreading-toolbar">
            <button className={proofCategory === 'all' ? 'active' : undefined} onClick={() => setProofCategory('all')}>
              全部 {openProofCount}
            </button>
            {(Object.keys(PROOFREADING_CATEGORY_LABEL) as ProofreadingCategory[]).map((category) => (
              <button
                key={category}
                className={proofCategory === category ? 'active' : undefined}
                onClick={() => setProofCategory(category)}
              >
                {PROOFREADING_CATEGORY_LABEL[category]} {proofCategoryCounts[category]}
              </button>
            ))}
            <input
              value={proofQuery}
              placeholder="筛选场景或问题…"
              onChange={(event) => setProofQuery(event.target.value)}
            />
            <label>
              <input type="checkbox" checked={showReviewed} onChange={(event) => setShowReviewed(event.target.checked)} />
              显示已核对
            </label>
          </div>
          <div className="proofreading-list">
            {visibleProof.slice(0, 300).map((issue) => {
              const reviewed = ignored.has(issue.id);
              const documentName = issue.docId
                ? project.documents.find((document) => document.id === issue.docId)?.name
                : undefined;
              return (
                <article key={issue.id} className={reviewed ? 'reviewed' : undefined}>
                  <button className="proofreading-main" onClick={() => openIssue(issue)}>
                    <span className={`proofreading-kind kind-${issue.category}`}>{PROOFREADING_CATEGORY_LABEL[issue.category]}</span>
                    <span>
                      <strong>{issue.message}</strong>
                      <small>{documentName ? `${documentName} · ` : ''}{issue.excerpt}</small>
                      <em>{issue.suggestion}</em>
                    </span>
                  </button>
                  <button
                    className={reviewed ? 'ghost' : undefined}
                    onClick={() => setReviewed(issue.id, !reviewed)}
                  >{reviewed ? '重新打开' : '标为已核对'}</button>
                </article>
              );
            })}
            {visibleProof.length > 300 && (
              <div className="proofreading-limit">当前筛选有 {visibleProof.length} 项，仅显示前 300 项；可按类型或场景继续筛选。</div>
            )}
            {visibleProof.length === 0 && (
              <div className="empty-hint">{showReviewed ? '当前筛选没有校对项' : '当前筛选下没有待校对问题'}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
