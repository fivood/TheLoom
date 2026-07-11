import { useState } from 'react';
import { uid, useLoom } from '../../store';
import type { Entity, EntityKind } from '../../types';
import { ENTITY_KIND_LABEL, PALETTE } from '../../types';

const KINDS = Object.keys(ENTITY_KIND_LABEL) as EntityKind[];
const KIND_EMOJI: Record<EntityKind, string> = {
  character: '👤', location: '🗺️', item: '🗝️', faction: '🏰', concept: '📜',
};

export default function EntityLibrary() {
  const entities = useLoom((s) => s.project.entities);
  const { addEntity, updateEntity, removeEntity } = useLoom();
  const [kindFilter, setKindFilter] = useState<EntityKind | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filtered = entities.filter((e) =>
    (kindFilter === 'all' || e.kind === kindFilter) &&
    (!query || e.name.includes(query) || e.summary.includes(query)),
  );
  const selected = entities.find((e) => e.id === selectedId) ?? null;

  const createEntity = () => {
    const kind = kindFilter === 'all' ? 'character' : kindFilter;
    const e: Entity = {
      id: uid(), kind, name: `新${ENTITY_KIND_LABEL[kind]}`,
      color: PALETTE[entities.length % PALETTE.length],
      emoji: KIND_EMOJI[kind], summary: '', fields: [], notes: '', createdAt: Date.now(),
    };
    addEntity(e);
    setSelectedId(e.id);
  };

  return (
    <>
      <div className="side-list">
        <div className="side-head"><span>实体类型</span></div>
        <div className="items">
          <div className={`side-item ${kindFilter === 'all' ? 'active' : ''}`} onClick={() => setKindFilter('all')}>
            全部 <span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>{entities.length}</span>
          </div>
          {KINDS.map((k) => (
            <div key={k} className={`side-item ${kindFilter === k ? 'active' : ''}`} onClick={() => setKindFilter(k)}>
              {KIND_EMOJI[k]} {ENTITY_KIND_LABEL[k]}
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
                <span className="entity-avatar" style={{ background: `${e.color}33` }}>{e.emoji}</span>
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
              <input
                style={{ width: 56, textAlign: 'center', fontSize: 18 }}
                value={selected.emoji}
                onChange={(e) => updateEntity(selected.id, { emoji: e.target.value })}
                title="图标(可输入任意 emoji)"
              />
              <input value={selected.name} onChange={(e) => updateEntity(selected.id, { name: e.target.value })} />
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
              <button onClick={() => updateEntity(selected.id, {
                fields: [...selected.fields, { id: uid(), label: '', value: '' }],
              })}>＋ 添加字段</button>
            </div>
            <div className="field">
              <label>备注</label>
              <textarea rows={5} value={selected.notes} onChange={(e) => updateEntity(selected.id, { notes: e.target.value })} />
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
    </>
  );
}
