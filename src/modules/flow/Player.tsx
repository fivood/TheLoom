import { useEffect, useMemo, useRef, useState } from 'react';
import { useLoom } from '../../store';
import { resolveSub } from '../../util';
import type { Entity, Flow, FlowEdge, FlowNode, SubFlow } from '../../types';
import { FLOW_NODE_LABEL } from '../../types';
import { TYPE_COLORS } from './nodes';

type VarValue = boolean | number | string;

interface Beat {
  id: string;
  kind: string;
  title: string;
  text: string;
  speaker?: Entity;
  note?: string;
}

interface Choice {
  label: string;
  nodeId: string | null; // null = 结束
  viaExit?: boolean;
}

function coerceVar(type: string, value: string): VarValue {
  if (type === 'boolean') return value === 'true';
  if (type === 'number') return Number(value) || 0;
  return value;
}

function evalCondition(expr: string, vars: Record<string, VarValue>): boolean | null {
  if (!expr.trim()) return null;
  try {
    const names = Object.keys(vars);
    const fn = new Function(...names, `"use strict"; return (${expr});`);
    return Boolean(fn(...names.map((n) => vars[n])));
  } catch {
    return null;
  }
}

/** 解析并执行指令:`name = 值`、`name += 1` 等,分号或换行分隔 */
function applyInstructions(text: string, vars: Record<string, VarValue>): string[] {
  const warnings: string[] = [];
  for (const raw of text.split(/[;\n]/)) {
    const stmt = raw.trim();
    if (!stmt) continue;
    const m = stmt.match(/^([A-Za-z_]\w*)\s*(=|\+=|-=|\*=|\/=)\s*(.+)$/);
    if (!m) { warnings.push(`无法解析:${stmt}`); continue; }
    const [, name, op, rawVal] = m;
    let val: VarValue;
    const v = rawVal.trim();
    if (v === 'true' || v === 'false') val = v === 'true';
    else if (!Number.isNaN(Number(v))) val = Number(v);
    else if (/^(['"]).*\1$/.test(v)) val = v.slice(1, -1);
    else if (v in vars) val = vars[v];
    else { warnings.push(`未知的值:${stmt}`); continue; }

    if (op === '=') vars[name] = val;
    else {
      const cur = Number(vars[name]) || 0;
      const n = Number(val) || 0;
      vars[name] = op === '+=' ? cur + n : op === '-=' ? cur - n : op === '*=' ? cur * n : n === 0 ? cur : cur / n;
    }
  }
  return warnings;
}

function startNodes(sub: SubFlow): FlowNode[] {
  const hasIncoming = new Set(sub.edges.map((e) => e.target));
  const starts = sub.nodes.filter((n) => !hasIncoming.has(n.id));
  return starts.length > 0 ? starts : sub.nodes;
}

let beatSeq = 0;

export default function Player({ flow, path, startNodeId, onClose }: {
  flow: Flow;
  path: string[];
  startNodeId?: string;
  onClose: () => void;
}) {
  const project = useLoom((s) => s.project);
  const entities = project.entities;

  const [vars, setVars] = useState<Record<string, VarValue>>(() => {
    const v: Record<string, VarValue> = {};
    for (const x of project.variables) v[x.name] = coerceVar(x.type, x.value);
    return v;
  });
  const [log, setLog] = useState<Beat[]>([]);
  const [curPath, setCurPath] = useState<string[]>(path);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [ended, setEnded] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const container = (p: string[]): SubFlow => resolveSub(flow, p) ?? { nodes: [], edges: [] };

  const pushBeat = (b: Omit<Beat, 'id'>) => setLog((l) => [...l, { ...b, id: String(++beatSeq) }]);

  /** 节点的出边 → 选项列表;没有出边时向父级回溯 */
  const outgoingChoices = (p: string[], node: FlowNode, vv: Record<string, VarValue>): { choices: Choice[]; path: string[] } => {
    let curP = [...p];
    let cur: FlowNode | undefined = node;
    // 无出边时逐层弹出:从进入的片段节点继续
    for (let guard = 0; guard < 64; guard++) {
      const c = container(curP);
      const edges = cur ? c.edges.filter((e) => e.source === cur!.id) : [];
      const usable = cur?.type === 'condition' ? filterCondEdges(edges, cur, vv) : edges;
      if (usable.length > 0) {
        return {
          path: curP,
          choices: usable.map((e) => {
            const target = c.nodes.find((n) => n.id === e.target);
            return {
              label: (typeof e.label === 'string' && e.label) || target?.data.title || (target ? FLOW_NODE_LABEL[target.type] : '继续'),
              nodeId: e.target,
            };
          }),
        };
      }
      if (curP.length === 0) return { path: curP, choices: [] };
      const fragId = curP[curP.length - 1];
      curP = curP.slice(0, -1);
      cur = container(curP).nodes.find((n) => n.id === fragId);
    }
    return { path: curP, choices: [] };
  };

  const filterCondEdges = (edges: FlowEdge[], node: FlowNode, vv: Record<string, VarValue>): FlowEdge[] => {
    const result = evalCondition(node.data.text, vv);
    if (result === null) return edges; // 无法求值 → 手动选择
    const want = result ? 'true' : 'false';
    const picked = edges.filter((e) => e.sourceHandle === want);
    return picked.length > 0 ? picked : [];
  };

  /** 进入并展示一个节点,自动处理直通型节点 */
  const visit = (p: string[], nodeId: string, vv: Record<string, VarValue>) => {
    let curP = [...p];
    let id: string | null = nodeId;
    const nextVars = { ...vv };

    for (let guard = 0; guard < 100 && id; guard++) {
      const c = container(curP);
      const node = c.nodes.find((n) => n.id === id);
      if (!node) break;

      const speaker = entities.find((e) => e.id === node.data.speakerId);

      switch (node.type) {
        case 'dialogue':
          pushBeat({ kind: 'dialogue', title: node.data.title, text: node.data.text, speaker });
          break;
        case 'fragment': {
          pushBeat({ kind: 'fragment', title: node.data.title || '剧情片段', text: node.data.text });
          const sub = node.data.sub;
          if (sub && sub.nodes.length > 0) {
            // 钻入子流程
            curP = [...curP, node.id];
            const starts = startNodes(sub);
            if (starts.length === 1) { id = starts[0].id; continue; }
            setCurPath(curP);
            setVars(nextVars);
            setChoices(starts.map((s) => ({ label: s.data.title || FLOW_NODE_LABEL[s.type], nodeId: s.id })));
            return;
          }
          break;
        }
        case 'hub':
          if (node.data.title) pushBeat({ kind: 'hub', title: node.data.title, text: '' });
          break;
        case 'instruction': {
          const warnings = applyInstructions(node.data.text, nextVars);
          pushBeat({
            kind: 'instruction', title: node.data.title || '指令', text: node.data.text,
            note: warnings.length ? warnings.join(';') : undefined,
          });
          break;
        }
        case 'condition': {
          const result = evalCondition(node.data.text, nextVars);
          pushBeat({
            kind: 'condition', title: node.data.title || '条件分支', text: node.data.text,
            note: result === null ? '无法求值,请手动选择分支' : result ? '→ 真' : '→ 假',
          });
          break;
        }
        case 'jump':
          pushBeat({ kind: 'jump', title: node.data.title || '跳转', text: node.data.text });
          break;
      }

      const { choices: cs, path: outP } = outgoingChoices(curP, node, nextVars);
      curP = outP;

      if (cs.length === 0) {
        setCurPath(curP);
        setVars(nextVars);
        setChoices([]);
        setEnded(true);
        return;
      }
      if (cs.length === 1 && ['hub', 'instruction', 'condition'].includes(node.type)) {
        id = cs[0].nodeId; // 直通型节点自动前进
        continue;
      }
      setCurPath(curP);
      setVars(nextVars);
      setChoices(cs);
      return;
    }

    setVars(nextVars);
    setChoices([]);
    setEnded(true);
  };

  const begin = () => {
    setLog([]);
    setEnded(false);
    const initVars: Record<string, VarValue> = {};
    for (const x of project.variables) initVars[x.name] = coerceVar(x.type, x.value);
    setVars(initVars);
    const c = container(path);
    if (startNodeId && c.nodes.some((n) => n.id === startNodeId)) {
      visit(path, startNodeId, initVars);
      return;
    }
    const starts = startNodes(c);
    if (starts.length === 0) { setChoices([]); setEnded(true); return; }
    if (starts.length === 1) { visit(path, starts[0].id, initVars); return; }
    setCurPath(path);
    setChoices(starts.map((s) => ({ label: s.data.title || FLOW_NODE_LABEL[s.type], nodeId: s.id })));
  };

  useEffect(begin, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [log, choices, ended]);

  const varList = useMemo(() => Object.entries(vars), [vars]);

  return (
    <div className="player-overlay">
      <div className="player-head">
        <span className="player-title">▶ 演出 · {flow.name}</span>
        <span className="spacer" />
        <button onClick={begin}>⟲ 重新开始</button>
        <button onClick={onClose}>✕ 退出演出</button>
      </div>
      <div className="player-body">
        <div className="player-log" ref={logRef}>
          {log.map((b) => (
            <div key={b.id} className={`beat beat-${b.kind}`}>
              {b.kind === 'dialogue' ? (
                <>
                  <div className="beat-speaker" style={{ color: b.speaker?.color }}>
                    {b.speaker ? `${b.speaker.emoji} ${b.speaker.name}` : b.title || '对白'}
                  </div>
                  <div className="beat-text">{b.text || '(空对白)'}</div>
                </>
              ) : (
                <>
                  <div className="beat-meta" style={{ color: TYPE_COLORS[b.kind as keyof typeof TYPE_COLORS] }}>
                    {b.kind === 'fragment' ? `▦ ${b.title}` : b.kind === 'jump' ? `↪ ${b.title}` : b.title}
                  </div>
                  {b.text && <div className="beat-text dim">{b.text}</div>}
                </>
              )}
              {b.note && <div className="beat-note">{b.note}</div>}
            </div>
          ))}
          {ended && (
            <div className="beat beat-end">
              <div className="beat-meta">— 演出结束 —</div>
            </div>
          )}
          {!ended && choices.length > 0 && (
            <div className="player-choices">
              {choices.map((c, i) => (
                <button
                  key={i}
                  className={choices.length > 1 ? 'choice' : 'choice single'}
                  onClick={() => c.nodeId && visit(curPath, c.nodeId, vars)}
                >
                  {choices.length > 1 ? `${i + 1}. ${c.label}` : `${c.label} →`}
                </button>
              ))}
            </div>
          )}
        </div>
        <aside className="player-vars">
          <h3>变量状态</h3>
          {varList.length === 0 && <div className="empty-hint" style={{ padding: 10 }}>没有变量</div>}
          {varList.map(([k, v]) => (
            <div key={k} className="var-row">
              <span className="var-name">{k}</span>
              <span className={`var-val ${typeof v === 'boolean' ? (v ? 'on' : 'off') : ''}`}>{String(v)}</span>
            </div>
          ))}
          <div className="player-tip">
            条件分支按变量自动走向;<br />指令节点实时修改变量。<br />重新开始会还原默认值。
          </div>
        </aside>
      </div>
    </div>
  );
}
