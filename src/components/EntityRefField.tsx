import { useLoom } from '../store';
import { useNav } from '../search';
import type { Entity, EntityFieldType, EntityKind } from '../types';
import { ENTITY_KIND_LABEL } from '../types';

/** 单个/多个实体引用编辑器 */
export function EntityRefEditor({ type, value, filterKind, onChange }: {
  type: 'entity' | 'entities';
  value: string;
  filterKind?: EntityKind;
  onChange: (value: string) => void;
}) {
  const entities = useLoom((s) => s.project.entities);
  const preferred = filterKind ? entities.filter((e) => e.kind === filterKind) : entities;
  const others = filterKind ? entities.filter((e) => e.kind !== filterKind) : [];

  if (type === 'entity') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">(未选)</option>
        {preferred.length > 0 && (
          <optgroup label={filterKind ? ENTITY_KIND_LABEL[filterKind] : '实体'}>
            {preferred.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="其他">
            {others.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </optgroup>
        )}
      </select>
    );
  }

  // entities:芯片 + 追加下拉
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  const remaining = entities.filter((e) => !ids.includes(e.id));
  const add = (id: string) => { if (id) onChange([...ids, id].join(',')); };
  const remove = (id: string) => onChange(ids.filter((x) => x !== id).join(','));

  return (
    <div className="ref-editor-multi">
      <div className="card-tags">
        {ids.map((id) => {
          const ent = entities.find((e) => e.id === id);
          return (
            <span key={id} className="tag">
              {ent?.name ?? '(已删除)'}
              <button className="chip-x" onClick={() => remove(id)} title="移除">×</button>
            </span>
          );
        })}
      </div>
      {remaining.length > 0 && (
        <select value="" onChange={(e) => { add(e.target.value); e.currentTarget.value = ''; }}>
          <option value="">＋ 添加实体</option>
          {(filterKind ? remaining.filter((e) => e.kind === filterKind) : remaining).map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

/** 实体引用值的只读显示(卡片正文里用) */
export function EntityRefChips({ ids, entities, onClick }: {
  ids: string[];
  entities: Entity[];
  onClick?: (id: string) => void;
}) {
  const go = useNav((s) => s.go);
  return (
    <>
      {ids.map((id) => {
        const ent = entities.find((e) => e.id === id);
        if (!ent) return null;
        return (
          <span
            key={id}
            className="tag clickable"
            onClick={(e) => { e.stopPropagation(); (onClick ?? ((eid) => go({ tab: 'entities', entityId: eid })))(id); }}
            title={`跳转到「${ent.name}」`}
          >
            {ent.name}
          </span>
        );
      })}
    </>
  );
}

export function fieldRefIds(value: string, type?: EntityFieldType): string[] {
  if (type === 'entity') return value ? [value] : [];
  if (type === 'entities') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
