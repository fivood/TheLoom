import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { fileToAvatar } from '../../util';
import { findEntityRefs, useNav } from '../../search';
import type { Entity, EntityKind } from '../../types';
import { ENTITY_KIND_LABEL, PALETTE } from '../../types';
import { activePaletteColors } from '../../util';
import ColorPicker from '../../components/ColorPicker';
import Icon, { KIND_ICON } from '../../components/Icon';
import AttachmentEditor from '../../components/AttachmentEditor';
import TechNameField from '../../components/TechNameField';
import FieldListEditor from '../../components/FieldListEditor';
import { EntityRefEditor, fieldRefIds } from '../../components/EntityRefField';
import type { EntityFieldType, EntityTemplateField, EntityTemplateSpec } from '../../types';
import EntityEditor from './EntityEditor';
import NavigatorTree, { FolderSelect } from '../../components/NavigatorTree';

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
      p.entityTemplates ??= {};
      // 无任何额外属性的纯文本字段落回字符串以保持文件精简
      p.entityTemplates[kind] = clean.map((r) =>
        (r.type || r.filterKind || r.enumValues?.length || r.required || r.readonly) ? r : r.label
      );
    });
    onClose();
  };

  const patchRow = (i: number, patch: Partial<EntityTemplateField>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const addRow = () => setRows((rs) => [...rs, { label: '' }]);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
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
          <table className="var-table tpl-table">
            <thead>
              <tr>
                <th>字段名</th>
                <th style={{ width: 90 }}>类型</th>
                <th style={{ width: 90 }}>限定实体</th>
                <th style={{ width: 150 }}>枚举值(逗号分隔)</th>
                <th style={{ width: 34 }} title="必填:实例上不能为空">必</th>
                <th style={{ width: 34 }} title="只读:实例上不可编辑">只</th>
                <th style={{ width: 34 }}></th>
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
                  <td>
                    {r.type === 'text' || !r.type ? (
                      <input
                        value={(r.enumValues ?? []).join(', ')}
                        onChange={(e) => patchRow(i, {
                          enumValues: e.target.value.split(/[，,]/).map((s) => s.trim()).filter(Boolean),
                        })}
                        placeholder="留空 = 自由文本;如:低,中,高"
                      />
                    ) : <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={r.required === true}
                      onChange={(e) => patchRow(i, { required: e.target.checked })}
                      title="必填"
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={r.readonly === true}
                      onChange={(e) => patchRow(i, { readonly: e.target.checked })}
                      title="只读"
                    />
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
      setQuery('');
      setSelectedId(t.entityId);
      useNav.getState().clear();
    }
  }, [navSeq]);

  const filtered = useMemo(() => entities.filter((e) =>
    (kindFilter === 'all' || e.kind === kindFilter) &&
    (!query || e.name.includes(query) || e.summary.includes(query)),
  ), [entities, kindFilter, query]);
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const createEntity = () => {
    const kind = kindFilter === 'all' ? 'character' : kindFilter;
    const tpl = (useLoom.getState().project.entityTemplates?.[kind] ?? []).map(normTpl);
    const cols = activePaletteColors(useLoom.getState().project);
    const e: Entity = {
      id: uid(), kind, name: `新${ENTITY_KIND_LABEL[kind]}`,
      folderId: selected?.folderId,
      color: cols[entities.length % cols.length] ?? PALETTE[0],
      emoji: '', summary: '',
      fields: tpl.map((tf) => ({ id: uid(), label: tf.label, value: '', type: tf.type, filterKind: tf.filterKind })),
      notes: '', createdAt: Date.now(),
    };
    addEntity(e);
    setSelectedId(e.id);
  };

  const entityTemplates = useLoom((s) => s.project.entityTemplates);

  return (
    <>
      <NavigatorTree
        module="entity"
        title="实体"
        items={filtered}
        selectedId={selectedId}
        getLabel={(entity) => entity.name}
        getDetail={(entity) => ENTITY_KIND_LABEL[entity.kind]}
        onSelect={setSelectedId}
        onMove={(id, folderId) => updateEntity(id, { folderId })}
        onCreate={createEntity}
        createLabel="新建实体"
        emptyLabel="还没有实体"
      />

      <div className="pane-col">
        <div className="toolbar">
          <button className="primary" onClick={createEntity}>＋ 新建实体</button>
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as EntityKind | 'all')} style={{ width: 110 }}>
            <option value="all">全部类型</option>
            {KINDS.map((kind) => <option key={kind} value={kind}>{ENTITY_KIND_LABEL[kind]}</option>)}
          </select>
          <button className="ghost" title="按类型设置字段模板" onClick={() => setEditingTemplate(true)}>字段模板</button>
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
              onDoubleClick={() => { setSelectedId(e.id); setExpandedId(e.id); }}
              title="单击选中 · 双击展开编辑窗"
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <h3 style={{ margin: 0, flex: 1 }}>实体属性</h3>
              <button
                className="ghost"
                title="打开宽版编辑窗(字段较多时更好用 · 也可双击卡片打开)"
                onClick={() => setExpandedId(selected.id)}
              >⤢ 展开</button>
            </div>
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
              <label>文件夹</label>
              <FolderSelect module="entity" value={selected.folderId} onChange={(folderId) => updateEntity(selected.id, { folderId })} />
            </div>
            <div className="field">
              <label>颜色</label>
              <ColorPicker
                value={selected.color}
                onChange={(c) => updateEntity(selected.id, { color: c ?? PALETTE[0] })}
                allowClear={false}
              />
            </div>
            <div className="field">
              <label>一句话简介</label>
              <textarea rows={3} value={selected.summary} onChange={(e) => updateEntity(selected.id, { summary: e.target.value })} />
            </div>
            <TechNameField
              value={selected.technicalName}
              onChange={(v) => updateEntity(selected.id, { technicalName: v })}
              displayName={selected.name}
            />
            <FieldListEditor
              fields={selected.fields}
              specs={entityTemplates?.[selected.kind]}
              onChange={(fields) => updateEntity(selected.id, { fields })}
            />
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
      {expandedId && (
        <EntityEditor entityId={expandedId} onClose={() => setExpandedId(null)} />
      )}
    </>
  );
}
