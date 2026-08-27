import { useMemo, useState } from 'react';
import { uid, useLoom } from '../store';
import Icon, { KIND_ICON } from '../components/Icon';
import ThemeToggle from '../components/ThemeToggle';
import { confirmDialog } from '../dialog';
import type { Entity, EntityField, EntityKind } from '../types';

const KIND_LABEL: Record<EntityKind, string> = {
  character: '角色', location: '地点', item: '物品', faction: '阵营', concept: '设定',
};
const KIND_ORDER: EntityKind[] = ['character', 'location', 'item', 'faction', 'concept'];

export default function MobileRef() {
  const entities = useLoom((s) => s.project.entities);
  const addEntity = useLoom((s) => s.addEntity);
  const updateEntity = useLoom((s) => s.updateEntity);
  const removeEntity = useLoom((s) => s.removeEntity);

  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftFields, setDraftFields] = useState<EntityField[]>([]);
  const [creating, setCreating] = useState<EntityKind | null>(null);

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) =>
      e.name.toLowerCase().includes(q)
      || (e.summary ?? '').toLowerCase().includes(q)
      || (e.notes ?? '').toLowerCase().includes(q)
      || (e.fields ?? []).some((f) =>
        f.label.toLowerCase().includes(q) || String(f.value ?? '').toLowerCase().includes(q)));
  }, [entities, query]);

  const groups = useMemo(() => {
    const map = new Map<EntityKind, Entity[]>();
    for (const e of matched) {
      const list = map.get(e.kind) ?? [];
      list.push(e);
      map.set(e.kind, list);
    }
    return KIND_ORDER.filter((k) => map.has(k)).map((k) => [k, map.get(k)!] as const);
  }, [matched]);

  const startEdit = (e: Entity) => {
    setCreating(null);
    setEditingId(e.id);
    setDraftName(e.name);
    setDraftSummary(e.summary ?? '');
    setDraftNotes(e.notes ?? '');
    setDraftFields(structuredClone(e.fields ?? []));
  };

  const startCreate = (kind: EntityKind) => {
    setEditingId(null);
    setCreating(kind);
    setDraftName('');
    setDraftSummary('');
    setDraftNotes('');
    setDraftFields([]);
  };

  const commit = () => {
    const name = draftName.trim();
    if (!name) { setEditingId(null); setCreating(null); return; }
    if (creating) {
      addEntity({
        id: uid(),
        kind: creating,
        name,
        color: '#d8d6d0',
        emoji: '',
        summary: draftSummary.trim(),
        fields: draftFields,
        notes: draftNotes.trim(),
        createdAt: Date.now(),
      });
    } else if (editingId) {
      updateEntity(editingId, {
        name,
        summary: draftSummary.trim(),
        notes: draftNotes.trim(),
        fields: draftFields,
      });
    }
    setEditingId(null);
    setCreating(null);
  };

  const onRemove = async (e: Entity) => {
    const ok = await confirmDialog({
      title: `删除「${e.name}」?`,
      message: '关系与角色弧线会一并删除。说话人、POV、地点、时间线与地图上的引用会留下来,可在桌面端体检里逐条处理。',
      danger: true,
    });
    if (!ok) return;
    removeEntity(e.id);
    setEditingId(null);
  };

  const editor = (
    <div className="m-ref-edit">
      <label className="m-ref-label">
        <span>名称</span>
        <input
          value={draftName}
          autoFocus
          placeholder="名称"
          onChange={(ev) => setDraftName(ev.target.value)}
        />
      </label>
      <label className="m-ref-label">
        <span>一句话简介</span>
        <textarea
          value={draftSummary}
          rows={2}
          placeholder="一句话简介…"
          onChange={(ev) => setDraftSummary(ev.target.value)}
        />
      </label>

      {/* 自定义字段 */}
      {draftFields.length > 0 && (
        <div className="m-ref-fields-section">
          <span className="m-ref-section-title">属性字段</span>
          {draftFields.map((f, i) => (
            <div key={f.id} className="m-ref-field-row">
              <span className="m-ref-field-label">{f.label}</span>
              <input
                className="m-ref-field-val"
                value={f.value ?? ''}
                placeholder="值…"
                onChange={(ev) => {
                  const val = ev.target.value;
                  setDraftFields((fs) => fs.map((x, idx) => idx === i ? { ...x, value: val } : x));
                }}
              />
            </div>
          ))}
        </div>
      )}

      <label className="m-ref-label">
        <span>详细设定与背景 (Notes)</span>
        <textarea
          value={draftNotes}
          rows={4}
          placeholder="详细背景设定、外貌特征、经历…"
          onChange={(ev) => setDraftNotes(ev.target.value)}
        />
      </label>

      <div className="m-ref-edit-row">
        {editingId && (
          <button
            className="ghost m-ref-del"
            onClick={() => {
              const e = entities.find((x) => x.id === editingId);
              if (e) void onRemove(e);
            }}
          >删除</button>
        )}
        <span style={{ flex: 1 }} />
        <button className="ghost" onClick={() => { setEditingId(null); setCreating(null); }}>取消</button>
        <button className="primary" disabled={!draftName.trim()} onClick={commit}>保存</button>
      </div>
    </div>
  );

  return (
    <div className="m-ref">
      {/* 极简顶栏 */}
      <div className="m-clean-topbar">
        <div className="m-top-title-wrap">
          <Icon name="book" size={17} />
          <span className="m-top-title">设定库</span>
          <span className="m-top-badge">{entities.length}</span>
        </div>
        <ThemeToggle />
      </div>

      {entities.length > 5 && (
        <div className="m-ref-search-wrap">
          <input
            className="m-ref-search"
            value={query}
            placeholder="搜索角色 / 地点 / 设定 / 属性…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {/* 快捷新建分类 */}
      <div className="m-ref-new">
        {KIND_ORDER.map((k) => (
          <button key={k} className="ghost m-ref-new-chip" onClick={() => startCreate(k)}>
            <Icon name={KIND_ICON[k]} size={13} />
            <span>＋{KIND_LABEL[k]}</span>
          </button>
        ))}
      </div>

      {creating && (
        <div className="m-ref-group">
          <div className="m-ref-kind">新建{KIND_LABEL[creating]}</div>
          {editor}
        </div>
      )}

      {groups.map(([kind, list]) => (
        <div key={kind} className="m-ref-group">
          <div className="m-ref-kind">{KIND_LABEL[kind]} ({list.length})</div>
          {list.map((e) => (
            editingId === e.id ? (
              <div key={e.id}>{editor}</div>
            ) : (
              <button key={e.id} className="m-ref-item" onClick={() => startEdit(e)}>
                <div className="m-ref-head">
                  <Icon name={KIND_ICON[e.kind]} size={15} />
                  <strong>{e.name}</strong>
                  {e.fields && e.fields.length > 0 && (
                    <span className="m-ref-field-count">{e.fields.length} 属性</span>
                  )}
                </div>
                {e.summary && <div className="m-ref-summary">{e.summary}</div>}
                {e.fields && e.fields.length > 0 && (
                  <div className="m-ref-chips">
                    {e.fields.slice(0, 3).map((f) => (
                      <span key={f.id} className="m-ref-chip">
                        {f.label}: {f.value || '—'}
                      </span>
                    ))}
                    {e.fields.length > 3 && <span className="m-ref-chip-more">+{e.fields.length - 3}</span>}
                  </div>
                )}
              </button>
            )
          ))}
        </div>
      ))}

      {entities.length > 0 && matched.length === 0 && <div className="hint" style={{ textAlign: 'center', padding: 20 }}>没有匹配的设定</div>}
      {entities.length === 0 && !creating && (
        <div className="hint" style={{ textAlign: 'center', padding: '36px 20px' }}>
          还没有设定。点击上方按钮快速创建角色、地点或设定。
        </div>
      )}
    </div>
  );
}
