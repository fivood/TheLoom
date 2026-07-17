import { useEffect, useRef, useState } from 'react';
import { useLoom, uid } from '../store';
import { previewProjectXlsx, type XlsxImportPreview } from '../interop/projectXlsx';
import { previewFdxImport, type FdxImportPreview } from '../interop/fdx';
import type { Document } from '../types';
import Icon from './Icon';

type Mode = 'xlsx' | 'fdx';

interface Props {
  mode: Mode;
  file: File;
  onClose: () => void;
}

/**
 * 导入预检模态:先分析文件、展示差异统计,用户点确认才写入项目。
 * xlsx = 全项目合并(按 ID / 名称匹配 → 更新;缺失 → 新增);
 * fdx  = 生成一份新文档(不覆盖现有,分类 = 剧本草稿)。
 */
export default function ImportPreview({ mode, file, onClose }: Props) {
  const project = useLoom((s) => s.project);
  const replaceProject = useLoom((s) => s.replaceProject);
  const update = useLoom((s) => s.update);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [xlsx, setXlsx] = useState<XlsxImportPreview | null>(null);
  const [fdx, setFdx] = useState<FdxImportPreview | null>(null);
  const [fdxDocName, setFdxDocName] = useState('');
  const abortRef = useRef(false);

  useEffect(() => {
    abortRef.current = false;
    (async () => {
      try {
        if (mode === 'xlsx') {
          const buf = new Uint8Array(await file.arrayBuffer());
          if (abortRef.current) return;
          const p = await previewProjectXlsx(buf, project);
          if (!abortRef.current) setXlsx(p);
        } else {
          const text = await file.text();
          if (abortRef.current) return;
          const name = file.name.replace(/\.fdx$/i, '') || '导入剧本';
          setFdxDocName(name);
          setFdx(previewFdxImport(text, project, name));
        }
      } catch (e) {
        if (!abortRef.current) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!abortRef.current) setLoading(false);
      }
    })();
    return () => { abortRef.current = true; };
  }, [file, mode]);  // eslint-disable-line react-hooks/exhaustive-deps

  const applyXlsx = () => {
    if (!xlsx) return;
    replaceProject(xlsx.next);
    onClose();
  };

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
    onClose();
  };

  const title = mode === 'xlsx' ? 'Excel 项目导入 · 预检' : 'Final Draft 剧本导入 · 预检';

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
        <div className="sync-head">
          <Icon name={mode === 'xlsx' ? 'grid' : 'script'} size={14} />
          <span>{title}</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="field">
            <label>来源文件</label>
            <div className="hint" style={{ fontSize: 12 }}>{file.name} · {(file.size / 1024).toFixed(1)} KB</div>
          </div>

          {loading && <div className="empty-hint" style={{ padding: 24 }}>正在解析…</div>}

          {err && (
            <div className="field">
              <label style={{ color: 'var(--danger)' }}>解析失败</label>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--bg-panel)', padding: 10, borderRadius: 6 }}>{err}</pre>
            </div>
          )}

          {mode === 'xlsx' && xlsx && (
            <>
              {xlsx.errors.length > 0 && (
                <div className="field">
                  <label style={{ color: 'var(--danger)' }}>错误({xlsx.errors.length})· 需要修复才能导入</label>
                  <ul className="doc-legend" style={{ color: 'var(--danger)' }}>
                    {xlsx.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              <div className="field">
                <label>变更统计</label>
                <table className="var-table">
                  <thead><tr><th>对象</th><th>新增</th><th>更新</th><th>跳过</th></tr></thead>
                  <tbody>
                    <DiffRow label="实体" v={xlsx.counts.entities} />
                    <DiffRow label="实体字段" v={xlsx.counts.entityFields} />
                    <DiffRow label="大纲行" v={xlsx.counts.outlineRows} />
                    <DiffRow label="大纲剧情线" v={xlsx.counts.outlineColumns} />
                    <DiffRow label="变量" v={xlsx.counts.variables} />
                    <DiffRow label="时间线轨道" v={xlsx.counts.timelineTracks} />
                    <DiffRow label="时间线时间点" v={xlsx.counts.timelinePoints} />
                    <DiffRow label="时间线事件" v={xlsx.counts.timelineEvents} />
                    <DiffRow label="资源(仅元数据)" v={xlsx.counts.assets} />
                  </tbody>
                </table>
              </div>

              {xlsx.warnings.length > 0 && (
                <div className="field">
                  <label>警告({xlsx.warnings.length})· 允许继续</label>
                  <ul className="doc-legend">
                    {xlsx.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {xlsx.ignoredSheets.length > 0 && (
                <div className="hint" style={{ fontSize: 11 }}>
                  忽略了未识别的 sheet:{xlsx.ignoredSheets.join(' / ')}
                </div>
              )}

              <div className="player-tip" style={{ marginTop: 8 }}>
                导入不会删除任何现有对象。相同 ID(或相同名称)的对象会被更新,其余新增。<br />
                建议先在「工具 → 版本历史」保存一个快照,方便回滚。
              </div>

              <div className="sync-actions">
                <button onClick={onClose}>取消</button>
                <button
                  className="primary"
                  disabled={xlsx.errors.length > 0}
                  onClick={applyXlsx}
                  title={xlsx.errors.length > 0 ? '存在错误,请先修复表格' : '把变更应用到当前项目'}
                >应用到项目</button>
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

function DiffRow({ label, v }: { label: string; v: { add: number; update: number; skip: number } }) {
  const zero = v.add === 0 && v.update === 0 && v.skip === 0;
  return (
    <tr style={zero ? { color: 'var(--text-faint)' } : undefined}>
      <td>{label}</td>
      <td>{v.add > 0 ? <b style={{ color: 'var(--diff-add-strong)' }}>+{v.add}</b> : v.add}</td>
      <td>{v.update > 0 ? <b>{v.update}</b> : v.update}</td>
      <td>{v.skip > 0 ? <span style={{ color: 'var(--text-faint)' }}>{v.skip}</span> : v.skip}</td>
    </tr>
  );
}
