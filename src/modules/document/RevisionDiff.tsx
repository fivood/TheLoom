import { useMemo, useState } from 'react';
import { useLoom } from '../../store';
import Icon from '../../components/Icon';
import type { DocBlock, DocSnapshot, Document } from '../../types';
import { diffLines, diffStats, docLines } from '../../revision';

const CURRENT = '__current__';

export default function RevisionDiff({ doc, initialLeftId, onClose }: {
  doc: Document;
  initialLeftId?: string;
  onClose: () => void;
}) {
  const entities = useLoom((s) => s.project.entities);
  const allSnapshots = useLoom((s) => s.project.docSnapshots);
  const ordered = useMemo(
    () => (allSnapshots ?? []).filter((x) => x.docId === doc.id).sort((a, b) => b.createdAt - a.createdAt),
    [allSnapshots, doc.id],
  );

  const [leftId, setLeftId] = useState<string>(initialLeftId ?? ordered[0]?.id ?? CURRENT);
  const [rightId, setRightId] = useState<string>(CURRENT);

  const label = (s: DocSnapshot) =>
    `${s.label || '(未命名)'} · ${new Date(s.createdAt).toLocaleString()}${s.revision ? ` · 第 ${s.revision} 稿` : ''}`;

  const blocksOf = (id: string): DocBlock[] =>
    id === CURRENT ? doc.blocks : (ordered.find((s) => s.id === id)?.blocks ?? []);

  const ops = useMemo(
    () => diffLines(docLines(blocksOf(leftId), entities), docLines(blocksOf(rightId), entities)),
    [leftId, rightId, doc.blocks, ordered, entities],
  );
  const stats = diffStats(ops);
  const changed = stats.added > 0 || stats.removed > 0;

  const versionSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
      <option value={CURRENT}>当前正文</option>
      {ordered.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
    </select>
  );

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel diff-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <span><Icon name="script" size={14} /> 版本差异 · {doc.name}</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="diff-pickers">
            <span className="hint">旧版</span>
            {versionSelect(leftId, setLeftId)}
            <span className="hint">→ 新版</span>
            {versionSelect(rightId, setRightId)}
          </div>
          <div className="diff-summary">
            {changed
              ? <>共 <b className="diff-add-ink">+{stats.added}</b> / <b className="diff-del-ink">−{stats.removed}</b> 行变化</>
              : '两个版本完全一致'}
          </div>
          <div className="diff-lines">
            {ops.map((op, i) => (
              <div key={i} className={`diff-line diff-${op.type}`}>
                <span className="diff-sign">{op.type === 'add' ? '+' : op.type === 'del' ? '−' : ''}</span>
                <span className="diff-text">{op.text || ' '}</span>
              </div>
            ))}
            {ops.length === 0 && <div className="empty-hint" style={{ padding: 18 }}>两个版本都是空的</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
