import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { fileToAvatar } from '../../util';
import { findEntityRefs, useNav } from '../../search';
import type { Entity, EntityKind } from '../../types';
import { ENTITY_KIND_LABEL, PALETTE } from '../../types';
import Icon, { KIND_ICON } from '../../components/Icon';

const KINDS = Object.keys(ENTITY_KIND_LABEL) as EntityKind[];

/** 按类型的字段模板编辑器 */
function TemplateModal({ initialKind, onClose }: { initialKind: EntityKind; onClose: () => void }) {
  const templates = useLoom((s) => s.project.entityTemplates);
  const update = useLoom((s) => s.update);
  const [kind, setKind] = useState<EntityKind>(initialKind);
  const [text, setText] = useState(() => (templates?.[initialKind] ?? []).join('\n'));

  const switchKind = (k: EntityKind) => {
    setKind(k);
    setText((useLoom.getState().project.entityTemplates?.[k] ?? []).join('\n'));
  };
  const save = () => {
    const labels = text.split('\n').map((s) => s.trim()).filter(Boolean);
    update((p) => {
      p.entityTemplates ??= {};
      p.entityTemplates[kind] = labels;
    });
    onClose();
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <span>字段模板</span>
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
          <div className="field">
            <label>字段名(每行一个;新建该类型实体时自动带上这些字段)</label>
            <textarea
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'例如(角色):\n欲望\n恐惧\n口头禅\n秘密'}
            />
          </div>
          <div className="sync-actions">
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
    const tpl = useLoom.getState().project.entityTemplates?.[kind] ?? [];
    const e: Entity = {
      id: uid(), kind, name: `新${ENTITY_KIND_LABEL[kind]}`,
      color: PALETTE[entities.length % PALETTE.length],
      emoji: '', summary: '',
      fields: tpl.map((label) => ({ id: uid(), label, value: '' })),
      notes: '', createdAt: Date.now(),
    };
    addEntity(e);
    setSelectedId(e.id);
  };

  const missingTplFields = selected
    ? (useLoom.getState().project.entityTemplates?.[selected.kind] ?? [])
        .filter((label) => !selected.fields.some((f) => f.label === label))
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
                  {e.fields.slice(0, 3).map((f) => (
                    <span key={f.id} className="tag">{f.label}: {f.value}</span>
                  ))}
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
              <label>自定义字段(如 年龄 / 欲望 / 恐惧 / 口头禅)</label>
              {selected.fields.map((f) => (
                <div className="kv-row" key={f.id} style={{ marginBottom: 6 }}>
                  <input
                    value={f.label}
                    placeholder="字段"
                    onChange={(e) => updateEntity(selected.id, {
                      fields: selected.fields.map((x) => x.id === f.id ? { ...x, label: e.target.value } : x),
                    })}
                  />
                  <input
                    value={f.value}
                    placeholder="值"
                    onChange={(e) => updateEntity(selected.id, {
                      fields: selected.fields.map((x) => x.id === f.id ? { ...x, value: e.target.value } : x),
                    })}
                  />
                  <button
                    className="ghost icon-btn"
                    onClick={() => updateEntity(selected.id, { fields: selected.fields.filter((x) => x.id !== f.id) })}
                  >×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => updateEntity(selected.id, {
                  fields: [...selected.fields, { id: uid(), label: '', value: '' }],
                })}>＋ 添加字段</button>
                {missingTplFields.length > 0 && (
                  <button
                    title={`补齐模板中缺少的字段:${missingTplFields.join('、')}`}
                    onClick={() => updateEntity(selected.id, {
                      fields: [...selected.fields, ...missingTplFields.map((label) => ({ id: uid(), label, value: '' }))],
                    })}
                  >按模板补齐({missingTplFields.length})</button>
                )}
              </div>
            </div>
            <div className="field">
              <label>备注</label>
              <textarea rows={5} value={selected.notes} onChange={(e) => updateEntity(selected.id, { notes: e.target.value })} />
            </div>
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
