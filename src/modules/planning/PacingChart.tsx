import { useMemo, useState } from 'react';
import { useLoom } from '../../store';
import { useNav } from '../../search';
import { pacingPoints } from '../../planning';
import type { DocStatus } from '../../types';
import { DOC_STATUS_LABEL, DOC_STATUS_ORDER } from '../../types';

/** 状态 → 灰阶(弱 → 强 = 大纲 → 完成,单色顺序标度;深浅色各一套令牌) */
const STATUS_BAR: Record<DocStatus, string> = {
  outline: 'var(--pace-outline)',
  draft: 'var(--pace-draft)',
  revising: 'var(--pace-revising)',
  done: 'var(--pace-done)',
};
const UNSET_BAR = 'var(--pace-unset)';

const MARGIN_L = 48;
const MARGIN_R = 16;
const PLOT_H = 180;
const TENSION_H = 56;
const GAP_TRACKS = 26;
const TOP = 18;
const BOTTOM = 26;
const BAR_W = 12;
const STEP = 18;
const CHAPTER_GAP = 14;

/** 顶部圆角(4px)、底边贴基线的柱形 */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  const bottom = y + h;
  return `M ${x} ${bottom} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${bottom} Z`;
}

export default function PacingChart() {
  const project = useLoom((s) => s.project);
  const updateDocument = useLoom((s) => s.updateDocument);
  const go = useNav((s) => s.go);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const points = useMemo(() => pacingPoints(project), [project]);

  if (points.length === 0) {
    return <div className="empty-hint" style={{ margin: 'auto' }}>还没有场景文档,无法绘制节奏图</div>;
  }

  const maxWords = Math.max(1, ...points.map((p) => p.words));
  const hasTension = points.some((p) => typeof p.tension === 'number');

  // X 坐标:章节起点(除第一章)前加间隔
  const xs: number[] = [];
  let cursor = MARGIN_L;
  points.forEach((p, i) => {
    if (p.chapterStart && i > 0) cursor += CHAPTER_GAP;
    xs.push(cursor);
    cursor += STEP;
  });
  const width = cursor + MARGIN_R;
  const height = TOP + PLOT_H + GAP_TRACKS + TENSION_H + BOTTOM;
  const wordsY = (w: number) => TOP + PLOT_H - (w / maxWords) * PLOT_H;
  const tensionTop = TOP + PLOT_H + GAP_TRACKS;
  const tensionY = (t: number) => tensionTop + TENSION_H - ((t - 1) / 4) * TENSION_H;

  // 张力折线:相邻两个都设了张力的场景之间连线
  const tensionSegs: string[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (typeof a.tension === 'number' && typeof b.tension === 'number') {
      tensionSegs.push(`M ${xs[i - 1] + BAR_W / 2} ${tensionY(a.tension)} L ${xs[i] + BAR_W / 2} ${tensionY(b.tension)}`);
    }
  }

  const selected = selectedId ? points.find((p) => p.doc.id === selectedId) ?? null : null;
  const totalWords = points.reduce((s, p) => s + p.words, 0);

  return (
    <div className="pad-wrap" style={{ overflow: 'auto' }}>
      <div className="pacing-legend">
        <span className="hint">每根柱 = 一个场景的字数(树序);下方轨道 = 情节张力 1-5。点击柱子查看 / 设置</span>
        <span className="spacer" />
        {DOC_STATUS_ORDER.map((s) => (
          <span key={s} className="pacing-legend-item"><i style={{ background: STATUS_BAR[s] }} /> {DOC_STATUS_LABEL[s]}</span>
        ))}
        <span className="pacing-legend-item"><i style={{ background: UNSET_BAR, borderStyle: 'dashed' }} /> 未设状态</span>
      </div>

      <div className="pacing-scroll">
        <svg width={width} height={height} className="pacing-svg" role="img" aria-label="逐场景字数与张力节奏图">
          {/* 字数网格线(仅刻度,居于底层) */}
          {[1, 0.5].map((f) => (
            <g key={f}>
              <line x1={MARGIN_L - 4} x2={width - MARGIN_R} y1={wordsY(maxWords * f)} y2={wordsY(maxWords * f)} className="pacing-grid" />
              <text x={MARGIN_L - 8} y={wordsY(maxWords * f) + 4} className="pacing-axis" textAnchor="end">{Math.round(maxWords * f)}</text>
            </g>
          ))}
          <line x1={MARGIN_L - 4} x2={width - MARGIN_R} y1={TOP + PLOT_H} y2={TOP + PLOT_H} className="pacing-baseline" />

          {/* 章节分隔与标签(标签按到下一章为止的可用宽度截断,避免互相重叠) */}
          {points.map((p, i) => {
            if (!p.chapterStart) return null;
            const next = points.findIndex((q, j) => j > i && q.chapterStart);
            const endX = next < 0 ? width - MARGIN_R : xs[next] - CHAPTER_GAP;
            const available = endX - xs[i];
            const maxChars = Math.max(0, Math.floor(available / 11));
            const text = p.chapterLabel.length > maxChars
              ? (maxChars <= 1 ? '' : `${p.chapterLabel.slice(0, maxChars - 1)}…`)
              : p.chapterLabel;
            return (
              <g key={`ch-${i}`}>
                {i > 0 && <line x1={xs[i] - CHAPTER_GAP / 2 - 3} x2={xs[i] - CHAPTER_GAP / 2 - 3} y1={TOP - 6} y2={tensionTop + TENSION_H} className="pacing-chapter-sep" />}
                {text && (
                  <text x={xs[i]} y={height - 8} className="pacing-chapter-label">
                    {text}
                    <title>{p.chapterLabel}</title>
                  </text>
                )}
              </g>
            );
          })}

          {/* 字数柱 */}
          {points.map((p, i) => {
            const h = Math.max(2, (p.words / maxWords) * PLOT_H);
            const y = TOP + PLOT_H - h;
            const fill = p.status ? STATUS_BAR[p.status] : UNSET_BAR;
            const active = p.doc.id === selectedId;
            return (
              <g key={p.doc.id} onClick={() => setSelectedId(active ? null : p.doc.id)} style={{ cursor: 'pointer' }}>
                {/* 命中区比柱子宽,方便点击 */}
                <rect x={xs[i] - 3} y={TOP} width={BAR_W + 6} height={PLOT_H + GAP_TRACKS + TENSION_H} fill="transparent" />
                <path d={barPath(xs[i], y, BAR_W, h)} fill={fill} stroke={active ? 'var(--focus)' : 'none'} strokeWidth={active ? 2 : 0} strokeDasharray={!p.status && !active ? '3 2' : undefined} />
                <title>{`${p.chapterLabel} · ${p.doc.name}\n${p.words} 字${p.status ? ` · ${DOC_STATUS_LABEL[p.status]}` : ''}${typeof p.tension === 'number' ? ` · 张力 ${p.tension}` : ''}`}</title>
              </g>
            );
          })}

          {/* 张力轨道 */}
          <text x={MARGIN_L - 8} y={tensionY(5) + 4} className="pacing-axis" textAnchor="end">5</text>
          <text x={MARGIN_L - 8} y={tensionY(1) + 4} className="pacing-axis" textAnchor="end">1</text>
          <line x1={MARGIN_L - 4} x2={width - MARGIN_R} y1={tensionY(1)} y2={tensionY(1)} className="pacing-grid" />
          {tensionSegs.map((d, i) => <path key={i} d={d} className="pacing-tension-line" />)}
          {points.map((p, i) => typeof p.tension === 'number' ? (
            <circle
              key={p.doc.id}
              cx={xs[i] + BAR_W / 2}
              cy={tensionY(p.tension)}
              r={4}
              className={`pacing-tension-dot ${p.doc.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(p.doc.id === selectedId ? null : p.doc.id)}
            >
              <title>{`${p.doc.name} · 张力 ${p.tension}`}</title>
            </circle>
          ) : null)}
          {!hasTension && (
            <text x={MARGIN_L + 6} y={tensionTop + TENSION_H / 2} className="pacing-axis">尚未设置任何场景的张力 —— 点击柱子即可设置</text>
          )}
        </svg>
      </div>

      <div className="hint" style={{ marginTop: 6 }}>共 {points.length} 场 · {totalWords} 字</div>

      {selected && (
        <div className="appear-detail">
          <div className="appear-detail-head">
            <strong>{selected.doc.name}</strong>
            <span className="hint">{selected.chapterLabel} · {selected.words} 字{selected.status ? ` · ${DOC_STATUS_LABEL[selected.status]}` : ''}</span>
            <button className="ghost icon-btn" style={{ marginLeft: 'auto' }} onClick={() => setSelectedId(null)}>×</button>
          </div>
          <div className="pacing-detail-row">
            <label>情节张力</label>
            <select
              value={selected.tension ?? ''}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : undefined;
                updateDocument(selected.doc.id, (d) => { d.tension = v; });
              }}
            >
              <option value="">(未设置)</option>
              {[1, 2, 3, 4, 5].map((t) => <option key={t} value={t}>{t}{t === 1 ? '(平缓)' : t === 5 ? '(高潮)' : ''}</option>)}
            </select>
            <button className="ghost" onClick={() => go({ tab: 'documents', docId: selected.doc.id })}>打开场景 →</button>
          </div>
        </div>
      )}
    </div>
  );
}
