import { useEffect, useMemo, useRef, useState } from 'react';
import { useLoom } from '../../store';
import { resolveSub } from '../../util';
import type { Entity, Flow, FlowEdge, FlowNode, SubFlow } from '../../types';
import { ANNOTATION_TYPES, FLOW_NODE_LABEL } from '../../types';
import { TYPE_COLORS } from './nodes';
import Icon from '../../components/Icon';
import { RichText } from '../../components/RichText';
import {
  applyInstructions, buildEntityProps, coerceVar, evalCondition, evalNumber,
  type EvalCtx, type VarValue,
} from '../../script';
import { mulberry32, randomSeed, resumeRng, rollD6 } from '../../rng';
import {
  clearPlaySave, loadBreakpoints, loadPlaySave, storePlaySave, type PlaySave,
} from '../../playSaves';

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
  const slotId = useLoom((s) => s.currentSlotId);
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
  /** 上一步发生变化的变量名(监视高亮) */
  const [changedVars, setChangedVars] = useState<Set<string>>(new Set());
  /** 实体属性运行态的渲染快照(指令写入后刷新) */
  const [propsView, setPropsView] = useState<Record<string, Record<string, VarValue>>>({});
  /** 固定随机种子:同种子重开 → 检定掷骰序列完全一致 */
  const [seed, setSeed] = useState<number>(() => randomSeed());
  const [saveInfo, setSaveInfo] = useState<PlaySave | null>(() => loadPlaySave(slotId, flow.id));
  const rngRef = useRef<() => number>(mulberry32(seed));
  const rollsRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  /** 一次性选项的已选记录 */
  const takenEdges = useRef(new Set<string>());
  /** 红色检定的既定结果 */
  const checkResults = useRef(new Map<string, boolean>());
  /** 已访问节点 id 集合(用于 seen/unseen 求值) */
  const seenRef = useRef<Set<string>>(new Set());
  /** 节点断点(本机,演出自动前进在断点前暂停) */
  const breakpoints = useMemo(() => loadBreakpoints(slotId, flow.id), [slotId, flow.id]);

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

  /** 实体属性运行态副本:指令可写(实体.字段 = ...),重新开始时还原 */
  const entityPropsRef = useRef<Record<string, Record<string, VarValue>>>(buildEntityProps(entities));
  const evalCtx: EvalCtx = { seen, entityProps: entityPropsRef.current };

  const container = (p: string[]): SubFlow => resolveSub(flow, p) ?? { nodes: [], edges: [] };

  const pushBeat = (b: Omit<Beat, 'id'>) => setLog((l) => [...l, { ...b, id: String(++beatSeq) }]);

  /** 提交变量:记录与上一状态的差异用于监视高亮,并刷新实体属性快照 */
  const varsRef = useRef(vars);
  const commitVars = (next: Record<string, VarValue>) => {
    const changed = new Set<string>();
    for (const k of new Set([...Object.keys(varsRef.current), ...Object.keys(next)])) {
      if (varsRef.current[k] !== next[k]) changed.add(k);
    }
    varsRef.current = next;
    setChangedVars(changed);
    setVars(next);
    setPropsView(structuredClone(entityPropsRef.current));
  };

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
            commitVars(nextVars);
            setChoices(starts.map((s) => ({ label: s.data.title || FLOW_NODE_LABEL[s.type], nodeId: s.id })));
            return;
          }
          break;
        }
        case 'hub':
          if (node.data.title) pushBeat({ kind: 'hub', title: node.data.title, text: '' });
          break;
        case 'instruction': {
          const warnings = applyInstructions(node.data.text, nextVars, evalCtx);
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
            const d1 = rollD6(rngRef.current);
            const d2 = rollD6(rngRef.current);
            rollsRef.current += 2;
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
        commitVars(nextVars);
        setChoices([]);
        setEnded(true);
        return;
      }
      if (cs.length === 1 && ['hub', 'instruction', 'condition', 'exit', 'check'].includes(node.type)) {
        const c0 = cs[0];
        // 断点:自动前进的目标带断点时暂停,交还手动控制
        if (c0.nodeId && breakpoints.has(c0.nodeId)) {
          setCurPath(curP);
          commitVars(nextVars);
          setChoices([{ ...c0, label: `⛔ ${c0.label}(断点)` }]);
          return;
        }
        // 直通型节点自动前进,沿途执行边效果并记录一次性选项
        if (c0.edgeId && c0.once) takenEdges.current.add(c0.edgeId);
        if (c0.effect) applyInstructions(c0.effect, nextVars, evalCtx);
        id = c0.nodeId;
        continue;
      }
      setCurPath(curP);
      commitVars(nextVars);
      setChoices(cs);
      return;
    }

    commitVars(nextVars);
    setChoices([]);
    setEnded(true);
  };

  const choose = (c: Choice) => {
    if (!c.nodeId) return;
    if (c.edgeId && c.once) takenEdges.current.add(c.edgeId);
    let vv = vars;
    if (c.effect) {
      vv = { ...vars };
      applyInstructions(c.effect, vv, evalCtx);
    }
    visit(curPath, c.nodeId, vv);
  };

  const begin = (useSeed?: number) => {
    const nextSeed = useSeed ?? randomSeed();
    setSeed(nextSeed);
    rngRef.current = mulberry32(nextSeed);
    rollsRef.current = 0;
    setLog([]);
    setEnded(false);
    setChangedVars(new Set());
    takenEdges.current.clear();
    checkResults.current.clear();
    seenRef.current = new Set();
    entityPropsRef.current = buildEntityProps(entities);
    setPropsView(structuredClone(entityPropsRef.current));
    const initVars: Record<string, VarValue> = {};
    for (const x of project.variables) initVars[x.name] = coerceVar(x.type, x.value);
    varsRef.current = initVars;
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

  useEffect(() => { begin(seed); }, []);

  /** 存档:完整运行态 + 种子与已消耗随机数,可跨会话恢复并保证掷骰一致 */
  const saveGame = () => {
    const save: PlaySave = {
      at: Date.now(),
      seed,
      rolls: rollsRef.current,
      vars: varsRef.current,
      seen: [...seenRef.current],
      taken: [...takenEdges.current],
      checks: [...checkResults.current.entries()],
      entityProps: structuredClone(entityPropsRef.current),
      curPath,
      choices: choices.map(({ label, nodeId, edgeId, effect, once }) => ({ label, nodeId, edgeId, effect, once })),
      ended,
      log: log.map((b) => ({ id: b.id, kind: b.kind, title: b.title, text: b.text, speakerId: b.speaker?.id, note: b.note })),
    };
    const err = storePlaySave(slotId, flow.id, save);
    if (!err) setSaveInfo(save);
  };

  /** 读档:还原全部运行态,RNG 按种子快进到存档时的消耗位置 */
  const loadGame = () => {
    const save = loadPlaySave(slotId, flow.id);
    if (!save) return;
    setSeed(save.seed);
    rngRef.current = resumeRng(save.seed, save.rolls);
    rollsRef.current = save.rolls;
    takenEdges.current = new Set(save.taken);
    checkResults.current = new Map(save.checks);
    seenRef.current = new Set(save.seen);
    entityPropsRef.current = structuredClone(save.entityProps);
    setPropsView(structuredClone(save.entityProps));
    varsRef.current = { ...save.vars };
    setVars({ ...save.vars });
    setChangedVars(new Set());
    setCurPath([...save.curPath]);
    setChoices(save.choices.map((c) => ({ ...c })));
    setEnded(save.ended);
    setLog(save.log.map((b) => ({
      id: b.id, kind: b.kind, title: b.title, text: b.text, note: b.note,
      speaker: b.speakerId ? entities.find((e) => e.id === b.speakerId) : undefined,
    })));
  };

  const dropSave = () => {
    clearPlaySave(slotId, flow.id);
    setSaveInfo(null);
  };

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [log, choices, ended]);

  const varList = useMemo(() => Object.entries(vars), [vars]);

  return (
    <div className="player-overlay">
      <div className="player-head">
        <span className="player-title"><Icon name="play" size={14} /> 演出 · {flow.name}</span>
        <span className="player-seed" title="随机种子:同种子重开时,检定掷骰序列完全一致(测试可复现)">种子 {seed}</span>
        <span className="spacer" />
        <button onClick={saveGame} title="保存当前演出进度(变量 / 走过的节点 / 掷骰进度),存在本机">存档</button>
        {saveInfo && (
          <>
            <button onClick={loadGame} title={`恢复到 ${new Date(saveInfo.at).toLocaleString()} 的存档(种子 ${saveInfo.seed})`}>
              读档
            </button>
            <button className="ghost icon-btn" onClick={dropSave} title="删除本流程的演出存档">🗑</button>
          </>
        )}
        <button onClick={() => begin(seed)} title="用当前种子重新开始:检定结果可复现">⟲ 同种子重开</button>
        <button onClick={() => begin()} title="换一个随机种子重新开始">⟲ 重新开始</button>
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
          <h3>变量监视</h3>
          {varList.length === 0 && <div className="empty-hint" style={{ padding: 10 }}>没有变量</div>}
          {varList.map(([k, v]) => (
            <div key={k} className={`var-row${changedVars.has(k) ? ' var-changed' : ''}`}>
              <span className="var-name">{k}</span>
              <span className={`var-val ${typeof v === 'boolean' ? (v ? 'on' : 'off') : ''}`}>{String(v)}</span>
            </div>
          ))}
          {Object.keys(propsView).length > 0 && (
            <>
              <h3 style={{ marginTop: 10 }}>实体属性</h3>
              {Object.entries(propsView).map(([tech, fields]) => (
                <div key={tech} className="player-entity-props">
                  <div className="var-name" style={{ fontWeight: 700 }}>{tech}</div>
                  {Object.entries(fields).map(([fk, fv]) => (
                    <div key={fk} className="var-row" style={{ paddingLeft: 10 }}>
                      <span className="var-name">{fk}</span>
                      <span className="var-val">{String(fv)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
          {breakpoints.size > 0 && (
            <div className="player-tip">⛔ 本流程有 {breakpoints.size} 个断点:自动前进会在断点处暂停。</div>
          )}
          <div className="player-tip">
            高亮 = 上一步发生变化;<br />条件分支按变量自动走向;<br />同种子重开可复现检定结果。
          </div>
        </aside>
      </div>
    </div>
  );
}
