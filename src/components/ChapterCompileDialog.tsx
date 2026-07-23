import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { useLoom } from '../store';
import { compileDocuments, type CompileFormat } from '../interop/chapterCompile';
import { linearizeByFolders } from '../util';
import { groupDocsByChapter } from '../planning';
import type { Document } from '../types';
import {
  exportProjectToDocx,
  planDocxManuscript,
  verifyDocxExport,
  type DocxManuscriptPreset,
} from '../interop/docxExport';

type ExportFormat = CompileFormat | 'docx';

const FORMAT_LABEL: Record<ExportFormat, string> = {
  md: 'Markdown (.md)',
  txt: '纯文本 (.txt)',
  fdx: 'Final Draft (.fdx)',
  docx: 'Word 成稿 (.docx)',
};

/** R13-5 章节编译:勾选文档 + 选格式 → 编译并下载 */
export default function ChapterCompileDialog({ onClose }: { onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const [format, setFormat] = useState<ExportFormat>('md');
  const [includePath, setIncludePath] = useState(true);
  const [docxPreset, setDocxPreset] = useState<DocxManuscriptPreset>('submission');
  const [manuscriptTitle, setManuscriptTitle] = useState(project.name);
  const [author, setAuthor] = useState('');
  const [includeSceneTitles, setIncludeSceneTitles] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [includeRevision, setIncludeRevision] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

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
    () => compileDocuments(project, {
      format: format === 'docx' ? 'md' : format,
      documentIds: selected,
      includeFolderPath: includePath,
    }),
    [project, format, selected, includePath],
  );

  const docxPlan = useMemo(
    () => planDocxManuscript(project, {
      documentIds: selected,
      preset: docxPreset,
      title: manuscriptTitle,
      author,
      includeSceneTitles,
      includeNotes,
      includeAnnotations,
      includeRevision,
    }),
    [
      project, selected, docxPreset, manuscriptTitle, author,
      includeSceneTitles, includeNotes, includeAnnotations, includeRevision,
    ],
  );

  useEffect(() => {
    if (docxPreset === 'submission') {
      setIncludeSceneTitles(false);
      setIncludeNotes(false);
      setIncludeAnnotations(false);
      setIncludeRevision(false);
    } else {
      setIncludeSceneTitles(true);
      setIncludeNotes(true);
      setIncludeAnnotations(true);
      setIncludeRevision(true);
    }
  }, [docxPreset]);

  const download = async () => {
    if (preview.docCount === 0) return;
    setExportError('');
    setExporting(true);
    try {
      let blob: Blob;
      let extension: string;
      if (format === 'docx') {
        const result = await exportProjectToDocx(project, {
          documentIds: selected,
          preset: docxPreset,
          title: manuscriptTitle,
          author,
          includeSceneTitles,
          includeNotes,
          includeAnnotations,
          includeRevision,
        });
        const verification = await verifyDocxExport(result.blob, result.plan);
        if (!verification.valid) throw new Error(`DOCX 自检未通过：${verification.issues.join('；')}`);
        blob = result.blob;
        extension = 'docx';
      } else {
        blob = new Blob([preview.content], { type: preview.mime });
        extension = preview.extension;
      }
      const safeName = (manuscriptTitle.trim() || project.name || 'theloom').replace(/[\\/:*?"<>|]/g, '-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${safeName}-${format === 'docx' ? (docxPreset === 'submission' ? '投稿稿' : '编辑审阅稿') : '编译'}.${extension}`;
      a.click();
      URL.revokeObjectURL(a.href);
      onClose();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel chapter-compile-dialog" onClick={(e) => e.stopPropagation()}>
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
              <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
              </select>
            </div>
            {format !== 'docx' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={includePath} onChange={(e) => setIncludePath(e.target.checked)} style={{ width: 'auto' }} />
                在每篇正文前显示卷/章路径
              </label>
            ) : (
              <div className="docx-export-options">
                <div className="docx-export-grid">
                  <label>
                    <span>稿件预设</span>
                    <select value={docxPreset} onChange={(event) => setDocxPreset(event.target.value as DocxManuscriptPreset)}>
                      <option value="submission">投稿稿：纯正文、宋体、首行缩进</option>
                      <option value="editorial">编辑审阅稿：场景信息、批注与修订</option>
                    </select>
                  </label>
                  <label>
                    <span>书名</span>
                    <input value={manuscriptTitle} onChange={(event) => setManuscriptTitle(event.target.value)} />
                  </label>
                  <label>
                    <span>作者</span>
                    <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="可选" />
                  </label>
                </div>
                <div className="docx-export-checks">
                  <label>
                    <input type="checkbox" checked={includeSceneTitles} onChange={(event) => setIncludeSceneTitles(event.target.checked)} />
                    场景标题
                  </label>
                  <label>
                    <input type="checkbox" checked={includeRevision} onChange={(event) => setIncludeRevision(event.target.checked)} />
                    修订信息
                  </label>
                  <label>
                    <input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} />
                    场景备注
                  </label>
                  <label>
                    <input type="checkbox" checked={includeAnnotations} onChange={(event) => setIncludeAnnotations(event.target.checked)} />
                    批注摘要
                  </label>
                </div>
              </div>
            )}
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
                  {format === 'docx' ? (
                    <>
                      <tr><td>卷 / 章</td><td>{docxPlan.volumeCount} / {docxPlan.chapterCount}</td></tr>
                      <tr><td>输出段落</td><td>{docxPlan.bodyParagraphCount}</td></tr>
                    </>
                  ) : (
                    <tr><td>输出大小</td><td>{(new Blob([preview.content]).size / 1024).toFixed(1)} KB</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="player-tip" style={{ fontSize: 11 }}>
              按 Navigator 树顺序拼接。<br />
              {format === 'docx'
                ? 'Word 稿使用 A4、显式标题与正文样式；下载前会重新解析并比对段落和卷章顺序。'
                : 'Markdown 与文本为纯文本;.fdx 可导入 Final Draft。'}
            </div>
            {exportError && <div className="update-error docx-export-error">{exportError}</div>}
            <div className="sync-actions">
              <button onClick={onClose}>取消</button>
              <button className="primary" onClick={download} disabled={preview.docCount === 0 || exporting}>
                {exporting ? '生成并自检…' : format === 'docx' ? '生成并下载' : '编译并下载'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
