import { useRef, useState } from 'react';
import { useLoom, uid } from '../store';
import { normalizeHex, parsePaletteJson } from '../util';
import { confirmDialog } from '../dialog';
import type { ColorPalette } from '../types';
import { PALETTE } from '../types';
import Icon from './Icon';
import { useEscape } from '../hooks/useEscape';
import Q from './Q';

/**
 * 配色表管理:创建 / 编辑 / 导入 JSON / 激活 / 删除。
 * 从工具菜单打开;激活后,所有 ColorPicker 就用它的颜色。
 */
export default function PaletteManager({ onClose }: { onClose: () => void }) {
  useEscape(true, onClose);
  const project = useLoom((s) => s.project);
  const { addPalette, updatePalette, removePalette, setActivePalette } = useLoom();
  const palettes = project.palettes ?? [];
  const activeId = project.activePaletteId ?? null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [editingChip, setEditingChip] = useState<{ paletteId: string; index: number } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [importStatus, setImportStatus] = useState('');

  const createBlank = () => {
    const pal: ColorPalette = { id: uid(), name: `配色 ${palettes.length + 1}`, colors: ['#565550'] };
    addPalette(pal);
  };

  const duplicateDefault = () => {
    const pal: ColorPalette = { id: uid(), name: '默认灰阶副本', colors: [...PALETTE] };
    addPalette(pal);
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parsePaletteJson(text);
      if (parsed.length === 0) {
        setImportStatus("未识别到有效颜色。需要 hex 数组,或带 colors 字段的对象/数组");
        return;
      }
      let added = 0;
      for (const p of parsed) {
        addPalette({ id: uid(), name: p.name, colors: p.colors });
        added++;
      }
      setImportStatus(`已导入 ${added} 张配色`);
    } catch (e) {
      setImportStatus(`导入失败:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const patchColor = (paletteId: string, index: number, hexOrRaw: string) => {
    const hex = normalizeHex(hexOrRaw);
    if (!hex) return;
    const pal = palettes.find((x) => x.id === paletteId);
    if (!pal) return;
    const next = [...pal.colors];
    next[index] = hex;
    updatePalette(paletteId, { colors: next });
  };
  const removeColor = (paletteId: string, index: number) => {
    const pal = palettes.find((x) => x.id === paletteId);
    if (!pal) return;
    const next = pal.colors.filter((_, i) => i !== index);
    if (next.length === 0) return; // 至少留一个
    updatePalette(paletteId, { colors: next });
    setEditingChip(null);
  };
  const addColor = (paletteId: string) => {
    const pal = palettes.find((x) => x.id === paletteId);
    if (!pal) return;
    const next = [...pal.colors, '#565550'];
    updatePalette(paletteId, { colors: next });
    setEditingChip({ paletteId, index: next.length - 1 });
    setEditingValue('#565550');
  };

  const beginEditChip = (paletteId: string, index: number, current: string) => {
    setEditingChip({ paletteId, index });
    setEditingValue(current);
  };
  const commitEditChip = () => {
    if (!editingChip) return;
    patchColor(editingChip.paletteId, editingChip.index, editingValue);
    setEditingChip(null);
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
        <div className="sync-head">
          <Icon name="palette" size={14} />
          <span>配色表</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="field">
            <label>当前激活</label>
            <div className={`palette-item ${activeId === null ? 'active' : ''}`}>
              <div className="palette-item-name">默认灰阶(内置)</div>
              <div className="palette-item-strip">
                {PALETTE.map((c) => <span key={c} className="chip" style={{ background: c }} title={c} />)}
              </div>
              <div className="palette-item-actions">
                {activeId === null ? (
                  <span className="hint" style={{ fontSize: 11 }}><Icon name="check" size={12} /> 使用中</span>
                ) : (
                  <button className="ghost" onClick={() => setActivePalette(null)}>激活</button>
                )}
              </div>
            </div>
          </div>

          <div className="field">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ margin: 0, flex: 1 }}>项目配色表</label>
              <button className="ghost" onClick={createBlank}>＋ 新建</button>
              <button className="ghost" onClick={duplicateDefault} title="复制默认灰阶后再改">复制默认</button>
              <button className="ghost" onClick={() => fileRef.current?.click()} title="导入配色 JSON:hex 数组、单张配色对象,或多张配色的数组">
                <Icon name="upload" size={12} /> 导入 JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.currentTarget.value = ''; }}
              />
            </div>
            {importStatus && <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>{importStatus}</div>}

            <div className="palette-list">
              {palettes.length === 0 && (
                <div className="empty-hint" style={{ padding: 16, textAlign: 'left' }}>
                  还没有自定义配色。可以<Q>新建</Q>手动调,或<Q>导入 JSON</Q>。<br /><br />
                  <span style={{ color: 'var(--text-faint)' }}>导入接受三种写法,hex 带不带 <code>#</code> 都行,三位简写会自动补全:</span>
                  <pre style={{
                    margin: '6px 0 0', padding: '8px 10px', fontSize: 11, lineHeight: 1.6,
                    background: 'var(--bg-panel)', border: '1px solid var(--border)',
                    borderRadius: 6, overflowX: 'auto', whiteSpace: 'pre',
                  }}>{`["#1b1b19", "#b3564a", "#2f5d2f"]

{"name": "雨夜", "colors": ["#1b1b19", "#565550"]}

[{"name": "雨夜", "colors": ["#1b1b19"]},
 {"name": "白日", "colors": ["#eceae6"]}]`}</pre>
                </div>
              )}
              {palettes.map((pal) => (
                <div key={pal.id}>
                  <div className={`palette-item ${activeId === pal.id ? 'active' : ''}`}>
                    <div className="palette-item-name">
                      <input value={pal.name} onChange={(e) => updatePalette(pal.id, { name: e.target.value })} />
                    </div>
                    <div className="palette-item-strip">
                      {pal.colors.map((c, i) => (
                        <button
                          key={i}
                          className={`chip ${editingChip?.paletteId === pal.id && editingChip.index === i ? 'editing' : ''}`}
                          style={{ background: c }}
                          title={`${c}(点击编辑)`}
                          onClick={() => beginEditChip(pal.id, i, c)}
                        />
                      ))}
                      <button className="chip" style={{ background: 'transparent', color: 'var(--text-dim)' }} title="追加颜色" onClick={() => addColor(pal.id)}>＋</button>
                    </div>
                    <div className="palette-item-actions">
                      {activeId === pal.id ? (
                        <span className="hint" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={12} /> 使用中</span>
                      ) : (
                        <button className="ghost" onClick={() => setActivePalette(pal.id)}>激活</button>
                      )}
                      <button
                        className="ghost icon-btn"
                        title="删除该配色表"
                        onClick={async () => { if (await confirmDialog({ message: `删除配色表「${pal.name}」?`, danger: true, confirmText: '删除' })) removePalette(pal.id); }}
                      ><Icon name="trash" size={13} /></button>
                    </div>
                  </div>
                  {editingChip?.paletteId === pal.id && (
                    <div className="palette-color-editor">
                      <input
                        type="color"
                        value={normalizeHex(editingValue) ?? '#565550'}
                        onChange={(e) => setEditingValue(e.target.value)}
                        style={{ width: 32, height: 28, padding: 0, border: 0 }}
                      />
                      <input
                        type="text"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitEditChip(); if (e.key === 'Escape') setEditingChip(null); }}
                        placeholder="#hex"
                      />
                      <button className="primary" onClick={commitEditChip} disabled={!normalizeHex(editingValue)}>保存</button>
                      <button className="ghost" onClick={() => removeColor(pal.id, editingChip.index)} disabled={pal.colors.length <= 1} title={pal.colors.length <= 1 ? '至少保留一个颜色' : '删除该颜色'}>
                        <Icon name="trash" size={12} />
                      </button>
                      <button className="ghost" onClick={() => setEditingChip(null)}>取消</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="player-tip" style={{ marginTop: 4 }}>
            配色表随项目保存(JSON 备份、云同步、桌面文件夹都跟着走)。<br />
            激活后,所有节点/实体/时间线/地图/大纲/卡片的取色器都会用它;每个颜色还能点<Q>＋</Q>按需选自定义色。
          </div>
        </div>
      </div>
    </div>
  );
}
