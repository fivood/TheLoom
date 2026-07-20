import { useRef } from 'react';
import { sanitizeTechnicalName, validateTechnicalName } from '../util';

/** 技术名输入字段:输入 + 自动生成 + 格式校验,复用于实体/资源/文档/流程 inspector */
export default function TechNameField({ value, onChange, displayName, onRename }: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  displayName: string;
  /** R6 重命名联动:编辑结束(失焦)且新旧都有效时回调,由调用方改写全项目脚本引用 */
  onRename?: (oldName: string, newName: string) => void;
}) {
  const error = value ? validateTechnicalName(value) : null;
  const focusValue = useRef<string | undefined>(undefined);
  const commitRename = (next: string | undefined) => {
    const old = focusValue.current;
    focusValue.current = next;
    if (!onRename || !old || !next || old === next) return;
    if (validateTechnicalName(old) || validateTechnicalName(next)) return;
    onRename(old, next);
  };
  return (
    <div className="field">
      <label>
        技术名 <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>可选 · 脚本寻址与导出用</span>
      </label>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          onFocus={() => { focusValue.current = value; }}
          onBlur={() => commitRename(value)}
          placeholder="如 semelvie"
          style={{ flex: 1, fontFamily: 'Consolas, monospace', fontSize: 12 }}
        />
        <button
          className="ghost"
          type="button"
          title="从显示名自动生成"
          onClick={() => {
            const gen = sanitizeTechnicalName(displayName);
            if (gen) {
              const old = value;
              onChange(gen);
              if (onRename && old && old !== gen && !validateTechnicalName(old)) onRename(old, gen);
            }
          }}
        >自动</button>
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 2 }}>{error}</div>}
      {onRename && <div className="hint" style={{ fontSize: 10 }}>改名后,全项目脚本里的引用会自动跟着改</div>}
    </div>
  );
}
