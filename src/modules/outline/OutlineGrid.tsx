import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { confirmDialog, promptText } from '../../dialog';
import { DOC_STATUS_LABEL, PALETTE } from '../../types';
import { activePaletteColors, folderPath, linearizeByFolders } from '../../util';
import { useNav } from '../../search';
import { documentChapterFolder, documentSceneLabel, orderedDocumentFolders } from '../../documentStructure';

function AutoTextarea({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const autoSize = () => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  };
  useEffect(autoSize, [value]);
  return (
    <textarea
      ref={ref}
      rows={2}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function OutlineGrid() {
  const columns = useLoom((s) => s.project.outlineColumns);
  const rows = useLoom((s) => s.project.outlineRows);
  const documents = useLoom((s) => s.project.documents);
  const folders = useLoom((s) => s.project.folders);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const {
    addOutlineRow, updateOutlineRow, setOutlineCell, removeOutlineRow, moveOutlineRow,
    addOutlineColumn, updateOutlineColumn, removeOutlineColumn,
  } = useLoom();
  const go = useNav((s) => s.go);
  const orderedDocuments = useMemo(
    () => linearizeByFolders(documents, folders, 'document'),
    [documents, folders],
  );
  const chapterFolders = useMemo(
    () => orderedDocumentFolders(folders).filter((folder) => folder.documentRole === 'chapter'),
    [folders],
  );

  const navSeq = useNav((s) => s.seq);
  useEffect(() => {
    const target = useNav.getState().target;
    if (target?.tab !== 'outline' || !target.outlineRowId) return;
    setFocusedRowId(target.outlineRowId);
    requestAnimationFrame(() => document.getElementById(`outline-row-${target.outlineRowId}`)?.scrollIntoView({ block: 'center' }));
    useNav.getState().clear();
  }, [navSeq]);

  const addColumn = async () => {
    const title = await promptText({ message: '新剧情线名称(例如:伏笔、感情线、某配角的暗线)', placeholder: '剧情线名称' });
    if (!title) return;
    const cols = activePaletteColors(useLoom.getState().project);
    addOutlineColumn({ id: uid(), title, color: cols[columns.length % cols.length] ?? PALETTE[0] });
  };

  return (
    <div className="pane-col">
      <div className="toolbar">
        <button className="primary" onClick={() => addOutlineRow()}>＋ 新章节(行)</button>
        <button onClick={addColumn}>＋ 新剧情线(列)</button>
        <span className="hint">
          罗琳式大纲:每行一章,每列一条剧情线——逐格检查每条线在每一章的进展
        </span>
      </div>

      <div className="outline-wrap">
        <table className="outline-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}></th>
              <th className="col-narrow" style={{ width: 110 }}>章节</th>
              <th className="col-narrow" style={{ width: 150 }}>时间</th>
              <th style={{ minWidth: 140 }}>章节标题</th>
              <th style={{ minWidth: 220 }}>关联正文</th>
              <th style={{ minWidth: 220 }}>主线剧情</th>
              {columns.map((c) => (
                <th key={c.id} style={{ minWidth: 180 }}>
                  <div className="col-head">
                    <span className="col-strip" style={{ background: c.color }} />
                    <input
                      value={c.title}
                      onChange={(e) => updateOutlineColumn(c.id, { title: e.target.value })}
                    />
                    <button
                      className="ghost icon-btn"
                      title="删除该剧情线"
                      onClick={async () => {
                        if (await confirmDialog({ message: `删除剧情线「${c.title}」及其所有单元格内容?`, danger: true, confirmText: '删除' })) removeOutlineColumn(c.id);
                      }}
                    >×</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} id={`outline-row-${r.id}`} className={focusedRowId === r.id ? 'outline-row-focused' : undefined}>
                <td className="row-tools">
                  <button className="ghost icon-btn" title="上移" disabled={i === 0} onClick={() => moveOutlineRow(r.id, -1)}>↑</button>
                  <button className="ghost icon-btn" title="下移" disabled={i === rows.length - 1} onClick={() => moveOutlineRow(r.id, 1)}>↓</button>
                  <button className="ghost icon-btn" title="在下方插入行" onClick={() => addOutlineRow(r.id)}>＋</button>
                  <button
                    className="ghost icon-btn" title="删除行"
                    onClick={async () => { if (await confirmDialog({ message: `删除第 ${r.no || i + 1} 行?`, danger: true, confirmText: '删除' })) removeOutlineRow(r.id); }}
                  >×</button>
                </td>
                <td className="col-narrow">
                  <input value={r.no} onChange={(e) => updateOutlineRow(r.id, { no: e.target.value })} />
                </td>
                <td className="col-narrow">
                  <input value={r.time} onChange={(e) => updateOutlineRow(r.id, { time: e.target.value })} />
                </td>
                <td>
                  <AutoTextarea value={r.title} onChange={(v) => updateOutlineRow(r.id, { title: v })} placeholder="章节标题" />
                </td>
                <td className="outline-document-link">
                  {(() => {
                    const linkedDocument = r.documentId ? documents.find((document) => document.id === r.documentId) : undefined;
                    const linkedChapter = r.chapterFolderId ? chapterFolders.find((folder) => folder.id === r.chapterFolderId) : undefined;
                    const targetDocument = linkedDocument ?? (linkedChapter
                      ? orderedDocuments.find((document) => documentChapterFolder(document.folderId, folders)?.id === linkedChapter.id)
                      : undefined);
                    const value = linkedDocument ? `document:${linkedDocument.id}` : linkedChapter ? `chapter:${linkedChapter.id}` : '';
                    return (
                      <div className="outline-document-link-controls">
                        <select
                          value={value}
                          onChange={(event) => {
                            const [kind, id] = event.target.value.split(':');
                            updateOutlineRow(r.id, {
                              documentId: kind === 'document' ? id : undefined,
                              chapterFolderId: kind === 'chapter' ? id : undefined,
                            });
                          }}
                        >
                          <option value="">未关联</option>
                          {chapterFolders.length > 0 && (
                            <optgroup label="章节">
                              {chapterFolders.map((folder) => (
                                <option key={folder.id} value={`chapter:${folder.id}`}>{folderPath(folder.id, folders)}</option>
                              ))}
                            </optgroup>
                          )}
                          {orderedDocuments.length > 0 && (
                            <optgroup label="场景">
                              {orderedDocuments.map((document) => (
                                <option key={document.id} value={`document:${document.id}`}>{documentSceneLabel(document, folders)}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <button
                          className="ghost icon-btn"
                          title={targetDocument ? `打开场景「${targetDocument.name}」` : '该章节还没有场景'}
                          disabled={!targetDocument}
                          onClick={() => targetDocument && go({ tab: 'documents', docId: targetDocument.id })}
                        >↗</button>
                        {linkedDocument && (
                          <button className="outline-scene-projection" onClick={() => go({ tab: 'documents', docId: linkedDocument.id }, `场景 · ${linkedDocument.name}`)}>
                            <strong>{linkedDocument.name}</strong>
                            {linkedDocument.status && <span className={`ms-status ms-status-${linkedDocument.status}`}>{DOC_STATUS_LABEL[linkedDocument.status]}</span>}
                            <small>{documentSceneLabel(linkedDocument, folders)}</small>
                          </button>
                        )}
                        {!linkedDocument && linkedChapter && (
                          <div className="outline-chapter-projection">
                            <strong>{folderPath(linkedChapter.id, folders)}</strong>
                            <small>{orderedDocuments.filter((document) => documentChapterFolder(document.folderId, folders)?.id === linkedChapter.id).length} 个场景</small>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </td>
                <td className="plot-cell">
                  <AutoTextarea value={r.main} onChange={(v) => updateOutlineRow(r.id, { main: v })} placeholder="这一章主线上发生了什么" />
                </td>
                {columns.map((c) => (
                  <td key={c.id} className="plot-cell" style={{ borderTop: `1px solid ${c.color}22` }}>
                    <AutoTextarea
                      value={r.cells[c.id] ?? ''}
                      onChange={(v) => setOutlineCell(r.id, c.id, v)}
                      placeholder="—"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="empty-hint">
            还没有章节。点击「＋ 新章节」开始搭建大纲。<br />
            建议先建好几条剧情线(列),再逐章填格子——空格也是信息:说明这条线在这一章沉默。
          </div>
        )}
      </div>
    </div>
  );
}
