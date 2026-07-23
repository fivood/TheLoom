import { useEffect, useMemo, useState } from 'react';
import { applyBatchEdit, type BatchEditPatch } from '../batch';
import { useLoom } from '../store';
import {
  DOC_STATUS_LABEL,
  DOC_STATUS_ORDER,
  ENTITY_KIND_LABEL,
  type DocStatus,
  type EntityKind,
  type FolderModule,
} from '../types';

const MODULE_LABEL: Record<FolderModule, string> = {
  flow: '流程',
  entity: '实体',
  asset: '资源',
  document: '文档',
  research: '资料',
};

const TEMPLATE_MODULE: Partial<Record<FolderModule, 'entity' | 'asset' | 'document'>> = {
  entity: 'entity',
  asset: 'asset',
  document: 'document',
};

const splitTags = (value: string) => value.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean);

export default function BatchEditDialog({ module, ids, onClose }: {
  module: FolderModule;
  ids: string[];
  onClose: () => void;
}) {
  const project = useLoom((state) => state.project);
  const update = useLoom((state) => state.update);
  const [favorite, setFavorite] = useState('');
  const [folderId, setFolderId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [entityKind, setEntityKind] = useState('');
  const [documentStatus, setDocumentStatus] = useState('');
  const [revisionEnabled, setRevisionEnabled] = useState(false);
  const [revision, setRevision] = useState('');
  const [wordTargetEnabled, setWordTargetEnabled] = useState(false);
  const [wordTarget, setWordTarget] = useState('');
  const [categoryEnabled, setCategoryEnabled] = useState(false);
  const [category, setCategory] = useState('');
  const [pinned, setPinned] = useState('');
  const [addTags, setAddTags] = useState('');
  const [removeTags, setRemoveTags] = useState('');

  const folders = useMemo(
    () => project.folders.filter((folder) => folder.module === module),
    [project.folders, module],
  );
  const templates = useMemo(() => {
    const target = TEMPLATE_MODULE[module];
    return target ? (project.templates ?? []).filter((template) => template.module === target) : [];
  }, [project.templates, module]);
  const categories = module === 'document' ? project.documentCategories : project.researchCategories;
  const hasChanges = Boolean(
    favorite || folderId || templateId || entityKind || documentStatus || categoryEnabled || pinned
    || revisionEnabled || wordTargetEnabled
    || addTags.trim() || removeTags.trim(),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = () => {
    const patch: BatchEditPatch = {};
    if (favorite) patch.favorite = favorite === 'yes';
    if (folderId) patch.folderId = folderId === '__none__' ? null : folderId;
    if (templateId) patch.templateId = templateId === '__none__' ? null : templateId;
    if (entityKind) patch.entityKind = entityKind as EntityKind;
    if (documentStatus) patch.documentStatus = documentStatus === '__none__' ? null : documentStatus as DocStatus;
    if (revisionEnabled) {
      const value = Number(revision);
      patch.documentRevision = Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;
    }
    if (wordTargetEnabled) {
      const value = Number(wordTarget);
      patch.documentWordTarget = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    }
    if (categoryEnabled) {
      const clean = category.trim() || '未分类';
      if (module === 'document') patch.documentCategory = clean;
      if (module === 'research') patch.researchCategory = clean;
    }
    if (pinned) patch.researchPinned = pinned === 'yes';
    if (addTags.trim()) patch.addTags = splitTags(addTags);
    if (removeTags.trim()) patch.removeTags = splitTags(removeTags);
    update((next) => {
      applyBatchEdit(next, module, ids, patch);
      if (patch.documentCategory && !next.documentCategories.includes(patch.documentCategory)) {
        next.documentCategories.push(patch.documentCategory);
      }
      if (patch.researchCategory && !next.researchCategories.includes(patch.researchCategory)) {
        next.researchCategories.push(patch.researchCategory);
      }
    });
    onClose();
  };

  return (
    <div className="palette-backdrop batch-edit-backdrop" onClick={onClose}>
      <form
        className="palette batch-edit-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); submit(); }}
      >
        <div className="batch-edit-head">
          <div>
            <h3>批量编辑{MODULE_LABEL[module]}</h3>
            <p>已选择 {ids.length} 项。未设置的字段保持原值，应用后可一次撤销。</p>
          </div>
          <button type="button" className="ghost icon-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="batch-edit-grid">
          <label>
            <span>收藏状态</span>
            <select value={favorite} onChange={(event) => setFavorite(event.target.value)}>
              <option value="">保持不变</option>
              <option value="yes">加入收藏</option>
              <option value="no">取消收藏</option>
            </select>
          </label>
          <label>
            <span>所在文件夹</span>
            <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
              <option value="">保持不变</option>
              <option value="__none__">移到未分组</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          </label>
          {module === 'entity' && (
            <label>
              <span>实体类型</span>
              <select value={entityKind} onChange={(event) => setEntityKind(event.target.value)}>
                <option value="">保持不变</option>
                {(Object.keys(ENTITY_KIND_LABEL) as EntityKind[]).map((kind) => (
                  <option key={kind} value={kind}>{ENTITY_KIND_LABEL[kind]}</option>
                ))}
              </select>
            </label>
          )}
          {TEMPLATE_MODULE[module] && (
            <label>
              <span>命名模板</span>
              <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                <option value="">保持不变</option>
                <option value="__none__">取消模板</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
          )}
          {module === 'document' && (
            <>
              <label>
                <span>写作状态</span>
                <select value={documentStatus} onChange={(event) => setDocumentStatus(event.target.value)}>
                  <option value="">保持不变</option>
                  <option value="__none__">清除状态</option>
                  {DOC_STATUS_ORDER.map((status) => (
                    <option key={status} value={status}>{DOC_STATUS_LABEL[status]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>
                  <input
                    type="checkbox"
                    checked={revisionEnabled}
                    onChange={(event) => setRevisionEnabled(event.target.checked)}
                  />
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
                  <input
                    type="checkbox"
                    checked={wordTargetEnabled}
                    onChange={(event) => setWordTargetEnabled(event.target.checked)}
                  />
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
            </>
          )}
          {(module === 'document' || module === 'research') && (
            <label className="batch-edit-category">
              <span>
                <input
                  type="checkbox"
                  checked={categoryEnabled}
                  onChange={(event) => setCategoryEnabled(event.target.checked)}
                />
                修改分类
              </span>
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                list={`batch-categories-${module}`}
                placeholder="输入或选择分类"
                disabled={!categoryEnabled}
              />
              <datalist id={`batch-categories-${module}`}>
                {categories.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
          )}
          {module === 'research' && (
            <label>
              <span>置顶状态</span>
              <select value={pinned} onChange={(event) => setPinned(event.target.value)}>
                <option value="">保持不变</option>
                <option value="yes">置顶</option>
                <option value="no">取消置顶</option>
              </select>
            </label>
          )}
          {(module === 'asset' || module === 'research') && (
            <>
              <label>
                <span>添加标签</span>
                <input value={addTags} onChange={(event) => setAddTags(event.target.value)} placeholder="多个标签用逗号分隔" />
              </label>
              <label>
                <span>移除标签</span>
                <input value={removeTags} onChange={(event) => setRemoveTags(event.target.value)} placeholder="多个标签用逗号分隔" />
              </label>
            </>
          )}
        </div>
        <div className="batch-edit-actions">
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          <button type="submit" className="primary" disabled={!hasChanges}>应用到 {ids.length} 项</button>
        </div>
      </form>
    </div>
  );
}
