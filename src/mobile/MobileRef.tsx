import { useMemo } from 'react';
import { useLoom } from '../store';
import Icon, { KIND_ICON } from '../components/Icon';
import type { Entity, EntityKind } from '../types';

const KIND_LABEL: Record<EntityKind, string> = {
  character: '角色', location: '地点', item: '物品', faction: '阵营', concept: '设定',
};

/** 移动端设定速查:只读浏览角色/地点/物品,编辑在桌面端 */
export default function MobileRef() {
  const entities = useLoom((s) => s.project.entities);

  const groups = useMemo(() => {
    const map = new Map<EntityKind, Entity[]>();
    for (const e of entities) {
      const list = map.get(e.kind) ?? [];
      list.push(e);
      map.set(e.kind, list);
    }
    return [...map.entries()];
  }, [entities]);

  return (
    <div className="m-ref">
      <div className="m-section-label">设定速查(只读,编辑请在桌面端)</div>
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
