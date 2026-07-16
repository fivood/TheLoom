import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { confirmDialog } from '../../dialog';
import { useNav } from '../../search';
import { foreshadowStatus, groupDocsByChapter } from '../../planning';
import type { Foreshadow, ForeshadowStatus } from '../../types';
import { FORESHADOW_STATUS_LABEL } from '../../types';

const STATUS_ORDER: ForeshadowStatus[] = ['idea', 'planted', 'resolved', 'abandoned'];

export default function ForeshadowLedger({ focusId, onConsumeFocus }: {
  focusId: string | null;
  onConsumeFocus: () => void;
}) {
  const project = useLoom((s) => s.project);
  const { addForeshadow, updateForeshadow, removeForeshadow } = useLoom();
  const go = useNav((s) => s.go);
  const [filter, setFilter] = useState<ForeshadowStatus | 'all'>('all');
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (focusId) {
      setFilter('all');
      setHighlightId(focusId);
      onConsumeFocus();
    }
  }, [focusId]);
  useEffect(() => {
    if (highlightId) highlightRef.current?.scrollIntoView({ block: 'center' });
  }, [highlightId]);

  const foreshadows = project.foreshadows ?? [];
  const chapters = useMemo(
    () => groupDocsByChapter(project.documents, project.folders),
    [project.documents, project.folders],
  );
  const docName = (docId: string) => project.documents.find((d) => d.id === docId)?.name ?? '(已删除)';

  const counts = useMemo(() => {
    const c: Record<ForeshadowStatus, number> = { idea: 0, planted: 0, resolved: 0, abandoned: 0 };
    for (const f of foreshadows) c[foreshadowStatus(f)] += 1;
    return c;
  }, [foreshadows]);

  const shown = filter === 'all' ? foreshadows : foreshadows.filter((f) => foreshadowStatus(f) === filter);

  const refCell = (f: Foreshadow, kind: 'plants' | 'payoffs') => (
    <div className="fs-refs">
      {f[kind].map((ref) => (
        <span key={ref.id} className="fs-ref-chip" title={ref.note || '点击打开场景'}>
          <button className="fs-ref-open" onClick={() => go({ tab: 'documents', docId: ref.docId })}>{docName(ref.docId)}</button>
          <button
            className="chip-x"
            title="移除"
            onClick={() => updateForeshadow(f.id, (x) => { x[kind] = x[kind].filter((r) => r.id !== ref.id); })}
          >×</button>
        </span>
      ))}
      <select
        className="fs-ref-add"
        value=""
        onChange={(e) => {
          const docId = e.target.value;
          if (docId) updateForeshadow(f.id, (x) => { x[kind].push({ id: uid(), docId }); });
        }}
      >
        <option value="">＋ {kind === 'plants' ? '埋设于…' : '回收于…'}</option>
        {chapters.map((ch) => (
          <optgroup key={ch.key || 'none'} label={ch.label}>
            {ch.docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );

  return (
    <div className="pad-wrap" style={{ overflow: 'auto' }}>
      <div className="fs-toolbar">
        <button
          className="primary"
          onClick={() => addForeshadow({ id: uid(), title: '', note: '', plants: [], payoffs: [], createdAt: Date.now() })}
        >＋ 新伏笔</button>
        <button className={`fs-filter ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          全部 {foreshadows.length}
        </button>
        {STATUS_ORDER.map((s) => (
          <button key={s} className={`fs-filter fs-filter-${s} ${filter === s ? 'on' : ''}`} onClick={() => setFilter(s)}>
            {FORESHADOW_STATUS_LABEL[s]} {counts[s]}
          </button>
        ))}
        {counts.planted > 0 && (
          <span className="hint">⚠ 有 {counts.planted} 条伏笔埋了还没回收</span>
        )}
      </div>

      <table className="fs-table">
        <thead>
          <tr>
            <th style={{ width: 180 }}>伏笔</th>
            <th>备注</th>
            <th style={{ width: 230 }}>埋设</th>
            <th style={{ width: 230 }}>回收</th>
            <th style={{ width: 78 }}>状态</th>
            <th style={{ width: 70 }}></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((f) => {
            const status = foreshadowStatus(f);
            return (
              <tr key={f.id} ref={f.id === highlightId ? highlightRef : undefined} className={f.id === highlightId ? 'fs-highlight' : undefined}>
                <td>
                  <input
                    value={f.title}
                    placeholder="如:抽屉里的旧车票"
                    onChange={(e) => updateForeshadow(f.id, (x) => { x.title = e.target.value; })}
                  />
                </td>
                <td>
                  <input
                    value={f.note}
                    placeholder="它指向什么?打算何时揭晓?"
                    onChange={(e) => updateForeshadow(f.id, (x) => { x.note = e.target.value; })}
                  />
                </td>
                <td>{refCell(f, 'plants')}</td>
                <td>{refCell(f, 'payoffs')}</td>
                <td><span className={`fs-status fs-status-${status}`}>{FORESHADOW_STATUS_LABEL[status]}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className="ghost icon-btn"
                    title={f.abandoned ? '恢复追踪' : '标记弃用(不再打算回收)'}
                    onClick={() => updateForeshadow(f.id, (x) => { x.abandoned = !x.abandoned || undefined; })}
                  >{f.abandoned ? '↺' : '弃'}</button>
                  <button
                    className="ghost icon-btn"
                    title="删除"
                    onClick={async () => {
                      if (await confirmDialog({ message: `删除伏笔「${f.title || '(未命名)'}」?`, danger: true, confirmText: '删除' })) {
                        removeForeshadow(f.id);
                      }
                    }}
                  >×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.length === 0 && (
        <div className="empty-hint" style={{ padding: 24 }}>
          {foreshadows.length === 0 ? '还没有伏笔。把「将来要兑现的暗示」记在这里,埋设与回收都关联到场景' : '这个状态下没有伏笔'}
        </div>
      )}
    </div>
  );
}
