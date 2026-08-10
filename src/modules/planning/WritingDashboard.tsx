import { useMemo } from 'react';
import { useNav } from '../../search';
import { useLoom } from '../../store';
import type { Document, Folder, WritingCountMode } from '../../types';
import { DOC_STATUS_LABEL, DOCUMENT_FOLDER_ROLE_LABEL } from '../../types';
import { documentFolderAncestors, orderedDocumentFolders } from '../../documentStructure';
import {
  countDocumentWriting, dailyStatValue, recentWritingSeries, writingDateKey,
} from '../../writingProgress';

const COUNT_MODE_LABEL: Record<WritingCountMode, string> = {
  cjk: '中文字符',
  characters: '含标点字符',
  englishWords: '英文单词',
};

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function progressPercent(current: number, target: number | undefined): number | undefined {
  return target && target > 0 ? Math.round((current / target) * 100) : undefined;
}

function ProgressBar({ current, target }: { current: number; target?: number }) {
  const percent = progressPercent(current, target);
  return (
    <div className="writing-progress-meter" aria-label={percent === undefined ? '未设置目标' : `完成 ${percent}%`}>
      <span style={{ width: `${Math.min(100, percent ?? 0)}%` }} />
    </div>
  );
}

function TargetInput({ value, aggregated, onChange, label }: {
  value?: number;
  aggregated?: number;
  onChange: (value: number | undefined) => void;
  label: string;
}) {
  return (
    <input
      className="writing-target-input"
      type="number"
      min={1}
      step={100}
      value={value ?? ''}
      aria-label={label}
      placeholder={aggregated ? `≈${aggregated}` : '目标'}
      onChange={(event) => {
        const next = Number(event.target.value);
        onChange(event.target.value && Number.isFinite(next) && next > 0 ? Math.floor(next) : undefined);
      }}
    />
  );
}

export default function WritingDashboard() {
  const project = useLoom((state) => state.project);
  const update = useLoom((state) => state.update);
  const go = useNav((state) => state.go);
  const progress = project.writingProgress ?? {};
  const mode = progress.countMode ?? 'characters';
  const bodyOnly = progress.bodyOnly ?? false;
  const unit = mode === 'englishWords' ? '词' : '字';

  const documentCounts = useMemo(
    () => new Map(project.documents.map((document) => [
      document.id,
      countDocumentWriting(document, mode, bodyOnly),
    ])),
    [project.documents, mode, bodyOnly],
  );
  const total = [...documentCounts.values()].reduce((sum, value) => sum + value, 0);
  const doneTotal = useMemo(
    () => project.documents
      .filter((doc) => doc.status === 'done')
      .reduce((sum, doc) => sum + (documentCounts.get(doc.id) ?? 0), 0),
    [project.documents, documentCounts],
  );
  const series = useMemo(
    () => recentWritingSeries(progress),
    [progress],
  );
  const seriesValues = series.map((stat) => dailyStatValue(stat, mode, bodyOnly));
  const today = dailyStatValue(progress.daily?.find((stat) => stat.date === writingDateKey()), mode, bodyOnly);
  const weekTotal = seriesValues.reduce((sum, value) => sum + value, 0);
  const activeDays = seriesValues.filter((value) => value > 0).length;
  const maxDay = Math.max(1, ...seriesValues);

  const folders = useMemo(
    () => orderedDocumentFolders(project.folders).filter((folder) =>
      folder.documentRole === 'volume' || folder.documentRole === 'chapter'),
    [project.folders],
  );
  const folderDocuments = useMemo(() => {
    const result = new Map<string, Document[]>();
    for (const folder of folders) {
      result.set(folder.id, project.documents.filter((document) =>
        documentFolderAncestors(document.folderId, project.folders).some((ancestor) => ancestor.id === folder.id)));
    }
    return result;
  }, [folders, project.documents, project.folders]);

  const effectiveTargets = useMemo(() => {
    const result = new Map<string, number>();
    for (let i = folders.length - 1; i >= 0; i--) {
      const folder = folders[i];
      const manual = progress.folderTargets?.[folder.id];
      if (manual) { result.set(folder.id, manual); continue; }
      let sum = 0;
      let hasChild = false;
      for (const child of folders) {
        if (child.parentId === folder.id) {
          const t = result.get(child.id);
          if (t !== undefined) { sum += t; hasChild = true; }
        }
      }
      for (const doc of project.documents) {
        if (doc.folderId === folder.id && doc.wordTarget) {
          sum += doc.wordTarget;
          hasChild = true;
        }
      }
      if (hasChild) result.set(folder.id, sum);
    }
    return result;
  }, [folders, progress.folderTargets, project.documents]);

  const folderDoneWords = useMemo(() => {
    const result = new Map<string, number>();
    for (const folder of folders) {
      const docs = folderDocuments.get(folder.id) ?? [];
      result.set(folder.id, docs
        .filter((doc) => doc.status === 'done')
        .reduce((sum, doc) => sum + (documentCounts.get(doc.id) ?? 0), 0));
    }
    return result;
  }, [folders, folderDocuments, documentCounts]);

  const projectEffectiveTarget = useMemo(() => {
    if (progress.projectTarget) return progress.projectTarget;
    const topFolders = folders.filter((f) =>
      !f.parentId || !folders.some((p) => p.id === f.parentId));
    let sum = 0;
    let has = false;
    for (const f of topFolders) {
      const t = effectiveTargets.get(f.id);
      if (t !== undefined) { sum += t; has = true; }
    }
    return has ? sum : undefined;
  }, [progress.projectTarget, folders, effectiveTargets]);

  const projectAggregated = !progress.projectTarget ? projectEffectiveTarget : undefined;

  const currentRevision = Math.max(0, ...project.documents.map((document) => document.revision ?? 0));
  const revisionCount = currentRevision
    ? project.documents.filter((document) => document.revision === currentRevision).length
    : 0;
  const recentDocuments = [...project.documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const allUnresolvedAnnotations = (project.annotations ?? [])
    .filter((annotation) => !annotation.resolved)
    .sort((a, b) => b.createdAt - a.createdAt);
  const unresolvedAnnotations = allUnresolvedAnnotations.slice(0, 6);
  const allPendingForeshadows = (project.foreshadows ?? [])
    .filter((item) => !item.abandoned && item.plants.length > 0 && item.payoffs.length === 0);
  const pendingForeshadows = allPendingForeshadows.slice(0, 6);
  const allUnderTargetChapters = folders
    .filter((folder) => folder.documentRole === 'chapter')
    .map((folder) => {
      const done = folderDoneWords.get(folder.id) ?? 0;
      const target = effectiveTargets.get(folder.id);
      return { folder, done, target };
    })
    .filter((item) => item.target && item.done < item.target)
    .sort((a, b) => (a.done / (a.target ?? 1)) - (b.done / (b.target ?? 1)));
  const underTargetChapters = allUnderTargetChapters.slice(0, 6);

  const doneScenes = project.documents.filter((doc) => doc.status === 'done').length;

  const setProgress = (mutate: (state: NonNullable<typeof project.writingProgress>) => void) => {
    update((draft) => {
      draft.writingProgress ??= {};
      mutate(draft.writingProgress);
    });
  };
  const setFolderTarget = (folderId: string, value: number | undefined) => {
    setProgress((state) => {
      state.folderTargets ??= {};
      if (value) state.folderTargets[folderId] = value;
      else delete state.folderTargets[folderId];
    });
  };
  const folderDepth = (folder: Folder) => documentFolderAncestors(folder.id, project.folders).length - 1;
  const openDocument = (documentId: string, blockId?: string) =>
    go({ tab: 'documents', docId: documentId, blockId });

  return (
    <div className="writing-dashboard">
      <div className="writing-dashboard-head">
        <div>
          <h2>写作进度</h2>
          <p>场景标记「完成」后计入进度。目标可逐级设定，也可由子级自动汇总。</p>
        </div>
        <div className="writing-count-controls">
          <label>
            统计口径
            <select
              value={mode}
              onChange={(event) => setProgress((state) => {
                state.countMode = event.target.value as WritingCountMode;
              })}
            >
              {Object.entries(COUNT_MODE_LABEL).map(([value, label]) =>
                <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="writing-body-toggle">
            <input
              type="checkbox"
              checked={bodyOnly}
              onChange={(event) => setProgress((state) => { state.bodyOnly = event.target.checked; })}
            />
            仅正文
          </label>
        </div>
      </div>

      <div className="writing-summary-grid">
        <section className="writing-summary-card">
          <span>完成进度</span>
          <strong>{formatCount(doneTotal)} <small>{unit}</small></strong>
          <div className="writing-summary-target">
            <TargetInput
              value={progress.projectTarget}
              aggregated={projectAggregated}
              label="全书目标"
              onChange={(value) => setProgress((state) => { state.projectTarget = value; })}
            />
            <em>{projectEffectiveTarget ? `${progressPercent(doneTotal, projectEffectiveTarget)}%` : '—'}</em>
          </div>
          <ProgressBar current={doneTotal} target={projectEffectiveTarget} />
          <small className="writing-summary-detail">{doneScenes} 个场景已完成 · 全书共 {formatCount(total)} {unit}</small>
        </section>
        <section className="writing-summary-card accent">
          <span>今日新增</span>
          <strong>+{formatCount(today)} <small>{unit}</small></strong>
          <p>{today > 0 ? '已记录在项目历史中' : '今天还没有新增正文'}</p>
        </section>
        <section className="writing-summary-card">
          <span>最近七日</span>
          <strong>{formatCount(weekTotal)} <small>{unit}</small></strong>
          <p>{activeDays} 天有写作 · 日均 {formatCount(Math.round(weekTotal / 7))}</p>
        </section>
        <section className="writing-summary-card">
          <span>当前修订轮次</span>
          <strong>{currentRevision ? `第 ${currentRevision} 稿` : '未设置'}</strong>
          <p>{currentRevision ? `${revisionCount} / ${project.documents.length} 个场景已进入本轮` : '可在场景属性或结构管理中设置'}</p>
          {currentRevision > 0 && <ProgressBar current={revisionCount} target={project.documents.length} />}
        </section>
      </div>

      <div className="writing-dashboard-grid">
        <section className="writing-panel writing-targets-panel">
          <div className="writing-panel-title">
            <div>
              <h3>目标树</h3>
              <p>进度只计「完成」场景，目标未设时由子级汇总</p>
            </div>
            <span>{COUNT_MODE_LABEL[mode]}{bodyOnly ? ' · 仅正文' : ''}</span>
          </div>
          <div className="writing-target-tree">
            {folders.map((folder) => {
              const documents = folderDocuments.get(folder.id) ?? [];
              const done = folderDoneWords.get(folder.id) ?? 0;
              const totalWords = documents.reduce((sum, doc) => sum + (documentCounts.get(doc.id) ?? 0), 0);
              const manualTarget = progress.folderTargets?.[folder.id];
              const effective = effectiveTargets.get(folder.id);
              const aggregated = !manualTarget ? effective : undefined;
              const percent = progressPercent(done, effective);
              const doneCount = documents.filter((doc) => doc.status === 'done').length;
              return (
                <div key={folder.id} className={`writing-target-group writing-target-${folder.documentRole}`}>
                  <div className="writing-target-row" style={{ paddingLeft: 14 + folderDepth(folder) * 18 }}>
                    <span className="writing-role">{DOCUMENT_FOLDER_ROLE_LABEL[folder.documentRole!]}</span>
                    <strong title={folder.name}>{folder.name}</strong>
                    <span className="writing-target-count">
                      {formatCount(done)}{effective ? ` / ${formatCount(effective)}` : ''}
                      <small title={`共 ${formatCount(totalWords)} ${unit}，${doneCount}/${documents.length} 场景完成`}>
                        {' '}({doneCount}/{documents.length})
                      </small>
                    </span>
                    <TargetInput
                      value={manualTarget}
                      aggregated={aggregated}
                      label={`${folder.name}目标`}
                      onChange={(value) => setFolderTarget(folder.id, value)}
                    />
                    <span className="writing-target-percent">{percent === undefined ? '—' : `${percent}%`}</span>
                  </div>
                  <ProgressBar current={done} target={effective} />
                  {folder.documentRole === 'chapter' && documents.map((document) => {
                    const count = documentCounts.get(document.id) ?? 0;
                    const isDone = document.status === 'done';
                    const scenePercent = progressPercent(isDone ? count : 0, document.wordTarget);
                    return (
                      <div key={document.id} className={`writing-scene-row${isDone ? ' scene-done' : ''}`}>
                        <span className={`writing-scene-status status-${document.status ?? 'outline'}`} title={DOC_STATUS_LABEL[document.status ?? 'outline']}>
                          {DOC_STATUS_LABEL[document.status ?? 'outline']}
                        </span>
                        <button className="writing-scene-open" onClick={() => openDocument(document.id)}>
                          {document.name}
                        </button>
                        <span>{formatCount(count)}{document.wordTarget ? ` / ${formatCount(document.wordTarget)}` : ''}</span>
                        <TargetInput
                          value={document.wordTarget}
                          label={`${document.name}目标`}
                          onChange={(value) => update((draft) => {
                            const found = draft.documents.find((item) => item.id === document.id);
                            if (found) found.wordTarget = value;
                          })}
                        />
                        <span>{scenePercent === undefined ? '—' : `${scenePercent}%`}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {folders.length === 0 && (
              <div className="empty-hint">先在场景导航中建立"卷"和"章"，这里就会生成四级目标树。</div>
            )}
          </div>
        </section>

        <section className="writing-panel">
          <div className="writing-panel-title">
            <div>
              <h3>最近七日</h3>
              <p>新增量只计算正向变化</p>
            </div>
            <span>共 {formatCount(weekTotal)} {unit}</span>
          </div>
          <div className="writing-week-chart" role="img" aria-label="最近七日写作新增趋势">
            {series.map((stat, index) => {
              const value = seriesValues[index];
              const date = new Date(`${stat.date}T12:00:00`);
              return (
                <div key={stat.date} className="writing-week-day" title={`${stat.date} · ${value} ${unit}`}>
                  <span className="writing-week-value">{value ? formatCount(value) : ''}</span>
                  <div><i style={{ height: `${Math.max(value ? 6 : 1, (value / maxDay) * 100)}%` }} /></div>
                  <small>{date.toLocaleDateString('zh-CN', { weekday: 'short' })}</small>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="writing-followup-grid">
        <section className="writing-panel writing-followup">
          <h3>最近编辑 <span>{recentDocuments.length}</span></h3>
          {recentDocuments.map((document) => (
            <button key={document.id} onClick={() => openDocument(document.id)}>
              <strong>{document.name}</strong>
              <small>{new Date(document.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
            </button>
          ))}
          {recentDocuments.length === 0 && <p className="empty-hint">还没有场景</p>}
        </section>
        <section className="writing-panel writing-followup">
          <h3>未完成批注 <span>{allUnresolvedAnnotations.length}</span></h3>
          {unresolvedAnnotations.map((annotation) => (
            <button key={annotation.id} onClick={() => openDocument(annotation.docId, annotation.blockId)}>
              <strong>{annotation.text || '未命名批注'}</strong>
              <small>{project.documents.find((document) => document.id === annotation.docId)?.name ?? '已删除场景'}</small>
            </button>
          ))}
          {unresolvedAnnotations.length === 0 && <p className="empty-hint">没有待处理批注</p>}
        </section>
        <section className="writing-panel writing-followup">
          <h3>待回收伏笔 <span>{allPendingForeshadows.length}</span></h3>
          {pendingForeshadows.map((item) => (
            <button
              key={item.id}
              onClick={() => go({ tab: 'planning', planningView: 'foreshadow', foreshadowId: item.id })}
            >
              <strong>{item.title || '未命名伏笔'}</strong>
              <small>{item.plants.length} 处埋设 · 尚未回收</small>
            </button>
          ))}
          {pendingForeshadows.length === 0 && <p className="empty-hint">没有待回收伏笔</p>}
        </section>
        <section className="writing-panel writing-followup">
          <h3>未达标章节 <span>{allUnderTargetChapters.length}</span></h3>
          {underTargetChapters.map((item) => (
            <button
              key={item.folder.id}
              onClick={() => {
                const docs = folderDocuments.get(item.folder.id);
                if (docs?.[0]) openDocument(docs[0].id);
              }}
            >
              <strong>{item.folder.name}</strong>
              <small>{formatCount(item.done)} / {formatCount(item.target!)} · {progressPercent(item.done, item.target)}%</small>
            </button>
          ))}
          {underTargetChapters.length === 0 && <p className="empty-hint">已设目标的章节均已达标</p>}
        </section>
      </div>
    </div>
  );
}
