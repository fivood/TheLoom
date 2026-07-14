import { useState } from 'react';
import { useLoom } from '../../store';
import { uid } from '../../util';
import type { EntityTemplateField, EntityTemplateSpec, FlowNodeType } from '../../types';
import { FLOW_NODE_LABEL } from '../../types';
import type { EntityFieldType } from '../../types';

const normTpl = (s: EntityTemplateSpec): EntityTemplateField => (typeof s === 'string' ? { label: s } : s);

/** 按节点类型编辑模板字段 + 约束(与实体模板同构) */
export default function NodeTemplateModal({ initialType, onClose }: { initialType: FlowNodeType; onClose: () => void }) {
  const update = useLoom((s) => s.update);
  const [type, setType] = useState<FlowNodeType>(initialType);
  const readTpl = (t: FlowNodeType): EntityTemplateField[] =>
    (useLoom.getState().project.nodeTemplates?.[t] ?? []).map(normTpl);
  const [rows, setRows] = useState<EntityTemplateField[]>(() => readTpl(initialType));

  const switchType = (t: FlowNodeType) => { setType(t); setRows(readTpl(t)); };
  const save = () => {
    const clean = rows.filter((r) => r.label.trim()).map((r): EntityTemplateField => {
      const out: EntityTemplateField = { label: r.label.trim() };
      if (r.type && r.type !== 'text') out.type = r.type;
      if (r.filterKind) out.filterKind = r.filterKind;
      if (r.enumValues && r.enumValues.length) out.enumValues = r.enumValues;
      if (r.required) out.required = true;
      if (r.readonly) out.readonly = true;
      return out;
    });
    update((p) => {
      p.nodeTemplates ??= {};
      p.nodeTemplates[type] = clean.map((r) =>
        (r.type || r.filterKind || r.enumValues?.length || r.required || r.readonly) ? r : r.label
      );
    });
    onClose();
  };
  const patchRow = (i: number, patch: Partial<EntityTemplateField>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const addRow = () => setRows((rs) => [...rs, { label: '' }]);

  const TYPES = Object.keys(FLOW_NODE_LABEL) as FlowNodeType[];

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
        <div className="sync-head">
          <span>节点字段模板 · {FLOW_NODE_LABEL[type]}</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="field">
            <label>节点类型</label>
            <select value={type} onChange={(e) => switchType(e.target.value as FlowNodeType)}>
              {TYPES.map((t) => <option key={t} value={t}>{FLOW_NODE_LABEL[t]}</option>)}
            </select>
          </div>
          <table className="var-table tpl-table">
            <thead>
              <tr>
                <th>字段名</th>
                <th style={{ width: 90 }}>类型</th>
                <th style={{ width: 150 }}>枚举值(逗号分隔)</th>
                <th style={{ width: 34 }} title="必填">必</th>
                <th style={{ width: 34 }} title="只读">只</th>
                <th style={{ width: 34 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input value={r.label} onChange={(e) => patchRow(i, { label: e.target.value })} placeholder="例如:情绪" />
                  </td>
                  <td>
                    <select
                      value={r.type ?? 'text'}
                      onChange={(e) => patchRow(i, { type: e.target.value as EntityFieldType })}
                    >
                      <option value="text">文本</option>
                      <option value="entity">→ 单实体</option>
                      <option value="entities">→ 多实体</option>
                    </select>
                  </td>
                  <td>
                    {(!r.type || r.type === 'text') ? (
                      <input
                        value={(r.enumValues ?? []).join(', ')}
                        onChange={(e) => patchRow(i, {
                          enumValues: e.target.value.split(/[，,]/).map((s) => s.trim()).filter(Boolean),
                        })}
                        placeholder="如:平静,愤怒,悲伤"
                      />
                    ) : <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={r.required === true} onChange={(e) => patchRow(i, { required: e.target.checked })} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={r.readonly === true} onChange={(e) => patchRow(i, { readonly: e.target.checked })} />
                  </td>
                  <td><button className="ghost icon-btn" onClick={() => removeRow(i)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sync-actions">
            <button onClick={addRow}>＋ 添加字段</button>
            <button className="primary" onClick={save}>保存模板</button>
          </div>
        </div>
      </div>
    </div>
  );
}
