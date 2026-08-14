import { useMemo, useState } from 'react';
import { uid, useLoom } from '../store';
import Icon, { KIND_ICON } from '../components/Icon';
import { confirmDialog } from '../dialog';
import type { Entity, EntityKind } from '../types';

const KIND_LABEL: Record<EntityKind, string> = {
  character: '角色', location: '地点', item: '物品', faction: '阵营', concept: '设定',
};
const KIND_ORDER: EntityKind[] = ['character', 'location', 'item', 'faction', 'concept'];

/** 移动端设定:速查 + 就地新建 / 改名 / 改简介(字段与关系仍在桌面端编辑) */
export default function MobileRef() {
  const entities = useLoom((s) => s.project.entities);
  const addEntity = useLoom((s) => s.addEntity);
  const updateEntity = useLoom((s) => s.updateEntity);
  const removeEntity = useLoom((s) => s.removeEntity);

  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [creating, setCreating] = useState<EntityKind | null>(null);

  // 搜索覆盖名称 / 简介 / 自定义字段值 —— 写到一半查「那个客栈叫什么」多半只记得半个词
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) =>
      e.name.toLowerCase().includes(q)
      || (e.summary ?? '').toLowerCase().includes(q)
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
  };

  const startCreate = (kind: EntityKind) => {
    setEditingId(null);
    setCreating(kind);
    setDraftName('');
    setDraftSummary('');
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
        fields: [],
        notes: '',
        createdAt: Date.now(),
      });
    } else if (editingId) {
      updateEntity(editingId, { name, summary: draftSummary.trim() });
    }
    setEditingId(null);
    setCreating(null);
  };

  const onRemove = async (e: Entity) => {
    const ok = await confirmDialog({
      title: `删除「${e.name}」?`,
      message: '相关的关系、弧线与引用也会一并清理。',
      danger: true,
    });
    if (!ok) return;
    removeEntity(e.id);
    setEditingId(null);
  };

  const editor = (
    <div className="m-ref-edit">
      <input
        value={draftName}
        autoFocus
        placeholder="名称"
        onChange={(ev) => setDraftName(ev.target.value)}
      />
      <textarea
        value={draftSummary}
        rows={3}
        placeholder="一句话简介"
        onChange={(ev) => setDraftSummary(ev.target.value)}
      />
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
      {entities.length > 6 && (
        <input
          className="m-ref-search"
          value={query}
          placeholder="搜索角色 / 地点 / 设定…"
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {/* 手机上也能建设定 —— 否则必须先回桌面建好才有得看 */}
      <div className="m-ref-new">
        {KIND_ORDER.map((k) => (
          <button key={k} className="ghost" onClick={() => startCreate(k)}>＋{KIND_LABEL[k]}</button>
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
          <div className="m-ref-kind">{KIND_LABEL[kind]}({list.length})</div>
          {list.map((e) => (
            editingId === e.id ? (
              <div key={e.id}>{editor}</div>
            ) : (
              <button key={e.id} className="m-ref-item" onClick={() => startEdit(e)}>
                <span className="m-ref-head">
                  <Icon name={KIND_ICON[e.kind]} size={14} />
                  <strong>{e.name}</strong>
                </span>
                {e.summary && <span className="m-ref-summary">{e.summary}</span>}
              </button>
            )
          ))}
        </div>
      ))}

      {entities.length > 0 && matched.length === 0 && <div className="hint">没有匹配的设定。</div>}
      {entities.length === 0 && !creating && (
        <div className="hint">还没有设定。用上面的按钮建一个,或在桌面端「实体」模块里补齐字段与关系。</div>
      )}
    </div>
  );
}
