import { useMemo, useState } from 'react';
import { useLoom } from '../store';
import Icon, { KIND_ICON } from '../components/Icon';
import type { Entity, EntityKind } from '../types';

const KIND_LABEL: Record<EntityKind, string> = {
  character: '角色', location: '地点', item: '物品', faction: '阵营', concept: '设定',
};

/** 移动端设定速查:只读浏览角色/地点/物品,编辑在桌面端 */
export default function MobileRef() {
  const entities = useLoom((s) => s.project.entities);
  const [query, setQuery] = useState('');

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
    return [...map.entries()];
  }, [matched]);

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
      <div className="m-section-label">设定速查(只读,编辑请在桌面端)</div>
      {entities.length > 0 && matched.length === 0 && <div className="hint">没有匹配的设定。</div>}
      {groups.map(([kind, list]) => (
        <div key={kind} className="m-ref-group">
          <div className="m-ref-kind">{KIND_LABEL[kind]}({list.length})</div>
          {list.map((e) => (
            <div key={e.id} className="m-ref-item">
              <div className="m-ref-head">
                <Icon name={KIND_ICON[e.kind]} size={14} />
                <strong>{e.name}</strong>
              </div>
              {e.summary && <p className="m-ref-summary">{e.summary}</p>}
            </div>
          ))}
        </div>
      ))}
      {entities.length === 0 && (
        <div className="hint">还没有设定。桌面端「实体」模块里建角色 / 地点 / 物品后,会在这里出现。</div>
      )}
    </div>
  );
}
