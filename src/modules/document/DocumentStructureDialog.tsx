import { useEffect, useMemo, useState } from 'react';
import { applyBatchEdit, type BatchEditPatch } from '../../batch';
import {
  documentIdsInFolder,
  documentStructureScopes,
  renumberDocumentFolders,
  type DocumentNumberingStyle,
} from '../../documentOperations';
import { useLoom } from '../../store';
import { DOC_STATUS_LABEL, DOC_STATUS_ORDER, DOCUMENT_FOLDER_ROLE_LABEL, type DocStatus } from '../../types';
import { folderPath } from '../../util';

export default function DocumentStructureDialog({ onClose }: { onClose: () => void }) {
  const project = useLoom((state) => state.project);
  const update = useLoom((state) => state.update);
  const [numberingStyle, setNumberingStyle] = useState<DocumentNumberingStyle>('chinese');
  const [scopeId, setScopeId] = useState('');
  const [status, setStatus] = useState('');
  const [revisionEnabled, setRevisionEnabled] = useState(false);
  const [revision, setRevision] = useState('');
  const [wordTargetEnabled, setWordTargetEnabled] = useState(false);
  const [wordTarget, setWordTarget] = useState('');
  const [categoryEnabled, setCategoryEnabled] = useState(false);
  const [category, setCategory] = useState('');
  const [notice, setNotice] = useState('');

  const scopes = useMemo(() => documentStructureScopes(project), [project]);
  const selectedScope = scopes.find((scope) => scope.id === scopeId);
  const hasBatchChanges = Boolean(status || revisionEnabled || wordTargetEnabled || categoryEnabled);

  useEffect(() => {
    if (!scopeId && scopes[0]) setScopeId(scopes[0].id);
  }, [scopeId, scopes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const applyNumbering = () => {
    let count = 0;
    update((next) => { count = renumberDocumentFolders(next, numberingStyle); });
    setNotice(count > 0 ? `已更新 ${count} 个卷章名称，可一次撤销。` : '卷章名称已符合当前编号方式。');
  };

  const applyScope = () => {
    if (!scopeId) return;
    const ids = documentIdsInFolder(project, scopeId);
    const patch: BatchEditPatch = {};
    if (status) patch.documentStatus = status === '__none__' ? null : status as DocStatus;
    if (revisionEnabled) {
      const value = Number(revision);
      patch.documentRevision = Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;
    }
    if (wordTargetEnabled) {
      const value = Number(wordTarget);
      patch.documentWordTarget = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    }
    if (categoryEnabled) patch.documentCategory = category.trim() || '未分类';
    update((next) => {
      applyBatchEdit(next, 'document', ids, patch);
      if (patch.documentCategory && !next.documentCategories.includes(patch.documentCategory)) {
        next.documentCategories.push(patch.documentCategory);
      }
    });
    setNotice(`已更新 ${ids.length} 个场景，可一次撤销。`);
  };

  return (
    <div className="palette-backdrop document-structure-backdrop" onClick={onClose}>
      <div className="palette document-structure-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="batch-edit-head">
          <div>
            <h3>长篇结构工具</h3>
            <p>统一卷章编号，或按整卷 / 整章批量设置场景元数据。</p>
          </div>
          <button type="button" className="ghost icon-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <section className="document-structure-section">
          <div>
            <h4>卷章自动编号</h4>
            <p>只处理标记为“卷”或“章”的文件夹，标题正文会保留。</p>
          </div>
          <div className="document-structure-row">
            <select value={numberingStyle} onChange={(event) => setNumberingStyle(event.target.value as DocumentNumberingStyle)}>
              <option value="chinese">中文数字：第一卷 / 第一章</option>
              <option value="arabic">阿拉伯数字：第 1 卷 / 第 1 章</option>
              <option value="none">不编号：仅保留标题</option>
            </select>
            <button className="primary" onClick={applyNumbering}>应用编号</button>
          </div>
        </section>

        <section className="document-structure-section">
          <div>
            <h4>按卷章批量设定</h4>
            <p>会包含所选卷章下全部小节和场景，应用后只产生一次撤销记录。</p>
          </div>
          <label className="document-structure-scope">
            <span>作用范围</span>
            <select value={scopeId} onChange={(event) => setScopeId(event.target.value)}>
              {scopes.map((scope) => (
                <option key={scope.id} value={scope.id}>
                  [{DOCUMENT_FOLDER_ROLE_LABEL[scope.documentRole!]}] {folderPath(scope.id, project.folders)}（{scope.documentCount} 场）
                </option>
              ))}
            </select>
          </label>
          {scopes.length === 0 ? (
            <div className="hint">请先在左侧文档树中新建“卷”或“章”文件夹。</div>
          ) : (
            <div className="batch-edit-grid document-structure-grid">
              <label>
                <span>写作状态</span>
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">保持不变</option>
                  <option value="__none__">清除状态</option>
                  {DOC_STATUS_ORDER.map((item) => <option key={item} value={item}>{DOC_STATUS_LABEL[item]}</option>)}
                </select>
              </label>
              <label>
                <span>
                  <input type="checkbox" checked={revisionEnabled} onChange={(event) => setRevisionEnabled(event.target.checked)} />
                  修改修订轮次
                </span>
                <input
                  type="number"
                  min={1}
                  value={revision}
                  onChange={(event) => setRevision(event.target.value)}
                  placeholder="留空则清除"
                  disabled={!revisionEnabled}
                />
              </label>
              <label>
                <span>
                  <input type="checkbox" checked={wordTargetEnabled} onChange={(event) => setWordTargetEnabled(event.target.checked)} />
                  修改字数目标
                </span>
                <input
                  type="number"
                  min={1}
                  value={wordTarget}
                  onChange={(event) => setWordTarget(event.target.value)}
                  placeholder="留空则清除"
                  disabled={!wordTargetEnabled}
                />
              </label>
              <label>
                <span>
                  <input type="checkbox" checked={categoryEnabled} onChange={(event) => setCategoryEnabled(event.target.checked)} />
                  修改分类
                </span>
                <input
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  list="document-structure-categories"
                  placeholder="输入或选择分类"
                  disabled={!categoryEnabled}
                />
                <datalist id="document-structure-categories">
                  {project.documentCategories.map((item) => <option key={item} value={item} />)}
                </datalist>
              </label>
            </div>
          )}
          <div className="document-structure-apply">
            <span className="hint">
              {selectedScope ? `将处理 ${selectedScope.documentCount} 个场景` : '没有可用范围'}
            </span>
            <button className="primary" disabled={!selectedScope || !hasBatchChanges} onClick={applyScope}>
              应用批量设定
            </button>
          </div>
        </section>

        <div className="document-structure-footer">
          <span>{notice}</span>
          <button className="ghost" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}
