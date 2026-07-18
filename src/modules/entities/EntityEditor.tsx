import { useMemo, useRef } from 'react';
import { useLoom } from '../../store';
import { specsForEntity } from '../../templates';
import { fileToAvatar } from '../../util';
import { findEntityRefs, useNav } from '../../search';
import { confirmDialog, alertDialog } from '../../dialog';
import type { Entity, EntityKind } from '../../types';
import { ENTITY_KIND_LABEL, PALETTE } from '../../types';
import Icon, { KIND_ICON } from '../../components/Icon';
import AttachmentEditor from '../../components/AttachmentEditor';
import TechNameField from '../../components/TechNameField';
import FieldListEditor from '../../components/FieldListEditor';
import ColorPicker from '../../components/ColorPicker';

const KINDS = Object.keys(ENTITY_KIND_LABEL) as EntityKind[];

/**
 * 实体宽版编辑窗:三列布局,给字段多的实体足够铺展空间。
 * 与右侧 inspector 编辑同一份数据(实时双向),关掉即返回。
 */
export default function EntityEditor({ entityId, onClose }: { entityId: string; onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const { updateEntity, removeEntity } = useLoom();
  const entity = project.entities.find((e) => e.id === entityId) ?? null;
  const avatarRef = useRef<HTMLInputElement>(null);
  const refs = useMemo(() => (entity ? findEntityRefs(project, entity) : []), [project, entity]);

  if (!entity) {
    // 实体被外部删除时优雅退出
    onClose();
    return null;
  }

  const patch = (p: Partial<Entity>) => updateEntity(entity.id, p);

  const uploadAvatar = async (file: File) => {
    try { patch({ avatar: await fileToAvatar(file) }); }
    catch { await alertDialog('无法读取该图片'); }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="entity-editor" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <span className="entity-avatar" style={{ background: `${entity.color}1a`, width: 22, height: 22 }}>
            {entity.avatar ? <img src={entity.avatar} alt="" /> : <Icon name={KIND_ICON[entity.kind]} size={14} />}
          </span>
          <span style={{ fontWeight: 500 }}>{entity.name || '(未命名)'}</span>
          <span className="hint" style={{ fontSize: 12 }}>· {ENTITY_KIND_LABEL[entity.kind]}</span>
          <span className="spacer" />
          <button
            className="ghost"
            title="删除实体"
            onClick={async () => {
              if (await confirmDialog({ message: `删除实体「${entity.name}」?`, danger: true, confirmText: '删除' })) {
                removeEntity(entity.id);
                onClose();
              }
            }}
          ><Icon name="trash" size={13} /> 删除</button>
          <button className="ghost icon-btn" onClick={onClose} title="关闭(不影响已保存的改动)">×</button>
        </div>

        <div className="entity-editor-grid">
          {/* 基本信息 */}
          <div className="entity-editor-col">
            <div className="entity-editor-hero">
              <span
                className="entity-avatar avatar-edit"
                style={{ background: `${entity.color}1a`, width: 96, height: 96 }}
                title="点击上传头像"
                onClick={() => avatarRef.current?.click()}
              >
                {entity.avatar ? <img src={entity.avatar} alt="" /> : <Icon name={KIND_ICON[entity.kind]} size={40} />}
              </span>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={() => avatarRef.current?.click()}><Icon name="image" size={12} /> 上传</button>
                {entity.avatar && <button className="ghost" onClick={() => patch({ avatar: undefined })}>移除</button>}
              </div>
              <input
                ref={avatarRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadAvatar(f);
                  e.target.value = '';
                }}
              />
            </div>

            <div className="field">
              <label>名称</label>
              <input value={entity.name} onChange={(e) => patch({ name: e.target.value })} />
            </div>
            <div className="field">
              <label>类型</label>
              <select value={entity.kind} onChange={(e) => patch({ kind: e.target.value as EntityKind })}>
                {KINDS.map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>颜色</label>
              <ColorPicker
                value={entity.color}
                onChange={(c) => patch({ color: c ?? PALETTE[0] })}
                allowClear={false}
              />
            </div>
            <TechNameField
              value={entity.technicalName}
              onChange={(v) => patch({ technicalName: v })}
              displayName={entity.name}
              onRenamed={(oldV, newV) => useLoom.getState().renameScriptIdentifier(oldV, newV)}
            />
            <div className="field">
              <label>一句话简介</label>
              <textarea rows={4} value={entity.summary} onChange={(e) => patch({ summary: e.target.value })} />
            </div>
          </div>

          {/* 字段(自定义模板) */}
          <div className="entity-editor-col">
            <FieldListEditor
              fields={entity.fields}
              specs={specsForEntity(project, entity)}
              onChange={(fields) => patch({ fields })}
              onFieldRenamed={entity.technicalName
                ? (o, n) => useLoom.getState().renameScriptEntityField(entity.technicalName!, o, n)
                : undefined}
            />
          </div>

          {/* 备注 + 附件 + 反向引用 */}
          <div className="entity-editor-col">
            <div className="field">
              <label>备注</label>
              <textarea rows={12} value={entity.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="更长的描述、私下笔记、待办…" />
            </div>
            <AttachmentEditor ownerId={entity.id} />
            <div className="field">
              <label>出现于({refs.length})</label>
              {refs.length === 0 && (
                <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                  暂无引用——在对白里选它做说话人、<br />在时间线事件里关联它,或在文本中提到它的名字
                </div>
              )}
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {refs.map((r) => (
                  <div key={r.key} className="ref-item" onClick={() => { useNav.getState().go(r.nav); onClose(); }} title={r.snippet}>
                    <span className="palette-kind">{r.module} · {r.kind}</span>
                    <span className="ref-title">{r.title}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
