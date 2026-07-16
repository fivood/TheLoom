import { useMemo, useState } from 'react';
import { useLoom } from '../../store';
import { useNav } from '../../search';
import { groupDocsByChapter } from '../../planning';
import { documentWordCount } from '../../util';
import type { DocStatus, Document } from '../../types';
import { DOC_STATUS_LABEL, DOC_STATUS_ORDER } from '../../types';

function snippet(d: Document): string {
  for (const b of d.blocks) {
    if ((b.type === 'action' || b.type === 'dialogue') && b.text.trim()) {
      return b.text.trim().slice(0, 72);
    }
  }
  return '';
}

export default function SceneWall() {
  const project = useLoom((s) => s.project);
  const update = useLoom((s) => s.update);
  const go = useNav((s) => s.go);
  const [statusFilter, setStatusFilter] = useState<DocStatus | 'all'>('all');
  const [dragId, setDragId] = useState<string | null>(null);

  const chapters = useMemo(
    () => groupDocsByChapter(project.documents, project.folders),
    [project.documents, project.folders],
  );
  const entityName = (id?: string) => (id ? project.entities.find((e) => e.id === id)?.name : undefined);

  const statusCounts = useMemo(() => {
    const c: Record<DocStatus, number> = { outline: 0, draft: 0, revising: 0, done: 0 };
    for (const d of project.documents) if (d.status) c[d.status] += 1;
    return c;
  }, [project.documents]);

  // 同章内拖拽排序:重排后把该章场景的 order 物化为新顺序
  const dropOn = (chapterDocs: Document[], targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = chapterDocs.map((d) => d.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    update((p) => {
      for (const d of p.documents) {
        const idx = ids.indexOf(d.id);
        if (idx >= 0) d.order = idx;
      }
    });
  };

  return (
    <div className="pad-wrap" style={{ overflow: 'auto' }}>
      <div className="fs-toolbar">
        <button className={`fs-filter ${statusFilter === 'all' ? 'on' : ''}`} onClick={() => setStatusFilter('all')}>
          全部 {project.documents.length}
        </button>
        {DOC_STATUS_ORDER.map((s) => (
          <button key={s} className={`fs-filter ${statusFilter === s ? 'on' : ''}`} onClick={() => setStatusFilter(s)}>
            {DOC_STATUS_LABEL[s]} {statusCounts[s]}
          </button>
        ))}
        <span className="hint">同一章内拖拽卡片可调整场景顺序;点击卡片打开场景</span>
      </div>

      {chapters.map((ch) => {
        const shown = statusFilter === 'all' ? ch.docs : ch.docs.filter((d) => d.status === statusFilter);
        if (shown.length === 0) return null;
        const words = ch.docs.reduce((s, d) => s + documentWordCount(d), 0);
        return (
          <section key={ch.key || 'none'} className="wall-chapter">
            <header className="wall-chapter-head">
              <strong>{ch.label}</strong>
              <span className="hint">{ch.docs.length} 场 · {words} 字</span>
            </header>
            <div className="wall-grid">
              {shown.map((d) => (
                <div
                  key={d.id}
                  className={`wall-card ${dragId === d.id ? 'dragging' : ''}`}
                  draggable={statusFilter === 'all'}
                  onDragStart={() => setDragId(d.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => { if (dragId) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); dropOn(ch.docs, d.id); setDragId(null); }}
                  onClick={() => go({ tab: 'documents', docId: d.id })}
                >
                  <div className="wall-card-head">
                    <span className="wall-card-name">{d.name}</span>
                    {d.status && <span className={`ms-status ms-status-${d.status}`}>{DOC_STATUS_LABEL[d.status]}</span>}
                  </div>
                  <div className="wall-card-snippet">{snippet(d) || '(空场景)'}</div>
                  <div className="wall-card-meta">
                    {entityName(d.povId) && <span title="POV 角色">◉ {entityName(d.povId)}</span>}
                    {entityName(d.locationId) && <span title="地点">▪ {entityName(d.locationId)}</span>}
                    {d.timeLabel && <span title="故事时间">⏱ {d.timeLabel}</span>}
                    <span className="wall-card-words">{documentWordCount(d)} 字</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {project.documents.length === 0 && (
        <div className="empty-hint" style={{ padding: 24 }}>还没有场景文档。在「文档」模块用文件夹建卷 / 章,每个文档就是一个场景</div>
      )}
    </div>
  );
}
