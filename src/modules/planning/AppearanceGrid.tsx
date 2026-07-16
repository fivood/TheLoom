import { useMemo, useState } from 'react';
import { useLoom } from '../../store';
import { useNav } from '../../search';
import { appearanceMatrix } from '../../planning';

export default function AppearanceGrid() {
  const project = useLoom((s) => s.project);
  const go = useNav((s) => s.go);
  const [picked, setPicked] = useState<{ row: number; col: number } | null>(null);

  const matrix = useMemo(() => appearanceMatrix(project), [project]);
  const maxScenes = Math.max(1, ...matrix.rows.flatMap((r) => r.cells.map((c) => c.scenes)));

  if (matrix.rows.length === 0 || matrix.chapters.length === 0) {
    return (
      <div className="empty-hint" style={{ margin: 'auto' }}>
        需要至少一个角色实体和一个场景文档。统计口径:说话 / 担任 POV / 正文提及角色名
      </div>
    );
  }

  const pickedRow = picked ? matrix.rows[picked.row] : null;
  const pickedCell = picked && pickedRow ? pickedRow.cells[picked.col] : null;
  const pickedChapter = picked ? matrix.chapters[picked.col] : null;

  return (
    <div className="pad-wrap" style={{ overflow: 'auto' }}>
      <div className="hint" style={{ marginBottom: 8 }}>
        每格 = 该角色在该章登场的场景数(说话 / POV / 提及任一即算);● = 担任 POV,★ = 有弧线阶段落在本章。点击格子看明细
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="appear-table">
          <thead>
            <tr>
              <th className="appear-name-col">角色</th>
              {matrix.chapters.map((ch) => (
                <th key={ch.key || 'none'} title={ch.label}>
                  <span className="appear-ch-label">{ch.label}</span>
                </th>
              ))}
              <th>合计</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row, ri) => (
              <tr key={row.entity.id}>
                <td className="appear-name-col">
                  <button className="appear-name" onClick={() => go({ tab: 'entities', entityId: row.entity.id })}>
                    {row.entity.name}
                  </button>
                </td>
                {row.cells.map((cell, ci) => {
                  const active = picked?.row === ri && picked?.col === ci;
                  const depth = cell.scenes / maxScenes;
                  const tipParts = [
                    `${row.entity.name} · ${matrix.chapters[ci].label}`,
                    `登场 ${cell.scenes} 场 / 说话 ${cell.lines} 句 / 提及 ${cell.mentions} 处`,
                  ];
                  if (cell.pov > 0) tipParts.push(`POV ${cell.pov} 场`);
                  if (cell.stages.length > 0) tipParts.push(`弧线:${cell.stages.map((s) => s.title || '(未命名)').join('、')}`);
                  return (
                    <td key={ci}>
                      <button
                        className={`appear-cell ${active ? 'active' : ''}`}
                        style={cell.scenes > 0 ? {
                          background: `rgba(27, 27, 25, ${0.06 + depth * 0.5})`,
                          color: depth > 0.55 ? '#f5f4ef' : undefined,
                        } : undefined}
                        title={tipParts.join('\n')}
                        onClick={() => setPicked(active ? null : { row: ri, col: ci })}
                      >
                        {cell.scenes > 0 ? cell.scenes : ''}
                        {cell.pov > 0 && <span className="appear-pov">●</span>}
                        {cell.stages.length > 0 && <span className="appear-stage">★</span>}
                      </button>
                    </td>
                  );
                })}
                <td className="appear-total">{row.totalScenes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pickedRow && pickedCell && pickedChapter && (
        <div className="appear-detail">
          <div className="appear-detail-head">
            <strong>{pickedRow.entity.name}</strong> · {pickedChapter.label}
            <span className="hint">说话 {pickedCell.lines} 句 · 提及 {pickedCell.mentions} 处 · POV {pickedCell.pov} 场</span>
            <button className="ghost icon-btn" style={{ marginLeft: 'auto' }} onClick={() => setPicked(null)}>×</button>
          </div>
          {pickedCell.stages.length > 0 && (
            <div className="appear-detail-stages">
              {pickedCell.stages.map((s) => (
                <span key={s.id} className="fs-ref-chip">★ {s.title || '(未命名阶段)'}</span>
              ))}
            </div>
          )}
          <div className="appear-detail-scenes">
            {pickedCell.docs.map((d) => (
              <button key={d.id} className="fs-ref-chip fs-ref-open" onClick={() => go({ tab: 'documents', docId: d.id })}>
                {d.name} →
              </button>
            ))}
            {pickedCell.docs.length === 0 && <span className="hint">本章无登场场景</span>}
          </div>
        </div>
      )}
    </div>
  );
}
