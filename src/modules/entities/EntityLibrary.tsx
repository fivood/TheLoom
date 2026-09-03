import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { fileToAvatar } from '../../util';
import { findEntityRefs, useNav } from '../../search';
import { confirmDialog, alertDialog, promptText } from '../../dialog';
import type { Entity, EntityKind } from '../../types';
import { ENTITY_KIND_LABEL, PALETTE } from '../../types';
import { activePaletteColors } from '../../util';
import ColorPicker from '../../components/ColorPicker';
import Icon, { KIND_ICON } from '../../components/Icon';
import AttachmentEditor from '../../components/AttachmentEditor';
import TechNameField from '../../components/TechNameField';
import FieldListEditor from '../../components/FieldListEditor';
import { AiFillFieldsButton } from '../../components/AiPanel';
import { defaultEntityTemplate, resolveTemplateFields, specsForEntity } from '../../templates';
import Inspector from '../../components/Inspector';
import { EntityRefEditor, fieldRefIds } from '../../components/EntityRefField';
import type { EntityFieldType, EntityTemplateField, EntityTemplateSpec } from '../../types';
import EntityEditor from './EntityEditor';
import NavigatorTree, { FolderSelect } from '../../components/NavigatorTree';
import { CODEX_GROUP_LABEL, groupEntities, type CodexGroup, type CodexGroupBy } from './codexGroups';
import { useEscape } from '../../hooks/useEscape';
import Q from '../../components/Q';


const KINDS = Object.keys(ENTITY_KIND_LABEL) as EntityKind[];

/** 按类型的字段模板编辑器(编辑该类型的默认命名模板;保存后实例自动补齐新增字段) */
function TemplateModal({ initialKind, onClose }: { initialKind: EntityKind; onClose: () => void }) {
  useEscape(true, onClose);
  const setDefaultTemplate = useLoom((s) => s.setDefaultTemplate);
  const [kind, setKind] = useState<EntityKind>(initialKind);
  const readTpl = (k: EntityKind): EntityTemplateField[] =>
    resolveTemplateFields(useLoom.getState().project, defaultEntityTemplate(useLoom.getState().project, k)?.id);
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
    setDefaultTemplate({ entityKind: kind }, clean);
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
  const { addEntity, updateEntity, removeEntity, update } = useLoom();
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
  useEffect(() => {
    if (selected) useNav.getState().visit({ tab: 'entities', entityId: selected.id }, `实体 · ${selected.name}`);
  }, [selected?.id, selected?.name]);

  const project = useLoom((s) => s.project);
  const refs = useMemo(() => (selected ? findEntityRefs(project, selected) : []), [project, selected]);
  const avatarRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [pendingNameFocus, setPendingNameFocus] = useState<string | null>(null);

  const uploadAvatar = async (file: File) => {
    if (!selected) return;
    try {
      updateEntity(selected.id, { avatar: await fileToAvatar(file) });
    } catch {
      await alertDialog('无法读取该图片');
    }
  };

  const [editingTemplate, setEditingTemplate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'table' | 'overview'>('cards');
  const folders = useLoom((s) => s.project.folders);
  const addFolder = useLoom((s) => s.addFolder);
  // 建过分类文件夹的项目默认按分类看:那才是这部作品自己的世界观骨架
  const [groupBy, setGroupBy] = useState<CodexGroupBy>(
    () => folders.some((f) => f.module === 'entity') ? 'folder' : 'kind',
  );

  const fieldColumns = useMemo(() => {
    const seen = new Map<string, EntityFieldType>();
    for (const e of filtered) {
      for (const f of e.fields) {
        if (f.label && !seen.has(f.label)) seen.set(f.label, f.type ?? 'text');
      }
    }
    return Array.from(seen, ([label, type]) => ({ label, type }));
  }, [filtered]);

  const createEntity = (into?: { kind?: EntityKind; folderId?: string; templateId?: string }) => {
    const kind = into?.kind ?? (kindFilter === 'all' ? 'character' : kindFilter);
    const project = useLoom.getState().project;
    const defaultTpl = defaultEntityTemplate(project, kind);
    const tpl = resolveTemplateFields(project, defaultTpl?.id);
    const cols = activePaletteColors(project);
    const e: Entity = {
      id: uid(), kind, name: `新${ENTITY_KIND_LABEL[kind]}`,
      folderId: into ? into.folderId : selected?.folderId,
      templateId: into?.templateId ?? defaultTpl?.id,
      color: cols[entities.length % cols.length] ?? PALETTE[0],
      emoji: '', summary: '',
      fields: tpl.map((tf) => ({ id: uid(), label: tf.label, value: '', type: tf.type, filterKind: tf.filterKind })),
      notes: '', createdAt: Date.now(),
    };
    addEntity(e);
    setSelectedId(e.id);
    setPendingNameFocus(e.id);
  };

  // 新建后直接进入命名:聚焦并全选名字,与新建场景的即刻编辑体验一致
  useEffect(() => {
    if (!pendingNameFocus || selected?.id !== pendingNameFocus) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
    setPendingNameFocus(null);
  }, [pendingNameFocus, selected?.id]);

  const templates = useLoom((s) => s.project.templates);
  const projectForSpecs = useLoom((s) => s.project);
  const groups = useMemo(
    () => groupEntities(filtered, folders, templates ?? [], groupBy),
    [filtered, folders, templates, groupBy],
  );
  // 总览要看全貌,不受搜索与类型筛选影响
  const allGroups = useMemo(
    () => groupEntities(entities, folders, templates ?? [], groupBy === 'none' ? 'folder' : groupBy),
    [entities, folders, templates, groupBy],
  );

  const addCategory = async () => {
    const name = await promptText({ message: '新分类名称(例如:魔法体系 / 势力 / 地理 / 历史)', placeholder: '分类名称' });
    const clean = name?.trim();
    if (!clean) return;
    addFolder({ id: uid(), module: 'entity', name: clean });
    setGroupBy('folder');
  };

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
        onMoveMany={(ids, folderId) => update((p) => {
          const set = new Set(ids);
          for (const e of p.entities) if (set.has(e.id)) { e.folderId = folderId; delete e.order; }
        })}
        onReorder={(_parentId, orderedIds) => update((p) => {
          const map = new Map(orderedIds.map((id, i) => [id, i]));
          for (const e of p.entities) if (map.has(e.id)) e.order = map.get(e.id);
        })}
        onCreate={createEntity}
        createLabel="新建实体"
        emptyLabel="还没有实体"
      />

      <div className="pane-col">
        <div className="toolbar">
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as EntityKind | 'all')} style={{ width: 110 }}>
            <option value="all">全部类型</option>
            {KINDS.map((kind) => <option key={kind} value={kind}>{ENTITY_KIND_LABEL[kind]}</option>)}
          </select>
          <select
            value={groupBy}
            title="分组方式:内置类型只是通用骨架,作品自己的分类用文件夹或模板"
            onChange={(event) => setGroupBy(event.target.value as CodexGroupBy)}
            style={{ width: 150 }}
          >
            {(Object.keys(CODEX_GROUP_LABEL) as CodexGroupBy[]).map((key) => (
              <option key={key} value={key}>{CODEX_GROUP_LABEL[key]}</option>
            ))}
          </select>
          <div className="doc-mode-switch">
            {([['overview', '总览'], ['cards', '卡片'], ['table', '表格']] as const).map(([key, label]) => (
              <button
                key={key}
                className={viewMode === key ? 'primary' : 'ghost'}
                onClick={() => setViewMode(key)}
              >{label}</button>
            ))}
          </div>
          <button className="ghost" title="新建一个分类(实体文件夹),可以先摆骨架再填内容" onClick={() => void addCategory()}>＋ 分类</button>
          <button className="ghost" title="按类型设置字段模板" onClick={() => setEditingTemplate(true)}>字段模板</button>
          <input placeholder="搜索名称或简介…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 220 }} />
          <span className="hint">实体库中的角色可在流程编辑器里作为说话人引用</span>
        </div>
        {viewMode === 'overview' ? (
          <div className="codex-overview">
            <div className="codex-overview-head">
              <span>共 {entities.length} 条设定 · {allGroups.filter((g) => g.items.length > 0).length} 个有内容的分类</span>
              <span className="hint">先摆出分类骨架,再逐个填 —— 空分类会一直留在这里提醒你</span>
            </div>
            <div className="codex-grid">
              {allGroups.map((g) => (
                <div key={g.key} className={`codex-card ${g.items.length === 0 ? 'empty' : ''}`}>
                  <div className="codex-card-head">
                    <span className="codex-card-name">{g.label}</span>
                    <span className="codex-card-count">{g.items.length}</span>
                  </div>
                  <div className="codex-card-meta">
                    {g.items.length === 0
                      ? '还是空的'
                      : `${g.filled} / ${g.items.length} 写了简介`}
                  </div>
                  <div className="codex-chips">
                    {g.items.slice(0, 12).map((e) => (
                      <button
                        key={e.id}
                        className="codex-chip"
                        style={{ borderColor: e.color }}
                        onClick={() => { setSelectedId(e.id); setViewMode('cards'); }}
                        title={e.summary || '还没有简介'}
                      >
                        {!e.summary.trim() && <span className="codex-chip-dot" />}
                        {e.name}
                      </button>
                    ))}
                    {g.items.length > 12 && <span className="hint">…另有 {g.items.length - 12} 条</span>}
                  </div>
                  <button
                    className="ghost codex-add"
                    onClick={() => createEntity({ kind: g.kind, folderId: g.folderId, templateId: g.templateId })}
                  >＋ 新建到这一类</button>
                </div>
              ))}
            </div>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="codex-cards-scroll">
            {(groupBy === 'none' ? [{ key: 'all', label: '', items: filtered, filled: 0 } as CodexGroup] : groups)
              .filter((g) => g.items.length > 0 || groupBy === 'folder')
              .map((g) => (
              <div key={g.key} className="codex-section">
                {groupBy !== 'none' && (
                  <div className="codex-section-head">
                    <span>{g.label}</span>
                    <span className="codex-card-count">{g.items.length}</span>
                    <button
                      className="ghost codex-section-add"
                      title="新建到这一类"
                      onClick={() => createEntity({ kind: g.kind, folderId: g.folderId, templateId: g.templateId })}
                    >＋</button>
                  </div>
                )}
                {g.items.length === 0
                  ? <div className="hint" style={{ padding: '2px 4px 8px' }}>这一类还是空的</div>
                  : <div className="card-grid">
            {g.items.map((e) => (
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
                    </div>}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="empty-hint">
                {entities.length === 0
                  ? <>还没有设定。点击上方<Q>＋ 分类</Q>先摆出骨架,或用左侧<Q>＋ 新建实体</Q>直接写。</>
                  : '没有匹配的实体'}
              </div>
            )}
          </div>
        ) : (
          <div className="entity-table-wrap">
            <table className="var-table entity-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th style={{ minWidth: 100 }}>名称</th>
                  <th style={{ width: 80 }}>类型</th>
                  <th style={{ minWidth: 120 }}>简介</th>
                  {fieldColumns.map((col) => (
                    <th key={col.label} style={{ minWidth: 80 }}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr
                    key={e.id}
                    className={selectedId === e.id ? 'selected' : ''}
                    onClick={() => setSelectedId(e.id)}
                    onDoubleClick={() => { setSelectedId(e.id); setExpandedId(e.id); }}
                  >
                    <td style={{ textAlign: 'center', padding: '4px 2px' }}>
                      <span className="entity-avatar entity-avatar-sm" style={{ background: `${e.color}1a` }}>
                        {e.avatar ? <img src={e.avatar} alt="" /> : <Icon name={KIND_ICON[e.kind]} size={14} />}
                      </span>
                    </td>
                    <td>
                      <input
                        value={e.name}
                        onChange={(ev) => updateEntity(e.id, { name: ev.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        value={e.kind}
                        onChange={(ev) => updateEntity(e.id, { kind: ev.target.value as EntityKind })}
                      >
                        {KINDS.map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        value={e.summary}
                        onChange={(ev) => updateEntity(e.id, { summary: ev.target.value })}
                      />
                    </td>
                    {fieldColumns.map((col) => {
                      const f = e.fields.find((x) => x.label === col.label);
                      const val = f?.value ?? '';
                      const fType = f?.type ?? col.type;
                      const setVal = (v: string) => {
                        if (f) {
                          updateEntity(e.id, {
                            fields: e.fields.map((x) => x.id === f.id ? { ...x, value: v } : x),
                          });
                        } else {
                          updateEntity(e.id, {
                            fields: [...e.fields, { id: uid(), label: col.label, value: v, type: col.type }],
                          });
                        }
                      };
                      if (fType === 'boolean') {
                        return (
                          <td key={col.label} style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={val === 'true'}
                              onChange={(ev) => setVal(String(ev.target.checked))}
                            />
                          </td>
                        );
                      }
                      if (fType === 'number') {
                        return (
                          <td key={col.label}>
                            <input
                              type="number"
                              value={val}
                              placeholder="0"
                              onChange={(ev) => setVal(ev.target.value)}
                            />
                          </td>
                        );
                      }
                      if (fType === 'entity' || fType === 'entities') {
                        return (
                          <td key={col.label} style={{ minWidth: 140 }}>
                            <EntityRefEditor
                              type={fType}
                              value={val}
                              onChange={(v) => setVal(v)}
                            />
                          </td>
                        );
                      }
                      return (
                        <td key={col.label}>
                          <input
                            value={val}
                            onChange={(ev) => setVal(ev.target.value)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4 + fieldColumns.length} className="empty-hint" style={{ textAlign: 'center', padding: 24 }}>
                      {entities.length === 0
                        ? <>还没有实体。点击上方<Q>＋ 新建实体</Q>创建角色、地点或设定。</>
                        : '没有匹配的实体'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Inspector>
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
                ref={nameInputRef}
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
              onRenamed={(oldV, newV) => useLoom.getState().renameScriptIdentifier(oldV, newV)}
            />
            <div className="field">
              <label title="常见简称、昵称、代称;AI 长文抽取时会告诉模型这些别名指向本实体,避免把「塞」「塞梅」「塞梅尔维斯」当成三个人">
                别名(用于 AI 消歧)
              </label>
              <input
                value={(selected.aliases ?? []).join(', ')}
                placeholder="例如:塞, 塞梅, Semmelweis(逗号分隔)"
                onChange={(e) => {
                  const list = e.target.value.split(/[,,、]/).map((s) => s.trim()).filter(Boolean);
                  updateEntity(selected.id, { aliases: list.length ? list : undefined });
                }}
              />
            </div>
            <div className="field">
              <label>模板</label>
              <select
                value={selected.templateId ?? ''}
                onChange={(e) => useLoom.getState().assignEntityTemplate(selected.id, e.target.value || undefined)}
              >
                <option value="">(不套用模板)</option>
                {(templates ?? []).filter((t) => t.module === 'entity').map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.entityKind ? `(${ENTITY_KIND_LABEL[t.entityKind]}默认)` : ''}</option>
                ))}
              </select>
            </div>
            <FieldListEditor
              fields={selected.fields}
              specs={specsForEntity(projectForSpecs, selected)}
              onChange={(fields) => updateEntity(selected.id, { fields })}
              onFieldRenamed={selected.technicalName
                ? (o, n) => useLoom.getState().renameScriptEntityField(selected.technicalName!, o, n)
                : undefined}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
              <AiFillFieldsButton entity={selected} />
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
              onClick={async () => {
                // 与删除场景一致:先说清会波及什么,再让人决定
                const lines = refs.slice(0, 6).map((r) => `• ${r.module} · ${r.kind}:${r.title}`);
                const hidden = Math.max(0, refs.length - lines.length);
                const refText = lines.length > 0
                  ? `\n\n它被 ${refs.length} 处引用:\n${lines.join('\n')}${hidden ? `\n• 另有 ${hidden} 处` : ''}`
                    + '\n\n关系与角色弧线会一并删除;说话人、POV、地点、时间线与地图上的引用会留下来,可在体检里逐条处理。'
                  : '';
                if (await confirmDialog({ message: `删除实体「${selected.name}」?${refText}`, danger: true, confirmText: '删除' })) {
                  removeEntity(selected.id);
                  setSelectedId(null);
                }
              }}
            >删除实体</button>
          </>
        ) : (
          <div className="empty-hint">点击左侧卡片<br />查看和编辑实体</div>
        )}
      </Inspector>

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
