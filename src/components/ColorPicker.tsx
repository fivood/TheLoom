import { useRef } from 'react';
import { useLoom } from '../store';
import { activePaletteColors, normalizeHex } from '../util';

/**
 * 项目激活配色表 + 原生取色器的通用色板。
 * 替换所有 `.color-row + PALETTE.map` 的旧写法。
 * allowClear=true 时,再点当前色可清除(还原为默认色)。
 */
export default function ColorPicker({ value, onChange, allowClear = true, allowCustom = true }: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allowClear?: boolean;
  allowCustom?: boolean;
}) {
  const project = useLoom((s) => s.project);
  const colors = activePaletteColors(project);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (c: string) => {
    if (allowClear && value === c) onChange(undefined);
    else onChange(c);
  };

  const openCustom = () => inputRef.current?.click();
  const onCustom = (v: string) => {
    const hex = normalizeHex(v);
    if (hex) onChange(hex);
  };

  const inPalette = value && colors.includes(value);

  return (
    <div className="color-row">
      {colors.map((c) => (
        <button
          key={c}
          className={`color-swatch ${value === c ? 'selected' : ''}`}
          style={{ background: c }}
          onClick={() => pick(c)}
          title={c}
        />
      ))}
      {allowCustom && (
        <>
          <button
            type="button"
            className={`color-swatch color-swatch-custom ${value && !inPalette ? 'selected' : ''}`}
            style={value && !inPalette ? { background: value } : undefined}
            onClick={openCustom}
            title={value && !inPalette ? `自定义色 ${value}(点击更换)` : '自定义色(HEX)'}
          >
            {!(value && !inPalette) && <span aria-hidden>＋</span>}
          </button>
          <input
            ref={inputRef}
            type="color"
            style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
            value={value && normalizeHex(value) ? normalizeHex(value)! : '#565550'}
            onChange={(e) => onCustom(e.target.value)}
          />
        </>
      )}
    </div>
  );
}
