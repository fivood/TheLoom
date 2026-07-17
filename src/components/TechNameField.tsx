import { useRef } from 'react';
import { sanitizeTechnicalName, validateTechnicalName } from '../util';

/** 技术名输入字段:输入 + 自动生成 + 格式校验,复用于实体/资源/文档/流程 inspector */
export default function TechNameField({ value, onChange, displayName, onRenamed }: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  displayName: string;
  /** 编辑结束(blur / 自动生成)且新旧都非空时回调,用于脚本重命名联动 */
  onRenamed?: (oldValue: string, newValue: string) => void;
}) {
  const error = value ? validateTechnicalName(value) : null;
  const focusValue = useRef<string | undefined>(undefined);
  const fireRenamed = (oldV: string | undefined, newV: string | undefined) => {
    if (onRenamed && oldV && newV && oldV !== newV && !validateTechnicalName(newV)) {
      onRenamed(oldV, newV);
    }
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
          onBlur={() => { fireRenamed(focusValue.current, value); focusValue.current = undefined; }}
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
              fireRenamed(value, gen);
              onChange(gen);
            }
          }}
        >自动</button>
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 2 }}>{error}</div>}
    </div>
  );
}
