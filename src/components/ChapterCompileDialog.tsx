import { useMemo, useState } from 'react';
import Icon from './Icon';
import { useLoom } from '../store';
import { compileDocuments, type CompileFormat } from '../interop/chapterCompile';
import { linearizeByFolders } from '../util';
import { groupDocsByChapter } from '../planning';
import type { Document } from '../types';

const FORMAT_LABEL: Record<CompileFormat, string> = {
  md: 'Markdown (.md)',
  txt: '纯文本 (.txt)',
  fdx: 'Final Draft (.fdx)',
};

/** R13-5 章节编译:勾选文档 + 选格式 → 编译并下载 */
export default function ChapterCompileDialog({ onClose }: { onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const [format, setFormat] = useState<CompileFormat>('md');
  const [includePath, setIncludePath] = useState(true);

  const ordered = useMemo(
    () => linearizeByFolders(project.documents, project.folders, 'document'),
    [project.documents, project.folders],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(ordered.map((d) => d.id)));

  const groups = useMemo(() => {
    return groupDocsByChapter(ordered, project.folders);
  }, [ordered, project.folders]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroup = (docs: Document[]) => {
    const allIn = docs.every((d) => selected.has(d.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of docs) allIn ? next.delete(d.id) : next.add(d.id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(ordered.map((d) => d.id)));
  const clearAll = () => setSelected(new Set());

  const preview = useMemo(
    () => compileDocuments(project, { format, documentIds: selected, includeFolderPath: includePath }),
    [project, format, selected, includePath],
  );

  const download = () => {
    if (preview.docCount === 0) return;
    const blob = new Blob([preview.content], { type: preview.mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name || 'theloom'}-编译.${preview.extension}`;
    a.click();
    URL.revokeObjectURL(a.href);
    onClose();
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
        <div className="sync-head">
          <Icon name="script" size={14} />
          <span>章节编译</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body" style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>输出格式</label>
              <select value={format} onChange={(e) => setFormat(e.target.value as CompileFormat)}>
                {(Object.keys(FORMAT_LABEL) as CompileFormat[]).map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={includePath} onChange={(e) => setIncludePath(e.target.checked)} style={{ width: 'auto' }} />
              在每篇正文前显示卷/章路径
            </label>
            <div className="field" style={{ margin: 0 }}>
              <label>参与编译({selected.size}/{ordered.length} 篇)</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <button className="ghost" onClick={selectAll}>全选</button>
                <button className="ghost" onClick={clearAll}>清空</button>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 12 }}>
                {groups.length === 0 && <div className="hint">项目里还没有文档</div>}
                {groups.map((group) => {
                  const { label: path, docs } = group;
                  const allIn = docs.every((d) => selected.has(d.id));
                  const someIn = !allIn && docs.some((d) => selected.has(d.id));
                  return (
                    <div key={group.key || 'ungrouped'} style={{ marginBottom: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                        <input
                          type="checkbox"
                          checked={allIn}
                          ref={(el) => { if (el) el.indeterminate = someIn; }}
                          onChange={() => toggleGroup(docs)}
                          style={{ width: 'auto' }}
                        />
                        {path}
                        <span className="hint" style={{ fontSize: 11 }}>({docs.length} 篇)</span>
                      </label>
                      <div style={{ paddingLeft: 20 }}>
                        {docs.map((d) => (
                          <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={selected.has(d.id)}
                              onChange={() => toggle(d.id)}
                              style={{ width: 'auto' }}
                            />
                            <span>{d.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>预检</label>
              <table className="var-table">
                <tbody>
                  <tr><td>选中文档</td><td>{preview.docCount}</td></tr>
                  <tr><td>正文字符(近似)</td><td>{preview.totalWords.toLocaleString()}</td></tr>
                  <tr><td>输出大小</td><td>{(new Blob([preview.content]).size / 1024).toFixed(1)} KB</td></tr>
                </tbody>
              </table>
            </div>
            <div className="player-tip" style={{ fontSize: 11 }}>
              按 Navigator 树顺序拼接。<br />
              Markdown 与文本为纯文本;.fdx 可导入 Final Draft。
            </div>
            <div className="sync-actions">
              <button onClick={onClose}>取消</button>
              <button className="primary" onClick={download} disabled={preview.docCount === 0}>
                编译并下载
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
