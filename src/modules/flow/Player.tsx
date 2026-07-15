import { useEffect, useMemo, useRef, useState } from 'react';
import { useLoom } from '../../store';
import { resolveSub } from '../../util';
import type { Entity, Flow, FlowEdge, FlowNode, SubFlow } from '../../types';
import { ANNOTATION_TYPES, FLOW_NODE_LABEL } from '../../types';
import { TYPE_COLORS } from './nodes';
import Icon from '../../components/Icon';
import { RichText } from '../../components/RichText';
import {
  applyInstructions, coerceScalar, coerceVar, evalCondition, evalNumber,
  type EvalCtx, type VarValue,
} from '../../script';

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
  edgeId?: string;
  effect?: string;
  once?: boolean;
}

function startNodes(sub: SubFlow): FlowNode[] {
  const hasIncoming = new Set(sub.edges.map((e) => e.target));
  const story = sub.nodes.filter((n) => !ANNOTATION_TYPES.has(n.type));
  const starts = story.filter((n) => !hasIncoming.has(n.id));
  return starts.length > 0 ? starts : story;
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
  /** 一次性选项的已选记录 */
  const takenEdges = useRef(new Set<string>());
  /** 红色检定的既定结果 */
  const checkResults = useRef(new Map<string, boolean>());
  /** 已访问节点 id 集合(用于 seen/unseen 求值) */
  const seenRef = useRef<Set<string>>(new Set());

  /** 技术名 → 节点 id 映射,递归遍历流程所有层级 */
  const techToId = useMemo(() => {
    const m = new Map<string, string>();
    const walk = (sub: SubFlow) => {
      for (const n of sub.nodes) {
        if (n.data.technicalName) m.set(n.data.technicalName, n.id);
        if (n.data.sub) walk(n.data.sub);
      }
    };
    walk(flow);
    return m;
  }, [flow]);
  const seen: EvalCtx['seen'] = (tn) => seenRef.current.has(techToId.get(tn) ?? '__none__');

  /** 实体属性对象:技术名 → { 字段名 → 标量值 / 被引用实体技术名 } */
  const entityProps = useMemo(() => {
    const out: Record<string, Record<string, VarValue>> = {};
    const byId = new Map(entities.map((e) => [e.id, e]));
    for (const e of entities) {
      if (!e.technicalName) continue;
      const props: Record<string, VarValue> = {};
      for (const f of e.fields) {
        if (!f.label) continue;
        if (f.type === 'entity') {
          const ref = f.value ? byId.get(f.value) : undefined;
          if (ref?.technicalName) props[f.label] = ref.technicalName;
        } else if (f.type === 'entities') {
          // 多引用字段暂不展开为属性(数组非标量);跳过
        } else {
          props[f.label] = coerceScalar(f.value);
        }
      }
      out[e.technicalName] = props;
    }
    return out;
  }, [entities]);
  const evalCtx: EvalCtx = { seen, entityProps };

  const container = (p: string[]): SubFlow => resolveSub(flow, p) ?? { nodes: [], edges: [] };

  const pushBeat = (b: Omit<Beat, 'id'>) => setLog((l) => [...l, { ...b, id: String(++beatSeq) }]);

  /** 节点的出边 → 选项列表;没有出边时向父级回溯;出口节点走父层片段的命名引脚 */
  const outgoingChoices = (p: string[], node: FlowNode, vv: Record<string, VarValue>): { choices: Choice[]; path: string[] } => {
    let curP = [...p];
    let cur: FlowNode | undefined = node;
    let exitId: string | null = null;
    // 无出边时逐层弹出:从进入的片段节点继续
    for (let guard = 0; guard < 64; guard++) {
      // 出口节点:弹回父层,走片段上对应的命名引脚
      if (cur?.type === 'exit' && curP.length > 0) {
        exitId = cur.id;
        const fragId = curP[curP.length - 1];
        curP = curP.slice(0, -1);
        cur = container(curP).nodes.find((n) => n.id === fragId);
      }
      const c = container(curP);
      let edges = cur ? c.edges.filter((e) => e.source === cur!.id) : [];
      if (exitId) {
        const named = edges.filter((e) => e.sourceHandle === `exit:${exitId}`);
        edges = named.length > 0 ? named : edges.filter((e) => !e.sourceHandle);
        exitId = null;
      } else if (cur?.type === 'fragment') {
        // 子路径自然结束(未经出口)→ 走默认引脚
        edges = edges.filter((e) => !e.sourceHandle);
      }
      if (cur?.type === 'condition') edges = filterCondEdges(edges, cur, vv, evalCtx);
      if (cur?.type === 'check') {
        const passed = checkResults.current.get(cur.id) ?? false;
        const want = passed ? 'success' : 'fail';
        const picked = edges.filter((e) => e.sourceHandle === want);
        edges = picked.length > 0 ? picked : [];
      }
      // 选项级过滤:一次性已选、出现条件不满足的选项隐藏
      const usable = edges.filter((e) =>
        !(e.once && takenEdges.current.has(e.id)) &&
        (!e.condition || evalCondition(e.condition, vv, evalCtx) !== false),
      );
      // 兜底分支:有其他可用候选时遮蔽 fallback 边
      const nonFallback = usable.filter((e) => !e.fallback);
      const finalUsable = nonFallback.length > 0 ? nonFallback : usable;
      if (finalUsable.length > 0) {
        return {
          path: curP,
          choices: finalUsable.map((e) => {
            const target = c.nodes.find((n) => n.id === e.target);
            return {
              label: (typeof e.label === 'string' && e.label) || target?.data.title || (target ? FLOW_NODE_LABEL[target.type] : '继续'),
              nodeId: e.target,
              edgeId: e.id,
              effect: e.effect,
              once: e.once,
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

  const filterCondEdges = (edges: FlowEdge[], node: FlowNode, vv: Record<string, VarValue>, ctx: EvalCtx): FlowEdge[] => {
    const result = evalCondition(node.data.text, vv, ctx);
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
      seenRef.current.add(id);

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
          const result = evalCondition(node.data.text, nextVars, evalCtx);
          pushBeat({
            kind: 'condition', title: node.data.title || '条件分支', text: node.data.text,
            note: result === null ? '无法求值,请手动选择分支' : result ? '→ 真' : '→ 假',
          });
          break;
        }
        case 'jump':
          pushBeat({ kind: 'jump', title: node.data.title || '跳转', text: node.data.text });
          break;
        case 'exit':
          pushBeat({ kind: 'exit', title: `⇥ 经「${node.data.title || '出口'}」离开子流程`, text: '' });
          break;
        case 'check': {
          const red = node.data.checkRed === true;
          const dc = Number(node.data.checkDc ?? 10);
          let note: string;
          if (red && checkResults.current.has(node.id)) {
            note = `红色检定只有一次机会 → 沿用先前结果:${checkResults.current.get(node.id) ? '成功' : '失败'}`;
          } else {
            const skill = evalNumber(node.data.checkExpr, nextVars, evalCtx);
            const d1 = 1 + Math.floor(Math.random() * 6);
            const d2 = 1 + Math.floor(Math.random() * 6);
            const passed = d1 + d2 + skill >= dc;
            checkResults.current.set(node.id, passed);
            note = `2d6 = ${d1}+${d2},技能 ${skill},合计 ${d1 + d2 + skill} vs 难度 ${dc} → ${passed ? '成功' : '失败'}`;
          }
          pushBeat({
            kind: 'check',
            title: `${red ? '红色' : '白色'}检定 · ${node.data.title || node.data.checkExpr || ''}`,
            text: node.data.text,
            note,
          });
          break;
        }
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
      if (cs.length === 1 && ['hub', 'instruction', 'condition', 'exit', 'check'].includes(node.type)) {
        // 直通型节点自动前进,沿途执行边效果并记录一次性选项
        const c0 = cs[0];
        if (c0.edgeId && c0.once) takenEdges.current.add(c0.edgeId);
        if (c0.effect) applyInstructions(c0.effect, nextVars);
        id = c0.nodeId;
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

  const choose = (c: Choice) => {
    if (!c.nodeId) return;
    if (c.edgeId && c.once) takenEdges.current.add(c.edgeId);
    let vv = vars;
    if (c.effect) {
      vv = { ...vars };
      applyInstructions(c.effect, vv);
    }
    visit(curPath, c.nodeId, vv);
  };

  const begin = () => {
    setLog([]);
    setEnded(false);
    takenEdges.current.clear();
    checkResults.current.clear();
    seenRef.current = new Set();
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
        <span className="player-title"><Icon name="play" size={14} /> 演出 · {flow.name}</span>
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
                  <div className="beat-speaker">
                    {b.speaker?.avatar && <img className="speaker-avatar" src={b.speaker.avatar} alt="" />}
                    {b.speaker ? b.speaker.name : b.title || '对白'}
                  </div>
                  <div className="beat-text">{b.text ? <RichText text={b.text} /> : '(空对白)'}</div>
                </>
              ) : (
                <>
                  <div className="beat-meta" style={{ color: TYPE_COLORS[b.kind as keyof typeof TYPE_COLORS] }}>
                    {b.kind === 'fragment' ? `▦ ${b.title}` : b.kind === 'jump' ? `↪ ${b.title}` : b.title}
                  </div>
                  {b.text && <div className="beat-text dim"><RichText text={b.text} /></div>}
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
                  onClick={() => choose(c)}
                >
                  {choices.length > 1 ? `${i + 1}. ${c.label}` : `${c.label} →`}
                  {c.once && <span className="choice-once" title="一次性选项">①</span>}
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
