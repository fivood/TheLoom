import { useMemo } from 'react';
import { uid, useLoom } from '../store';
import { EntityRefEditor } from './EntityRefField';
import type { EntityField, EntityFieldType, EntityKind, EntityTemplateField, EntityTemplateSpec } from '../types';
import { ENTITY_KIND_LABEL } from '../types';

const KINDS = Object.keys(ENTITY_KIND_LABEL) as EntityKind[];

const normTpl = (s: EntityTemplateSpec): EntityTemplateField =>
  typeof s === 'string' ? { label: s } : s;

/**
 * 可复用的字段列表编辑器:实体与流程节点共用。
 * 按 specs 约束渲染:enum 下拉、readonly 只读、required 标记。
 * 自动算出模板中缺失的字段并提供"按模板补齐"。
 */
export default function FieldListEditor({ fields, specs, onChange, refKindLabel = '实体', onFieldRenamed }: {
  fields: EntityField[];
  specs: EntityTemplateSpec[] | undefined;
  onChange: (fields: EntityField[]) => void;
  /** 引用字段 filterKind 的候选标签前缀(展示用) */
  refKindLabel?: string;
  /** 字段名编辑结束(blur)且新旧都非空时回调,用于脚本重命名联动 */
  onFieldRenamed?: (oldLabel: string, newLabel: string) => void;
}) {
  const tplSpecs = useMemo(() => (specs ?? []).map(normTpl), [specs]);
  const specFor = (label: string) => tplSpecs.find((s) => s.label === label);
  const missingTplFields = tplSpecs.filter((tf) => !fields.some((f) => f.label === tf.label));

  const patchField = (id: string, patch: Partial<EntityField>) =>
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  return (
    <div className="field">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <label style={{ margin: 0, flex: 1 }}>自定义字段{missingTplFields.length > 0 && <span className="hint" style={{ fontSize: 11 }}> · 模板缺 {missingTplFields.length} 个</span>}</label>
      </div>
      {fields.map((f) => {
        const type: EntityFieldType = f.type ?? 'text';
        const spec = specFor(f.label);
        return (
          <div key={f.id} className={`field-row ${spec?.readonly ? 'field-readonly' : ''}`}>
            <div className="field-row-head">
              <input
                className="field-label"
                value={f.label}
                placeholder="字段名"
                readOnly={spec?.readonly === true}
                onChange={(e) => patchField(f.id, { label: e.target.value })}
                onFocus={(e) => { e.currentTarget.dataset.focusLabel = f.label; }}
                onBlur={(e) => {
                  const oldLabel = e.currentTarget.dataset.focusLabel;
                  if (onFieldRenamed && oldLabel && f.label && oldLabel !== f.label) {
                    onFieldRenamed(oldLabel, f.label);
                  }
                  delete e.currentTarget.dataset.focusLabel;
                }}
              />
              {spec?.required && <span className="req-mark" title="必填">*</span>}
              {spec?.readonly ? (
                <span className="hint" style={{ fontSize: 11 }} title="模板只读字段">🔒</span>
              ) : (
                <>
                  <select
                    className="field-type"
                    value={type}
                    onChange={(e) => patchField(f.id, { type: e.target.value as EntityFieldType, value: '' })}
                    title="字段类型"
                  >
                    <option value="text">文本</option>
                    <option value="entity">→ 单{refKindLabel}</option>
                    <option value="entities">→ 多{refKindLabel}</option>
                  </select>
                  {type !== 'text' && (
                    <select
                      className="field-filter"
                      value={f.filterKind ?? ''}
                      onChange={(e) => patchField(f.id, { filterKind: (e.target.value || undefined) as EntityKind | undefined })}
                      title="限定类型"
                    >
                      <option value="">任意</option>
                      {KINDS.map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}
                    </select>
                  )}
                  <button
                    className="ghost icon-btn"
                    onClick={() => onChange(fields.filter((x) => x.id !== f.id))}
                  >×</button>
                </>
              )}
            </div>
            <div className="field-row-value">
              {type === 'text' && spec?.enumValues && spec.enumValues.length > 0 ? (
                <select
                  value={f.value}
                  onChange={(e) => patchField(f.id, { value: e.target.value })}
                  disabled={spec?.readonly === true}
                >
                  <option value="">(未选)</option>
                  {spec.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : type === 'text' && spec?.readonly ? (
                <input value={f.value} readOnly placeholder="值" />
              ) : type === 'text' ? (
                <input value={f.value} placeholder="值" onChange={(e) => patchField(f.id, { value: e.target.value })} />
              ) : (
                <EntityRefEditor
                  type={type}
                  value={f.value}
                  filterKind={f.filterKind}
                  onChange={(v) => patchField(f.id, { value: v })}
                />
              )}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onChange([...fields, { id: uid(), label: '', value: '' }])}>＋ 添加字段</button>
        {missingTplFields.length > 0 && (
          <button
            title={`补齐模板中缺少的字段:${missingTplFields.map((f) => f.label).join('、')}`}
            onClick={() => onChange([
              ...fields,
              ...missingTplFields.map((tf) => ({
                id: uid(), label: tf.label, value: '', type: tf.type, filterKind: tf.filterKind,
              })),
            ])}
          >按模板补齐({missingTplFields.length})</button>
        )}
      </div>
    </div>
  );
}
