import { sanitizeTechnicalName, validateTechnicalName } from '../util';

/** 技术名输入字段:输入 + 自动生成 + 格式校验,复用于实体/资源/文档/流程 inspector */
export default function TechNameField({ value, onChange, displayName }: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  displayName: string;
}) {
  const error = value ? validateTechnicalName(value) : null;
  return (
    <div className="field">
      <label>
        技术名 <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>可选 · 脚本寻址与导出用</span>
      </label>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder="如 semelvie"
          style={{ flex: 1, fontFamily: 'Consolas, monospace', fontSize: 12 }}
        />
        <button
          className="ghost"
          type="button"
          title="从显示名自动生成"
          onClick={() => {
            const gen = sanitizeTechnicalName(displayName);
            if (gen) onChange(gen);
          }}
        >自动</button>
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 2 }}>{error}</div>}
    </div>
  );
}
