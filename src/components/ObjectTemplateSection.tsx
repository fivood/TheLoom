import { useLoom } from '../store';
import { specsForObject } from '../templates';
import type { EntityField } from '../types';
import FieldListEditor from './FieldListEditor';

/** R11:资源 / 文档 / 地图 inspector 共用的「模板 + 自定义字段」区 */
export default function ObjectTemplateSection({ module, object, onFieldsChange }: {
  module: 'asset' | 'document' | 'map';
  object: { id: string; templateId?: string; fields?: EntityField[] };
  onFieldsChange: (fields: EntityField[]) => void;
}) {
  const project = useLoom((s) => s.project);
  const assign = useLoom((s) => s.assignObjectTemplate);
  const options = (project.templates ?? []).filter((t) => t.module === module);
  return (
    <>
      {options.length > 0 && (
        <div className="field">
          <label>模板</label>
          <select
            value={object.templateId ?? ''}
            onChange={(e) => assign(module, object.id, e.target.value || undefined)}
          >
            <option value="">(不套用模板)</option>
            {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <FieldListEditor
        fields={object.fields ?? []}
        specs={specsForObject(project, object)}
        onChange={onFieldsChange}
      />
    </>
  );
}
