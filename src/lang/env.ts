import type { Project } from '../types';
import { coerceScalar } from '../script';
import type { ScriptEnv, ValueType } from './check';

/** 从项目构建脚本静态环境:变量表类型 + 有技术名实体的字段类型 */
export function buildScriptEnv(p: Project): ScriptEnv {
  const vars: Record<string, ValueType> = {};
  for (const v of p.variables) {
    vars[v.name] = v.type;
  }
  const entities: Record<string, Record<string, ValueType>> = {};
  for (const e of p.entities) {
    if (!e.technicalName) continue;
    const props: Record<string, ValueType> = {};
    for (const f of e.fields) {
      if (!f.label) continue;
      if (f.type === 'entity') props[f.label] = 'string';
      else if (f.type === 'entities') continue;
      else props[f.label] = typeof coerceScalar(f.value) as ValueType;
    }
    entities[e.technicalName] = props;
  }
  return { vars, entities };
}
