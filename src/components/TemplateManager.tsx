import { useState } from 'react';
import { confirmDialog, promptText } from '../dialog';
import { useLoom } from '../store';
import type { EntityFieldType, EntityTemplateField, ObjectTemplate, TemplateModule } from '../types';
import { ENTITY_KIND_LABEL, FLOW_NODE_LABEL, TEMPLATE_MODULE_LABEL } from '../types';
import { uid } from '../util';

const MODULES = Object.keys(TEMPLATE_MODULE_LABEL) as TemplateModule[];

function templateBadge(t: ObjectTemplate): string {
  if (t.module === 'entity' && t.entityKind) return `${ENTITY_KIND_LABEL[t.entityKind]}默认`;
  if (t.module === 'node' && t.nodeType) return `${FLOW_NODE_LABEL[t.nodeType]}默认`;
  return '';
}

/** R11 模板管理器:全模块命名模板的创建 / 重命名 / 字段 / 继承 / 删除 */
export default function TemplateManager({ onClose }: { onClose: () => void }) {
  const templates = useLoom((s) => s.project.templates) ?? [];
  const addTemplate = useLoom((s) => s.addTemplate);
  const updateTemplate = useLoom((s) => s.updateTemplate);
  const removeTemplate = useLoom((s) => s.removeTemplate);
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null);
  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const [draftFields, setDraftFields] = useState<EntityTemplateField[] | null>(null);
  const fields = draftFields ?? selected?.fields ?? [];

  const pick = (id: string) => {
    setSelectedId(id);
    setDraftFields(null);
  };

  const create = async (module: TemplateModule) => {
    const name = await promptText({ message: `新建${TEMPLATE_MODULE_LABEL[module]}模板`, placeholder: '模板名称' });
    if (!name?.trim()) return;
    const t: ObjectTemplate = {
      id: uid(), name: name.trim(), module, fields: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
    addTemplate(t);
    pick(t.id);
  };

  const saveFields = () => {
    if (!selected || !draftFields) return;
    const clean = draftFields.filter((r) => r.label.trim()).map((r): EntityTemplateField => {
      const out: EntityTemplateField = { label: r.label.trim() };
      if (r.type && r.type !== 'text') out.type = r.type;
      if (r.filterKind) out.filterKind = r.filterKind;
      if (r.enumValues?.length) out.enumValues = r.enumValues;
      if (r.required) out.required = true;
      if (r.readonly) out.readonly = true;
      return out;
    });
    updateTemplate(selected.id, { fields: clean });
    setDraftFields(null);
  };

  const patchRow = (i: number, patch: Partial<EntityTemplateField>) =>
    setDraftFields((fields ?? []).map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const parents = selected
    ? templates.filter((t) => t.module === selected.module && t.id !== selected.id)
    : [];

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette tpl-manager" onClick={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <strong>模板管理器</strong>
          <span className="hint">编辑保存后,已套用的对象自动补齐新增字段(不改已有值)</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="tpl-manager-body">
          <div className="tpl-manager-list">
            {MODULES.map((module) => {
              const group = templates.filter((t) => t.module === module);
              return (
                <div key={module}>
                  <div className="tpl-manager-group">
                    {TEMPLATE_MODULE_LABEL[module]}
                    <button className="ghost icon-btn" title={`新建${TEMPLATE_MODULE_LABEL[module]}模板`} onClick={() => create(module)}>＋</button>
                  </div>
                  {group.map((t) => (
                    <div
                      key={t.id}
                      className={`side-item ${t.id === selectedId ? 'active' : ''}`}
                      onClick={() => pick(t.id)}
                    >
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                      {templateBadge(t) && <span className="tpl-badge">{templateBadge(t)}</span>}
                    </div>
                  ))}
                  {group.length === 0 && <div className="hint" style={{ padding: '2px 10px' }}>(无)</div>}
                </div>
              );
            })}
          </div>
          <div className="tpl-manager-edit">
            {selected ? (
              <>
                <div className="field">
                  <label>名称</label>
                  <input value={selected.name} onChange={(e) => updateTemplate(selected.id, { name: e.target.value })} />
                </div>
                <div className="field">
                  <label>继承自(父模板字段先出,同名被本模板覆盖)</label>
                  <select
                    value={selected.parentId ?? ''}
                    onChange={(e) => updateTemplate(selected.id, { parentId: e.target.value || undefined })}
                  >
                    <option value="">(不继承)</option>
                    {parents.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>本模板字段{draftFields && <span className="hint"> · 未保存</span>}</label>
                  {fields.map((r, i) => (
                    <div key={i} className="tpl-row">
                      <input
                        style={{ flex: 1 }}
                        value={r.label}
                        placeholder="字段名"
                        onChange={(e) => patchRow(i, { label: e.target.value })}
                      />
                      <select
                        value={r.type ?? 'text'}
                        onChange={(e) => patchRow(i, { type: e.target.value === 'text' ? undefined : e.target.value as EntityFieldType })}
                      >
                        <option value="text">文本</option>
                        <option value="entity">单实体</option>
                        <option value="entities">多实体</option>
                      </select>
                      <label className="tpl-check" title="必填"><input type="checkbox" checked={!!r.required} onChange={(e) => patchRow(i, { required: e.target.checked || undefined })} />必</label>
                      <label className="tpl-check" title="只读"><input type="checkbox" checked={!!r.readonly} onChange={(e) => patchRow(i, { readonly: e.target.checked || undefined })} />锁</label>
                      <button className="ghost icon-btn" onClick={() => setDraftFields(fields.filter((_, idx) => idx !== i))}>×</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button onClick={() => setDraftFields([...(fields ?? []), { label: '' }])}>＋ 添加字段</button>
                    {draftFields && <button className="primary" onClick={saveFields}>保存字段</button>}
                    {draftFields && <button className="ghost" onClick={() => setDraftFields(null)}>放弃修改</button>}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="danger"
                    onClick={async () => {
                      if (await confirmDialog({ message: `删除模板「${selected.name}」?已套用的对象保留全部字段值,仅解除关联。`, danger: true, confirmText: '删除' })) {
                        removeTemplate(selected.id);
                        setSelectedId(null);
                      }
                    }}
                  >删除模板</button>
                </div>
              </>
            ) : (
              <div className="empty-hint">左侧选择或新建一个模板</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
