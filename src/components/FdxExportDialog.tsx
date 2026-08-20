import { useMemo, useState } from 'react';
import { useLoom } from '../store';
import Icon from './Icon';
import { useEscape } from '../hooks/useEscape';
import { toast } from '../toast';
import { paragraphsToFdx, documentToParagraphs, flowToParagraphs } from '../interop/fdx';

/** C5 Final Draft 导出:勾选参与的流程与文档,不再只有「全项目合并」一种口径 */
export default function FdxExportDialog({ onClose }: { onClose: () => void }) {
  const flows = useLoom((s) => s.project.flows);
  const documents = useLoom((s) => s.project.documents);
  const entities = useLoom((s) => s.project.entities);
  const projectName = useLoom((s) => s.project.name);
  const [flowIds, setFlowIds] = useState<Set<string>>(() => new Set(flows.map((f) => f.id)));
  const [docIds, setDocIds] = useState<Set<string>>(() => new Set(documents.map((d) => d.id)));
  useEscape(true, onClose);

  const total = flowIds.size + docIds.size;
  const toggle = (set: Set<string>, id: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    apply(next);
  };

  const doExport = () => {
    const paras = [
      ...flows.filter((f) => flowIds.has(f.id)).flatMap((f) => flowToParagraphs(f, entities)),
      ...documents.filter((d) => docIds.has(d.id)).flatMap((d) => documentToParagraphs(d, entities)),
    ];
    const xml = paragraphsToFdx(paras, projectName);
    const blob = new Blob([xml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${projectName || 'theloom'}.fdx`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`已导出 Final Draft(${flowIds.size} 个流程 · ${docIds.size} 篇文档)`);
    onClose();
  };

  const groups = useMemo(() => ([
    { label: '流程', items: flows.map((f) => ({ id: f.id, name: f.name })), sel: flowIds, apply: setFlowIds },
    { label: '文档', items: documents.map((d) => ({ id: d.id, name: d.name })), sel: docIds, apply: setDocIds },
  ]), [flows, documents, flowIds, docIds]);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <Icon name="doc" size={14} />
          <span>导出 Final Draft .fdx</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="field" style={{ margin: 0 }}>
            <label>参与导出({total} / {flows.length + documents.length})</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <button className="ghost" onClick={() => { setFlowIds(new Set(flows.map((f) => f.id))); setDocIds(new Set(documents.map((d) => d.id))); }}>全选</button>
              <button className="ghost" onClick={() => { setFlowIds(new Set()); setDocIds(new Set()); }}>清空</button>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 12 }}>
              {groups.map((g) => (
                <div key={g.label} style={{ marginBottom: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={g.items.length > 0 && g.items.every((it) => g.sel.has(it.id))}
                      ref={(el) => {
                        if (el) el.indeterminate = !g.items.every((it) => g.sel.has(it.id)) && g.items.some((it) => g.sel.has(it.id));
                      }}
                      onChange={() => {
                        const allIn = g.items.every((it) => g.sel.has(it.id));
                        g.apply(allIn ? new Set() : new Set(g.items.map((it) => it.id)));
                      }}
                    />
                    {g.label}({g.items.length})
                  </label>
                  {g.items.map((it) => (
                    <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 20 }}>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        checked={g.sel.has(it.id)}
                        onChange={() => toggle(g.sel, it.id, g.apply)}
                      />
                      {it.name || '(未命名)'}
                    </label>
                  ))}
                  {g.items.length === 0 && <div className="hint" style={{ paddingLeft: 20 }}>无</div>}
                </div>
              ))}
            </div>
          </div>
          <div className="hint">合并所选流程与文档为一份 .fdx;场景标题来自流程名与文档名。</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="ghost" onClick={onClose}>取消</button>
            <button className="primary" disabled={total === 0} onClick={doExport}>导出 {total} 项</button>
          </div>
        </div>
      </div>
    </div>
  );
}
