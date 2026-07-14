import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { fileToAvatar } from '../../util';
import { findEntityRefs, useNav } from '../../search';
import type { Entity, EntityKind } from '../../types';
import { ENTITY_KIND_LABEL, PALETTE } from '../../types';
import Icon, { KIND_ICON } from '../../components/Icon';
import AttachmentEditor from '../../components/AttachmentEditor';
import { EntityRefEditor, fieldRefIds } from '../../components/EntityRefField';
import type { EntityFieldType, EntityTemplateField, EntityTemplateSpec } from '../../types';

/** 归一化模板条目:老字符串等价于文本字段 */
function normTpl(spec: EntityTemplateSpec): EntityTemplateField {
  return typeof spec === 'string' ? { label: spec } : spec;
}

const KINDS = Object.keys(ENTITY_KIND_LABEL) as EntityKind[];

/** 按类型的字段模板编辑器 */
function TemplateModal({ initialKind, onClose }: { initialKind: EntityKind; onClose: () => void }) {
  const update = useLoom((s) => s.update);
  const [kind, setKind] = useState<EntityKind>(initialKind);
  const readTpl = (k: EntityKind): EntityTemplateField[] =>
    (useLoom.getState().project.entityTemplates?.[k] ?? []).map(normTpl);
  const [rows, setRows] = useState<EntityTemplateField[]>(() => readTpl(initialKind));

  const switchKind = (k: EntityKind) => { setKind(k); setRows(readTpl(k)); };
  const save = () => {
    const clean = rows.filter((r) => r.label.trim()).map((r) => ({
      label: r.label.trim(),
      ...(r.type && r.type !== 'text' ? { type: r.type } : {}),
      ...(r.filterKind ? { filterKind: r.filterKind } : {}),
    }));
    update((p) => {
      p.entityTemplates ??= {};
      // 纯文本模板落回字符串以保持文件精简
      p.entityTemplates[kind] = clean.map((r) => (r.type || r.filterKind ? r : r.label));
    });
    onClose();
  };

  const patchRow = (i: number, patch: Partial<EntityTemplateField>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const addRow = () => setRows((rs) => [...rs, { label: '' }]);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <div className="sync-head">
          <span>字段模板 · {ENTITY_KIND_LABEL[kind]}</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="field">
            <label>实体类型</label>
            <select value={kind} onChange={(e) => switchKind(e.target.value as EntityKind)}>
              {KINDS.map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <table className="var-table">
            <thead>
              <tr>
                <th>字段名</th>
                <th style={{ width: 100 }}>类型</th>
                <th style={{ width: 110 }}>限定实体</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input value={r.label} onChange={(e) => patchRow(i, { label: e.target.value })} placeholder="例如:欲望" />
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
                    {r.type && r.type !== 'text' ? (
                      <select
                        value={r.filterKind ?? ''}
                        onChange={(e) => patchRow(i, { filterKind: (e.target.value || undefined) as EntityKind | undefined })}
                      >
                        <option value="">任意</option>
                        {KINDS.map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}
                      </select>
                    ) : <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>}
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

export default function EntityLibrary() {
  const entities = useLoom((s) => s.project.entities);
  const { addEntity, updateEntity, removeEntity } = useLoom();
  const [kindFilter, setKindFilter] = useState<EntityKind | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // 消费搜索跳转目标
  const navSeq = useNav((s) => s.seq);
  useEffect(() => {
    const t = useNav.getState().target;
    if (t?.tab === 'entities' && t.entityId) {
      setKindFilter('all');
      setSelectedId(t.entityId);
      useNav.getState().clear();
    }
  }, [navSeq]);

  const filtered = entities.filter((e) =>
    (kindFilter === 'all' || e.kind === kindFilter) &&
    (!query || e.name.includes(query) || e.summary.includes(query)),
  );
  const selected = entities.find((e) => e.id === selectedId) ?? null;

  const project = useLoom((s) => s.project);
  const refs = useMemo(() => (selected ? findEntityRefs(project, selected) : []), [project, selected]);
  const avatarRef = useRef<HTMLInputElement>(null);

  const uploadAvatar = async (file: File) => {
    if (!selected) return;
    try {
      updateEntity(selected.id, { avatar: await fileToAvatar(file) });
    } catch {
      alert('无法读取该图片');
    }
  };

  const [editingTemplate, setEditingTemplate] = useState(false);

  const createEntity = () => {
    const kind = kindFilter === 'all' ? 'character' : kindFilter;
    const tpl = (useLoom.getState().project.entityTemplates?.[kind] ?? []).map(normTpl);
    const e: Entity = {
      id: uid(), kind, name: `新${ENTITY_KIND_LABEL[kind]}`,
      color: PALETTE[entities.length % PALETTE.length],
      emoji: '', summary: '',
      fields: tpl.map((tf) => ({ id: uid(), label: tf.label, value: '', type: tf.type, filterKind: tf.filterKind })),
      notes: '', createdAt: Date.now(),
    };
    addEntity(e);
    setSelectedId(e.id);
  };

  const missingTplFields: EntityTemplateField[] = selected
    ? (useLoom.getState().project.entityTemplates?.[selected.kind] ?? [])
        .map(normTpl)
        .filter((tf) => !selected.fields.some((f) => f.label === tf.label))
    : [];

  return (
    <>
      <div className="side-list">
        <div className="side-head">
          <span>实体类型</span>
          <button className="ghost icon-btn" title="按类型设置字段模板" onClick={() => setEditingTemplate(true)}>模板</button>
        </div>
        <div className="items">
          <div className={`side-item ${kindFilter === 'all' ? 'active' : ''}`} onClick={() => setKindFilter('all')}>
            全部 <span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>{entities.length}</span>
          </div>
          {KINDS.map((k) => (
            <div key={k} className={`side-item ${kindFilter === k ? 'active' : ''}`} onClick={() => setKindFilter(k)}>
              <Icon name={KIND_ICON[k]} /> {ENTITY_KIND_LABEL[k]}
              <span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>
                {entities.filter((e) => e.kind === k).length}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="pane-col">
        <div className="toolbar">
          <button className="primary" onClick={createEntity}>＋ 新建实体</button>
          <input placeholder="搜索名称或简介…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 220 }} />
          <span className="hint">实体库中的角色可在流程编辑器里作为说话人引用</span>
        </div>
        <div className="card-grid">
          {filtered.map((e) => (
            <div
              key={e.id}
              className={`info-card ${selectedId === e.id ? 'selected' : ''}`}
              style={{ borderTopColor: e.color }}
              onClick={() => setSelectedId(e.id)}
            >
              <div className="card-title">
                <span className="entity-avatar" style={{ background: `${e.color}1a` }}>
                  {e.avatar ? <img src={e.avatar} alt="" /> : <Icon name={KIND_ICON[e.kind]} size={18} />}
                </span>
                <span>
                  {e.name}
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400 }}>{ENTITY_KIND_LABEL[e.kind]}</div>
                </span>
              </div>
              {e.summary && <div className="card-body">{e.summary}</div>}
              {e.fields.length > 0 && (
                <div className="card-tags">
                  {e.fields.slice(0, 3).map((f) => {
                    const ids = fieldRefIds(f.value, f.type);
                    if (ids.length > 0) {
                      const names = ids.map((id) => entities.find((x) => x.id === id)?.name ?? '?').join('、');
                      return <span key={f.id} className="tag">{f.label} → {names}</span>;
                    }
                    return <span key={f.id} className="tag">{f.label}: {f.value}</span>;
                  })}
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && <div className="empty-hint" style={{ gridColumn: '1/-1' }}>没有匹配的实体</div>}
        </div>
      </div>

      <aside className="inspector">
        {selected ? (
          <>
            <h3>实体属性</h3>
            <div className="kv-row">
              <span
                className="entity-avatar avatar-edit"
                style={{ background: `${selected.color}1a` }}
                title="点击上传头像图片"
                onClick={() => avatarRef.current?.click()}
              >
                {selected.avatar ? <img src={selected.avatar} alt="" /> : <Icon name={KIND_ICON[selected.kind]} size={18} />}
              </span>
              <input
                style={{ width: 'auto', flex: 1 }}
                value={selected.name}
                onChange={(e) => updateEntity(selected.id, { name: e.target.value })}
              />
            </div>
            <div className="kv-row">
              <button onClick={() => avatarRef.current?.click()}><Icon name="image" /> 上传头像</button>
              {selected.avatar && (
                <button className="ghost" onClick={() => updateEntity(selected.id, { avatar: undefined })}>移除头像</button>
              )}
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
              <label>类型</label>
              <select value={selected.kind} onChange={(e) => updateEntity(selected.id, { kind: e.target.value as EntityKind })}>
                {KINDS.map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>颜色</label>
              <div className="color-row">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    className={`color-swatch ${selected.color === c ? 'selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => updateEntity(selected.id, { color: c })}
                  />
                ))}
              </div>
            </div>
            <div className="field">
              <label>一句话简介</label>
              <textarea rows={3} value={selected.summary} onChange={(e) => updateEntity(selected.id, { summary: e.target.value })} />
            </div>
            <div className="field">
              <label>自定义字段(文本或引用其他实体)</label>
              {selected.fields.map((f) => {
                const type: EntityFieldType = f.type ?? 'text';
                const patchField = (patch: Partial<typeof f>) => updateEntity(selected.id, {
                  fields: selected.fields.map((x) => x.id === f.id ? { ...x, ...patch } : x),
                });
                return (
                  <div key={f.id} className="field-row">
                    <div className="field-row-head">
                      <input
                        className="field-label"
                        value={f.label}
                        placeholder="字段名"
                        onChange={(e) => patchField({ label: e.target.value })}
                      />
                      <select
                        className="field-type"
                        value={type}
                        onChange={(e) => patchField({ type: e.target.value as EntityFieldType, value: '' })}
                        title="字段类型"
                      >
                        <option value="text">文本</option>
                        <option value="entity">→ 单实体</option>
                        <option value="entities">→ 多实体</option>
                      </select>
                      {type !== 'text' && (
                        <select
                          className="field-filter"
                          value={f.filterKind ?? ''}
                          onChange={(e) => patchField({ filterKind: (e.target.value || undefined) as EntityKind | undefined })}
                          title="限定实体类型"
                        >
                          <option value="">任意类型</option>
                          {KINDS.map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}
                        </select>
                      )}
                      <button
                        className="ghost icon-btn"
                        onClick={() => updateEntity(selected.id, { fields: selected.fields.filter((x) => x.id !== f.id) })}
                      >×</button>
                    </div>
                    <div className="field-row-value">
                      {type === 'text' && (
                        <input value={f.value} placeholder="值" onChange={(e) => patchField({ value: e.target.value })} />
                      )}
                      {type !== 'text' && (
                        <EntityRefEditor
                          type={type}
                          value={f.value}
                          filterKind={f.filterKind}
                          onChange={(v) => patchField({ value: v })}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => updateEntity(selected.id, {
                  fields: [...selected.fields, { id: uid(), label: '', value: '' }],
                })}>＋ 添加字段</button>
                {missingTplFields.length > 0 && (
                  <button
                    title={`补齐模板中缺少的字段:${missingTplFields.map((f) => f.label).join('、')}`}
                    onClick={() => updateEntity(selected.id, {
                      fields: [...selected.fields, ...missingTplFields.map((tf) => ({
                        id: uid(), label: tf.label, value: '', type: tf.type, filterKind: tf.filterKind,
                      }))],
                    })}
                  >按模板补齐({missingTplFields.length})</button>
                )}
              </div>
            </div>
            <div className="field">
              <label>备注</label>
              <textarea rows={5} value={selected.notes} onChange={(e) => updateEntity(selected.id, { notes: e.target.value })} />
            </div>
            <AttachmentEditor ownerId={selected.id} />
            <div className="field">
              <label>出现于({refs.length})</label>
              {refs.length === 0 && (
                <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                  暂无引用——在对白里选它做说话人、<br />在时间线事件里关联它,或在文本中提到它的名字
                </div>
              )}
              {refs.map((r) => (
                <div key={r.key} className="ref-item" onClick={() => useNav.getState().go(r.nav)} title={r.snippet}>
                  <span className="palette-kind">{r.module} · {r.kind}</span>
                  <span className="ref-title">{r.title}</span>
                </div>
              ))}
            </div>
            <button
              className="danger"
              onClick={() => {
                if (confirm(`删除实体「${selected.name}」?`)) {
                  removeEntity(selected.id);
                  setSelectedId(null);
                }
              }}
            >删除实体</button>
          </>
        ) : (
          <div className="empty-hint">点击左侧卡片<br />查看和编辑实体</div>
        )}
      </aside>

      {editingTemplate && (
        <TemplateModal
          initialKind={kindFilter === 'all' ? 'character' : kindFilter}
          onClose={() => setEditingTemplate(false)}
        />
      )}
    </>
  );
}
