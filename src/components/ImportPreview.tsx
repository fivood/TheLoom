import { useEffect, useRef, useState } from 'react';
import { useLoom, uid } from '../store';
import { previewFdxImport, type FdxImportPreview } from '../interop/fdx';
import {
  applyManuscript, parseManuscript, readManuscriptFile,
  type ParsedManuscript,
} from '../interop/manuscriptImport';
import { parseEpub } from '../interop/epubImport';
import { parseDocx } from '../interop/docxImport';
import type { Document } from '../types';
import Icon from './Icon';
import { useEscape } from '../hooks/useEscape';
import { toast } from '../toast';

type Mode = 'fdx' | 'manuscript';

interface Props {
  mode: Mode;
  file: File;
  onClose: () => void;
}

/**
 * 导入预检模态:先分析文件、展示差异统计,用户点确认才写入项目。
 * fdx  = 生成一份新文档(不覆盖现有,分类 = 剧本草稿)。
 */
export default function ImportPreview({ mode, file, onClose }: Props) {
  useEscape(true, onClose);
  const project = useLoom((s) => s.project);
  const replaceProject = useLoom((s) => s.replaceProject);
  const update = useLoom((s) => s.update);
  const [loading, setLoading] = useState(true);
  const [progressLabel, setProgressLabel] = useState('正在读入文件…');
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fdx, setFdx] = useState<FdxImportPreview | null>(null);
  const [fdxDocName, setFdxDocName] = useState('');
  const [manuscript, setManuscript] = useState<ParsedManuscript | null>(null);
  const abortRef = useRef(false);

  // 让 React 有机会把当前 state 渲染出来后再继续下一个同步阶段
  const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

  useEffect(() => {
    abortRef.current = false;
    (async () => {
      const setStage = async (label: string, pct: number | null = null) => {
        setProgressLabel(label);
        setProgressPct(pct);
        await yieldToUi();
      };
      try {
        await setStage(`正在读入文件…(${(file.size / 1024 / 1024).toFixed(1)} MB)`);
        if (mode === 'fdx') {
          const text = await file.text();
          if (abortRef.current) return;
          await setStage('正在解析剧本…');
          const name = file.name.replace(/\.fdx$/i, '') || '导入剧本';
          setFdxDocName(name);
          setFdx(previewFdxImport(text, project, name));
        } else {
          if (/\.epub$/i.test(file.name)) {
            const buf = await file.arrayBuffer();
            if (abortRef.current) return;
            await setStage('正在解压 EPUB 并抽取正文…');
            setManuscript(await parseEpub(buf));
          } else if (/\.docx$/i.test(file.name)) {
            const buf = await file.arrayBuffer();
            if (abortRef.current) return;
            await setStage('正在解压 DOCX 并抽取正文…');
            setManuscript(await parseDocx(buf));
          } else {
            const { text, format } = await readManuscriptFile(file);
            if (abortRef.current) return;
            await setStage('正在按章节切分…');
            setManuscript(parseManuscript(text, { format }));
          }
        }
      } catch (e) {
        if (!abortRef.current) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!abortRef.current) setLoading(false);
      }
    })();
    return () => { abortRef.current = true; };
  }, [file, mode]);  // eslint-disable-line react-hooks/exhaustive-deps

  const applyFdx = () => {
    if (!fdx) return;
    const doc: Document = {
      id: uid(),
      name: fdxDocName || '导入剧本',
      category: '剧本草稿',
      blocks: fdx.blocks.length ? fdx.blocks : [{ id: uid(), type: 'action', text: '(空文档)' }],
      notes: `从 ${file.name} 导入(${fdx.paragraphCount} 段 / ${fdx.sceneCount} 场景 / ${fdx.dialogueCount} 段对白)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    update((p) => {
      p.documents.push(doc);
      if (!p.documentCategories.includes('剧本草稿')) p.documentCategories.push('剧本草稿');
    });
    toast(`已导入为文档「${doc.name}」(${fdx.sceneCount} 场景)`);
    onClose();
  };

  const applyManuscriptDoc = () => {
    if (!manuscript) return;
    update((p) => { applyManuscript(p, manuscript); });
    toast(`已导入 ${manuscript.sceneCount} 个场景到文档模块`);
    onClose();
  };

  const title = mode === 'fdx' ? 'Final Draft 剧本导入 · 预检'
    : 'TXT / Markdown / EPUB / DOCX 稿件导入 · 预检';

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
        <div className="sync-head">
          <Icon name="script" size={14} />
          <span>{title}</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="field">
            <label>来源文件</label>
            <div className="hint" style={{ fontSize: 12 }}>{file.name} · {(file.size / 1024).toFixed(1)} KB</div>
          </div>

          {loading && (
            <div className="empty-hint" style={{ padding: 24 }}>
              <div style={{ marginBottom: 8 }}>{progressLabel}</div>
              <div
                className="import-progress"
                role="progressbar"
                aria-label={progressLabel}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPct != null ? Math.round(progressPct * 100) : undefined}
              >
                <div
                  className="import-progress-bar"
                  style={{
                    width: progressPct != null ? `${Math.round(progressPct * 100)}%` : '30%',
                    transition: progressPct != null ? 'width 0.2s' : 'none',
                    animation: progressPct != null ? 'none' : 'import-progress-slide 1.2s infinite',
                  }}
                />
              </div>
              {progressPct != null && (
                <div className="hint" style={{ fontSize: 11, marginTop: 6 }}>{Math.round(progressPct * 100)}%</div>
              )}
            </div>
          )}

          {err && (
            <div className="field">
              <label style={{ color: 'var(--danger)' }}>解析失败</label>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--bg-panel)', padding: 10, borderRadius: 6 }}>{err}</pre>
            </div>
          )}

          {mode === 'manuscript' && manuscript && (
            <>
              {manuscript.projectName && (
                <div className="hint" style={{ fontSize: 12 }}>
                  frontmatter 检测到:标题 <b>{manuscript.projectName}</b>
                  {manuscript.author ? <> · 作者 <b>{manuscript.author}</b></> : null}
                </div>
              )}
              <div className="field">
                <label>解析结果</label>
                <table className="var-table">
                  <tbody>
                    <tr><td>卷 / 分辑</td><td>{manuscript.volumes.length}</td></tr>
                    <tr><td>章</td><td>{manuscript.volumes.reduce((s, v) => s + v.chapters.length, 0)}</td></tr>
                    <tr><td>场景</td><td>{manuscript.sceneCount}</td></tr>
                    <tr><td>正文字符(近似)</td><td>{manuscript.totalChars.toLocaleString()}</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="field">
                <label>目录预览</label>
                <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 12, lineHeight: 1.6 }}>
                  {manuscript.volumes.map((v, vi) => (
                    <div key={vi}>
                      <b>{v.title || `卷${vi + 1}`}</b>
                      {v.chapters.map((c, ci) => (
                        <div key={ci} style={{ paddingLeft: 12 }}>
                          {c.title || `第${ci + 1}章`}
                          <span className="hint"> · {c.scenes.length} 场</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              {manuscript.warnings.length > 0 && (
                <div className="field">
                  <label>警告({manuscript.warnings.length})</label>
                  <ul className="doc-legend">
                    {manuscript.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              <div className="player-tip" style={{ marginTop: 8 }}>
                导入会在文档模块新建卷 / 章文件夹树,场景写为独立文档(状态=大纲,分类=导入稿件)。<br />
                只新增,不覆盖任何现有对象;Ctrl+Z 一步撤销。
              </div>

              <div className="sync-actions">
                <button onClick={onClose}>取消</button>
                <button className="primary" onClick={applyManuscriptDoc}>
                  导入 {manuscript.sceneCount} 场景
                </button>
              </div>
            </>
          )}

          {mode === 'fdx' && fdx && (
            <>
              <div className="field">
                <label>剧本文档名称</label>
                <input
                  value={fdxDocName}
                  onChange={(e) => setFdxDocName(e.target.value)}
                  placeholder="将作为新文档的标题"
                />
              </div>
              <div className="field">
                <label>解析结果</label>
                <table className="var-table">
                  <tbody>
                    <tr><td>段落总数</td><td>{fdx.paragraphCount}</td></tr>
                    <tr><td>场景标题(Scene Heading)</td><td>{fdx.sceneCount}</td></tr>
                    <tr><td>对白(Dialogue)</td><td>{fdx.dialogueCount}</td></tr>
                    <tr><td>生成的文档块</td><td>{fdx.blocks.length}</td></tr>
                  </tbody>
                </table>
              </div>

              {fdx.unknownSpeakers.length > 0 && (
                <div className="field">
                  <label>未识别的说话人({fdx.unknownSpeakers.length})</label>
                  <div className="hint" style={{ fontSize: 12, marginBottom: 4 }}>
                    以下角色在实体库里找不到匹配名字。对白块会保留内容但不带说话人 id;导入后可以到文档里手动选角色。
                  </div>
                  <div className="card-tags">
                    {fdx.unknownSpeakers.map((n) => <span key={n} className="tag">{n}</span>)}
                  </div>
                </div>
              )}

              <div className="player-tip" style={{ marginTop: 8 }}>
                导入会新建一份文档,不覆盖任何现有内容。分类默认为「剧本草稿」。
              </div>

              <div className="sync-actions">
                <button onClick={onClose}>取消</button>
                <button className="primary" onClick={applyFdx}>新建文档并导入</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

