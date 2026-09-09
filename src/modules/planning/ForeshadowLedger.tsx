import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { confirmDialog } from '../../dialog';
import { useNav } from '../../search';
import { foreshadowRefLabel, foreshadowStatus, groupDocsByChapter } from '../../planning';
import type { Foreshadow, ForeshadowKind, ForeshadowStatus } from '../../types';
import { FORESHADOW_ANCHOR_LABEL, FORESHADOW_KIND_LABEL, foreshadowStatusLabel } from '../../types';
import Icon from '../../components/Icon';
import Q from '../../components/Q';

const STATUS_ORDER: ForeshadowStatus[] = ['idea', 'planted', 'resolved', 'unplanted', 'abandoned'];

/** 缺省 kind 的旧条目按伏笔算 */
const kindOf = (f: Foreshadow): ForeshadowKind => (f.kind === 'doubt' ? 'doubt' : 'setup');

export default function ForeshadowLedger({ focusId, onConsumeFocus }: {
  focusId: string | null;
  onConsumeFocus: () => void;
}) {
  const project = useLoom((s) => s.project);
  const { addForeshadow, updateForeshadow, removeForeshadow } = useLoom();
  const go = useNav((s) => s.go);
  const [filter, setFilter] = useState<ForeshadowStatus | 'all'>('all');
  /*
   * 伏笔与疑点共用一套结构,但措辞整套不同(埋设/回收 vs 提出/排除)。
   * 混在一张表里表头没法同时对两边,所以按类型分页 —— 切换的同时换掉全部措辞。
   */
  const [kind, setKind] = useState<ForeshadowKind>('setup');
  const anchor = FORESHADOW_ANCHOR_LABEL[kind];
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!focusId) return;
    setFilter('all');
    // 从别处跳进来的条目可能是另一类,先切到它所在的页,否则只看到一张空表
    const target = (project.foreshadows ?? []).find((f) => f.id === focusId);
    if (target) setKind(kindOf(target));
    setHighlightId(focusId);
    onConsumeFocus();
  }, [focusId]);
  useEffect(() => {
    if (highlightId) highlightRef.current?.scrollIntoView({ block: 'center' });
  }, [highlightId]);

  const all = project.foreshadows ?? [];
  const foreshadows = useMemo(() => all.filter((f) => kindOf(f) === kind), [all, kind]);
  const otherCount = all.length - foreshadows.length;
  const chapters = useMemo(
    () => groupDocsByChapter(project.documents, project.folders),
    [project.documents, project.folders],
  );
  const outlineRows = project.outlineRows;

  const counts = useMemo(() => {
    const c: Record<ForeshadowStatus, number> = { idea: 0, planted: 0, resolved: 0, unplanted: 0, abandoned: 0 };
    for (const f of foreshadows) c[foreshadowStatus(f)] += 1;
    return c;
  }, [foreshadows]);

  const shown = filter === 'all' ? foreshadows : foreshadows.filter((f) => foreshadowStatus(f) === filter);

  const refCell = (f: Foreshadow, field: 'plants' | 'payoffs') => (
    <div className="fs-refs">
      {f[field].map((ref) => (
        <span key={ref.id} className="fs-ref-chip" title={ref.note || (ref.rowId ? '点击打开大纲' : '点击打开场景')}>
          <button
            className="fs-ref-open"
            onClick={() => (ref.rowId
              ? go({ tab: 'outline', outlineRowId: ref.rowId })
              : go({ tab: 'documents', docId: ref.docId }))}
          >{foreshadowRefLabel(project, ref)}</button>
          <button
            className="chip-x"
            title="移除"
            onClick={() => updateForeshadow(f.id, (x) => { x[field] = x[field].filter((r) => r.id !== ref.id); })}
          >×</button>
        </span>
      ))}
      <select
        className="fs-ref-add"
        value=""
        onChange={(e) => {
          // 值带前缀区分两类锚点 —— 场景 id 与大纲行 id 都是 uid,光看值分不出来
          const [type, id] = e.target.value.split(':');
          if (!id) return;
          updateForeshadow(f.id, (x) => {
            x[field].push(type === 'row' ? { id: uid(), rowId: id } : { id: uid(), docId: id });
          });
        }}
      >
        <option value="">＋ {field === 'plants' ? anchor.plant : anchor.payoff}于…</option>
        {/*
          * 大纲行排在场景前面:疑点与倒着规划的伏笔都是构思阶段列的,
          * 那时候一个场景都还没写,能挂的只有计划中的章节
          */}
        {outlineRows.length > 0 && (
          <optgroup label="大纲(计划中的章节)">
            {outlineRows.map((r) => (
              <option key={r.id} value={`row:${r.id}`}>
                {[r.no, r.title].map((x) => (x ?? '').trim()).filter(Boolean).join(' · ') || '(未命名章节)'}
              </option>
            ))}
          </optgroup>
        )}
        {chapters.map((ch) => (
          <optgroup key={ch.key || 'none'} label={ch.label ? `场景 · ${ch.label}` : '场景'}>
            {ch.docs.map((d) => <option key={d.id} value={`doc:${d.id}`}>{d.name}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );

  return (
    <div className="pad-wrap" style={{ overflow: 'auto' }}>
      <div className="fs-toolbar">
        {(['setup', 'doubt'] as ForeshadowKind[]).map((k) => (
          <button
            key={k}
            className={`fs-kind ${kind === k ? 'on' : ''}`}
            onClick={() => { setKind(k); setFilter('all'); }}
          >{FORESHADOW_KIND_LABEL[k]} {k === kind ? foreshadows.length : otherCount}</button>
        ))}
        <span className="tool-sep" aria-hidden="true" />
        <button
          className="primary"
          onClick={() => addForeshadow({
            id: uid(), title: '', note: '',
            ...(kind === 'doubt' ? { kind: 'doubt' as const } : {}),
            plants: [], payoffs: [], createdAt: Date.now(),
          })}
        >＋ 新{FORESHADOW_KIND_LABEL[kind]}</button>
        <button className={`fs-filter ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          全部 {foreshadows.length}
        </button>
        {STATUS_ORDER.map((s) => (
          <button key={s} className={`fs-filter fs-filter-${s} ${filter === s ? 'on' : ''}`} onClick={() => setFilter(s)}>
            {foreshadowStatusLabel(kind, s)} {counts[s]}
          </button>
        ))}
        {counts.planted > 0 && (
          <span className="hint">
            <Icon name="warn" size={11} />
            {kind === 'doubt'
              ? ` 还有 ${counts.planted} 条不合理没排除`
              : ` 有 ${counts.planted} 条伏笔埋了还没回收`}
          </span>
        )}
      </div>

      <table className="fs-table">
        <thead>
          <tr>
            <th style={{ width: 180 }}>{FORESHADOW_KIND_LABEL[kind]}</th>
            <th>备注</th>
            <th style={{ width: 230 }}>{anchor.plant}</th>
            <th style={{ width: 230 }}>{anchor.payoff}</th>
            <th style={{ width: 78 }}>状态</th>
            <th style={{ width: 70 }}></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((f) => {
            const status = foreshadowStatus(f);
            return (
              <tr key={f.id} ref={f.id === highlightId ? highlightRef : undefined} className={f.id === highlightId ? 'fs-highlight' : undefined}>
                <td>
                  <input
                    value={f.title}
                    placeholder={kind === 'doubt' ? '如:门是从里面插上的' : '如:抽屉里的旧车票'}
                    onChange={(e) => updateForeshadow(f.id, (x) => { x.title = e.target.value; })}
                  />
                </td>
                <td>
                  <input
                    value={f.note}
                    placeholder={kind === 'doubt' ? '为什么不合理?靠什么排除?' : '它指向什么?打算何时揭晓?'}
                    onChange={(e) => updateForeshadow(f.id, (x) => { x.note = e.target.value; })}
                  />
                </td>
                <td>{refCell(f, 'plants')}</td>
                <td>{refCell(f, 'payoffs')}</td>
                <td><span className={`fs-status fs-status-${status}`}>{foreshadowStatusLabel(kind, status)}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className="ghost icon-btn"
                    title={f.abandoned ? '恢复追踪' : (kind === 'doubt' ? '搁置(暂不处理这条)' : '标记弃用(不再打算回收)')}
                    onClick={() => updateForeshadow(f.id, (x) => { x.abandoned = !x.abandoned || undefined; })}
                  >{f.abandoned ? '↺' : '弃'}</button>
                  <button
                    className="ghost icon-btn"
                    title="删除"
                    onClick={async () => {
                      if (await confirmDialog({ message: `删除${FORESHADOW_KIND_LABEL[kind]}「${f.title || '(未命名)'}」?`, danger: true, confirmText: '删除' })) {
                        removeForeshadow(f.id);
                      }
                    }}
                  >×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.length === 0 && (
        <div className="empty-hint" style={{ padding: 24 }}>
          {foreshadows.length > 0
            ? `这个状态下没有${FORESHADOW_KIND_LABEL[kind]}`
            : kind === 'doubt'
              ? <>还没有疑点。把<Q>读者会觉得说不通的地方</Q>逐条记在这里,提出与排除都关联到场景 —— 排完才是真相</>
              : <>还没有伏笔。把<Q>将来要兑现的暗示</Q>记在这里,埋设与回收都关联到场景</>}
        </div>
      )}
    </div>
  );
}
