import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { alertDialog, promptText } from '../../dialog';
import { flowFingerprint } from '../../flowTest';
import { resolveSub } from '../../util';
import type { Entity, EventWait, Flow, FlowEdge, FlowNode, FlowParam, SubFlow, VariableType } from '../../types';
import { ANNOTATION_TYPES, EVENT_WAIT_LABEL, FLOW_NODE_LABEL } from '../../types';
import { MAX_CALL_DEPTH } from '../../runtime/player';
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

/** R19-2 调用帧(与运行库 RuntimeFrame 同构,演出侧不带事件协议字段) */
interface PlayFrame {
  flowId: string;
  path: string[];
  nodeId: string;
  returnVar?: string;
  savedParams: { name: string; value: VarValue | null }[];
}

/** R19-3 演出里停在外部事件上的挂起态 */
interface PendingEvent {
  eventName: string;
  label: string;
  argText: string;
  wait: EventWait;
  resultVar?: string;
  returnType?: VariableType;
  path: string[];
  nodeId: string;
  flowId: string;
}

/** 单出边时自动前进的直通型节点(与运行库 AUTO_ADVANCE 保持一致) */
const AUTO_ADVANCE_TYPES = ['hub', 'instruction', 'condition', 'exit', 'check', 'call', 'event'];

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
  const externalEvents = project.externalEvents ?? [];

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

  /**
   * R19-2:当前所在流程。跨流程 jump / call 会切换它。
   * 用 ref 是因为 visit 循环内切流程后必须同步生效(setState 要等下一次渲染)。
   */
  const activeFlowRef = useRef<Flow>(flow);
  const [activeFlowName, setActiveFlowName] = useState(flow.name);
  /** R19-2 调用栈:栈顶是最近一次 call 的返回点 */
  const callStackRef = useRef<PlayFrame[]>([]);
  /** R19-3:停在外部事件上时的挂起态(编辑器里由用户填模拟响应来放行) */
  const [pendingEvent, setPendingEvent] = useState<PendingEvent | null>(null);
  const [simInput, setSimInput] = useState('');
  /**
   * R19-4 录制:把这次演出的选择下标与事件响应记下来,
   * 「存为回归测试」时连同种子一起固化,之后可无人值守回放。
   */
  const recordedChoices = useRef<number[]>([]);
  const recordedEvents = useRef<{ event: string; value?: string }[]>([]);
  /** 最后进入的节点 id:存为测试时作为「结束于此」断言的目标 */
  const lastNodeIdRef = useRef<string | undefined>(undefined);

  /**
   * 技术名 → 节点 id 映射,递归遍历全部流程所有层级。
   * R19-2:seen() 的目标可能落在被调流程里,所以索引跨流程
   * (技术名项目内唯一,由体检的重复技术名检查保证)。
   */
  const techToId = useMemo(() => {
    const m = new Map<string, string>();
    const walk = (sub: SubFlow) => {
      for (const n of sub.nodes) {
        if (n.data.technicalName) m.set(n.data.technicalName, n.id);
        if (n.data.sub) walk(n.data.sub);
      }
    };
    for (const f of project.flows) walk(f);
    return m;
  }, [project.flows]);
  const seen: EvalCtx['seen'] = (tn) => seenRef.current.has(techToId.get(tn) ?? '__none__');

  /** 实体属性运行态副本:指令可写(实体.字段 = ...),重新开始时还原 */
  const entityPropsRef = useRef<Record<string, Record<string, VarValue>>>(buildEntityProps(entities));
  const evalCtx: EvalCtx = { seen, entityProps: entityPropsRef.current };

  /** 容器解析始终针对「当前流程」,跨流程切换后所有调用点自动跟随 */
  const container = (p: string[]): SubFlow => resolveSub(activeFlowRef.current, p) ?? { nodes: [], edges: [] };

  /** R19-2:按技术名或 id 找流程 */
  const findFlow = (ref: string): Flow | undefined =>
    project.flows.find((f) => f.id === ref || (f.technicalName && f.technicalName === ref));

  /** R19-2:解析目标入口;返回 null = 无法进入 */
  const resolveEntry = (f: Flow, entryKey?: string): { nodeId: string; params: FlowParam[] } | null => {
    if (entryKey) {
      const entry = (f.entries ?? []).find((e) => e.key === entryKey);
      if (!entry || !f.nodes.some((n) => n.id === entry.nodeId)) return null;
      return { nodeId: entry.nodeId, params: entry.params ?? [] };
    }
    const starts = startNodes(f);
    return starts.length === 0 ? null : { nodeId: starts[0].id, params: [] };
  };

  /** R19-2:绑定实参并返回被覆盖变量的原值(call 弹栈时还原) */
  const bindArgs = (
    params: FlowParam[],
    args: { name: string; expr: string }[] | undefined,
    vv: Record<string, VarValue>,
  ): { name: string; value: VarValue | null }[] => {
    const saved: { name: string; value: VarValue | null }[] = [];
    if (params.length === 0) return saved;
    const byName = new Map((args ?? []).map((a) => [a.name, a.expr]));
    for (const p of params) {
      saved.push({ name: p.name, value: p.name in vv ? vv[p.name] : null });
      const expr = byName.get(p.name);
      if (expr !== undefined && expr.trim()) {
        if (p.type === 'boolean') vv[p.name] = evalCondition(expr, vv, evalCtx) ?? false;
        else if (p.type === 'number') vv[p.name] = evalNumber(expr, vv, evalCtx);
        else vv[p.name] = expr;
      } else {
        vv[p.name] = coerceVar(p.type, p.default ?? '');
      }
    }
    return saved;
  };

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

  /**
   * R19-2:弹出一个调用帧回到调用点。
   * 先还原参数原值再写返回值 —— 两者同名时返回值胜出。
   */
  const popFrame = (
    returnValue: VarValue | null,
    vv: Record<string, VarValue>,
  ): { node: FlowNode; path: string[] } | null => {
    const frame = callStackRef.current.pop();
    if (!frame) return null;
    for (const s of frame.savedParams) {
      if (s.value === null) delete vv[s.name];
      else vv[s.name] = s.value;
    }
    const f = project.flows.find((x) => x.id === frame.flowId);
    if (!f) return null;
    activeFlowRef.current = f;
    setActiveFlowName(f.name);
    if (frame.returnVar && returnValue !== null) vv[frame.returnVar] = returnValue;
    const node = container(frame.path).nodes.find((n) => n.id === frame.nodeId);
    if (!node) return null;
    return { node, path: [...frame.path] };
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
      lastNodeIdRef.current = id;

      const speaker = entities.find((e) => e.id === node.data.speakerId);
      // R19-2:本节点是否要切流程 / 弹栈返回
      let crossTarget: { flow: Flow; nodeId: string } | null = null;
      let doReturn = false;
      let returnValue: VarValue | null = null;
      // 出边计算的落点节点:正常是本节点,弹栈返回后是调用点
      let node2: FlowNode = node;
      let autoAdvance = AUTO_ADVANCE_TYPES.includes(node.type);
      // R19-3:非 null 表示停在外部事件上,等用户填模拟响应
      let suspendEvent: PendingEvent | null = null;
      let simPrefill = '';

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
        case 'call': {
          const isCall = node.type === 'call';
          const targetRef = (node.data.targetFlow ?? '').trim();
          if (!targetRef) {
            pushBeat({ kind: node.type, title: node.data.title || '跳转', text: node.data.text });
            break;
          }
          const target = findFlow(targetRef);
          const entry = target ? resolveEntry(target, node.data.targetEntry) : null;
          if (!target || !entry) {
            pushBeat({
              kind: node.type, title: node.data.title || (isCall ? '调用' : '跳转'), text: node.data.text,
              note: !target ? `目标流程不存在:${targetRef}` : `目标入口不存在:${node.data.targetEntry || '默认起点'}`,
            });
            break;
          }
          if (isCall) {
            if (callStackRef.current.length >= MAX_CALL_DEPTH) {
              pushBeat({
                kind: 'call', title: node.data.title || '调用', text: node.data.text,
                note: `调用深度超过 ${MAX_CALL_DEPTH} 层,已停止(可能是无限递归)`,
              });
              break;
            }
            const saved = bindArgs(entry.params, node.data.args, nextVars);
            callStackRef.current.push({
              flowId: activeFlowRef.current.id, path: [...curP], nodeId: node.id,
              returnVar: node.data.returnVar, savedParams: saved,
            });
          } else {
            bindArgs(entry.params, node.data.args, nextVars);
          }
          pushBeat({
            kind: node.type, title: node.data.title || (isCall ? '调用' : '跳转'), text: node.data.text,
            note: `${isCall ? '调用' : '跳转'} → ${target.name}${node.data.targetEntry ? ` · ${node.data.targetEntry}` : ''}`,
          });
          crossTarget = { flow: target, nodeId: entry.nodeId };
          break;
        }
        case 'event': {
          const evName = (node.data.eventName ?? '').trim();
          const decl = externalEvents.find((e) => e.name === evName);
          if (!evName || !decl) {
            const why = evName ? `事件「${evName}」未在项目中声明,已跳过` : '未选择要请求的事件,已跳过';
            pushBeat({ kind: 'event', title: node.data.title || '外部事件', text: node.data.text, note: why });
            break;
          }
          const wait: EventWait = node.data.eventWait ?? 'continue';
          const byName = new Map((node.data.eventArgs ?? []).map((a) => [a.name, a.expr]));
          const argPairs: string[] = [];
          for (const prm of decl.params ?? []) {
            const expr = byName.get(prm.name);
            let v: VarValue;
            if (expr !== undefined && expr.trim()) {
              if (prm.type === 'boolean') v = evalCondition(expr, nextVars, evalCtx) ?? false;
              else if (prm.type === 'number') v = evalNumber(expr, nextVars, evalCtx);
              else v = expr;
            } else {
              v = coerceVar(prm.type, prm.default ?? '');
            }
            argPairs.push(`${prm.name}=${String(v)}`);
          }
          const argText = argPairs.join(', ');
          pushBeat({
            kind: 'event',
            title: node.data.title || decl.label || evName,
            text: node.data.text,
            note: `[事件] ${decl.label || evName}${argText ? `(${argText})` : ''} · ${EVENT_WAIT_LABEL[wait]}`,
          });
          if (wait !== 'continue') {
            suspendEvent = {
              eventName: evName,
              label: decl.label || evName,
              argText,
              wait,
              resultVar: wait === 'value' ? node.data.eventResultVar : undefined,
              returnType: decl.returnType,
              path: [...curP],
              nodeId: node.id,
              flowId: activeFlowRef.current.id,
            };
            simPrefill = node.data.eventSimValue ?? '';
          }
          break;
        }
        case 'return': {
          const hasValue = typeof node.data.returnExpr === 'string' && node.data.returnExpr.trim() !== '';
          if (hasValue) returnValue = evalNumber(node.data.returnExpr, nextVars, evalCtx);
          pushBeat({
            kind: 'return', title: node.data.title || '返回', text: node.data.text,
            note: callStackRef.current.length === 0
              ? '调用栈为空,演出结束'
              : hasValue ? `返回值 ${returnValue}` : '返回调用点',
          });
          doReturn = true;
          break;
        }
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

      // R19-3:挂起等模拟响应 —— 既不结束也不给选项
      if (suspendEvent) {
        setCurPath(curP);
        commitVars(nextVars);
        setChoices([]);
        setPendingEvent(suspendEvent);
        setSimInput(simPrefill);
        return;
      }

      // R19-2:切到目标流程入口
      if (crossTarget) {
        activeFlowRef.current = crossTarget.flow;
        setActiveFlowName(crossTarget.flow.name);
        curP = [];
        id = crossTarget.nodeId;
        continue;
      }

      // R19-2:显式返回 —— 弹栈后从调用点的出边继续
      if (doReturn) {
        const resumed = popFrame(returnValue, nextVars);
        if (!resumed) {
          setCurPath(curP); commitVars(nextVars); setChoices([]); setEnded(true);
          return;
        }
        node2 = resumed.node;
        curP = resumed.path;
        autoAdvance = true;
      }

      // 从 node2 的出边继续(正常情况 node2 === node;返回时是调用点)
      let cs: Choice[];
      for (;;) {
        const r = outgoingChoices(curP, node2, nextVars);
        curP = r.path;
        if (r.choices.length > 0) { cs = r.choices; break; }
        // R19-2:被调流程走到尽头 = 隐式返回
        const resumed = popFrame(null, nextVars);
        if (!resumed) {
          setCurPath(curP); commitVars(nextVars); setChoices([]); setEnded(true);
          return;
        }
        node2 = resumed.node;
        curP = resumed.path;
        autoAdvance = true;
      }

      if (cs.length === 1 && autoAdvance) {
        const c0 = cs[0];
        // 断点:自动前进的目标带断点时暂停,交还手动控制
        if (c0.nodeId && breakpoints.has(c0.nodeId)) {
          setCurPath(curP);
          commitVars(nextVars);
          setChoices([{ ...c0, label: `[断点] ${c0.label}` }]);
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

  /**
   * R19-3:用模拟响应放行,从事件节点的出边继续。
   * 与运行库 resolveExternal 同语义 —— 只是值由编辑器里的输入提供。
   */
  const resolveEvent = () => {
    const pending = pendingEvent;
    if (!pending) return;
    const vv = { ...varsRef.current };
    if (pending.wait === 'value' && pending.resultVar) {
      const t = pending.returnType ?? 'string';
      vv[pending.resultVar] = t === 'boolean' ? simInput === 'true'
        : t === 'number' ? (Number(simInput) || 0)
        : simInput;
    }
    recordedEvents.current.push({
      event: pending.eventName,
      value: pending.wait === 'value' ? simInput : undefined,
    });
    setPendingEvent(null);
    setSimInput('');
    const f = project.flows.find((x) => x.id === pending.flowId);
    if (f) activeFlowRef.current = f;
    const node = container(pending.path).nodes.find((n) => n.id === pending.nodeId);
    if (!node) { commitVars(vv); setChoices([]); setEnded(true); return; }
    const r = outgoingChoices(pending.path, node, vv);
    if (r.choices.length === 1) {
      const c0 = r.choices[0];
      if (c0.edgeId && c0.once) takenEdges.current.add(c0.edgeId);
      if (c0.effect) applyInstructions(c0.effect, vv, evalCtx);
      if (c0.nodeId) { visit(r.path, c0.nodeId, vv); return; }
    }
    setCurPath(r.path);
    commitVars(vv);
    setChoices(r.choices);
    if (r.choices.length === 0) setEnded(true);
  };

  /**
   * R19-4:把当前这次演出固化为回归测试。
   * 断言默认给一条「演出结束于当前最后一个节点」—— 最常见的诉求是
   * 「这条线以后还得能走到这个结局」,其余断言在测试面板里补。
   */
  const saveAsTest = async () => {
    const name = await promptText({
      message: '回归测试名称',
      placeholder: `${flow.name} · ${new Date().toLocaleString('zh-CN')}`,
      confirmText: '保存',
    });
    if (name === null) return;
    const lastBeatNode = lastNodeIdRef.current;
    useLoom.getState().update((p) => {
      p.flowTests ??= [];
      p.flowTests.push({
        id: uid(),
        name: name.trim() || `${flow.name} 回归`,
        flowRef: flow.technicalName || flow.id,
        seed,
        choices: [...recordedChoices.current],
        eventResponses: recordedEvents.current.length > 0 ? [...recordedEvents.current] : undefined,
        assertions: ended && lastBeatNode ? [{ kind: 'ended', node: lastBeatNode }] : [],
        flowHash: flowFingerprint(p.flows.find((f) => f.id === flow.id) ?? flow),
        updatedAt: Date.now(),
      });
    });
    await alertDialog(`已保存为回归测试「${name.trim() || `${flow.name} 回归`}」。到流程工具栏的「回归」里运行与补断言。`);
  };

  const choose = (c: Choice, index: number) => {
    if (!c.nodeId) return;
    recordedChoices.current.push(index);
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
    // R19-2:重开回到入口流程,清空调用栈
    activeFlowRef.current = flow;
    setActiveFlowName(flow.name);
    callStackRef.current = [];
    recordedChoices.current = [];
    recordedEvents.current = [];
    setPendingEvent(null);
    setSimInput('');
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
      flowId: activeFlowRef.current.id,
      callStack: structuredClone(callStackRef.current),
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
    // R19-2:旧存档没有 flowId / callStack,按入口流程 + 空栈恢复
    const savedFlow = (save.flowId && project.flows.find((f) => f.id === save.flowId)) || flow;
    activeFlowRef.current = savedFlow;
    setActiveFlowName(savedFlow.name);
    callStackRef.current = structuredClone(save.callStack ?? []);
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
        <span className="player-title">
          <Icon name="play" size={14} /> 演出 · {flow.name}
          {activeFlowName !== flow.name && (
            <span className="player-subflow" title="跨流程调用中,当前正在这个流程里">
              {' '}▸ {activeFlowName}
            </span>
          )}
        </span>
        <span className="player-seed" title="随机种子:同种子重开时,检定掷骰序列完全一致(测试可复现)">种子 {seed}</span>
        <span className="spacer" />
        <button onClick={saveGame} title="保存当前演出进度(变量 / 走过的节点 / 掷骰进度),存在本机">存档</button>
        {saveInfo && (
          <>
            <button onClick={loadGame} title={`恢复到 ${new Date(saveInfo.at).toLocaleString()} 的存档(种子 ${saveInfo.seed})`}>
              读档
            </button>
            <button className="ghost icon-btn" onClick={dropSave} title="删除本流程的演出存档"><Icon name="trash" size={14} /></button>
          </>
        )}
        <button
          onClick={saveAsTest}
          title="把这次演出固化成回归测试:记下种子、选择序列与事件响应,之后流程一改就能重跑"
        >⛿ 存为测试</button>
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
          {pendingEvent && (
            <div className="player-event" role="group" aria-label="等待宿主引擎响应">
              <div className="player-event-head">
                <Icon name="bolt" size={12} /> {pendingEvent.label}
                <span className="player-event-wait">{EVENT_WAIT_LABEL[pendingEvent.wait]}</span>
              </div>
              {pendingEvent.argText && (
                <div className="player-event-args">{pendingEvent.argText}</div>
              )}
              <div className="hint" style={{ fontSize: 11 }}>
                实际运行时由宿主引擎处理。这里填一个模拟响应,只影响本机试跑。
              </div>
              {pendingEvent.wait === 'value' && (
                <div className="kv-row" style={{ alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <span style={{ fontSize: 12, minWidth: 72 }}>
                    {pendingEvent.resultVar ? `→ ${pendingEvent.resultVar}` : '(不接收)'}
                  </span>
                  {pendingEvent.returnType === 'boolean' ? (
                    <select value={simInput || 'false'} onChange={(e) => setSimInput(e.target.value)}>
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </select>
                  ) : (
                    <input
                      style={{ flex: 1 }}
                      value={simInput}
                      autoFocus
                      placeholder={pendingEvent.returnType === 'number' ? '数值' : '文本'}
                      onChange={(e) => setSimInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') resolveEvent(); }}
                    />
                  )}
                </div>
              )}
              <button className="primary" style={{ marginTop: 8 }} onClick={resolveEvent}>
                {pendingEvent.wait === 'value' ? '返回该值并继续' : '宿主已完成,继续'}
              </button>
            </div>
          )}
          {!ended && !pendingEvent && choices.length > 0 && (
            <div className="player-choices">
              {choices.map((c, i) => (
                <button
                  key={i}
                  className={choices.length > 1 ? 'choice' : 'choice single'}
                  onClick={() => choose(c, i)}
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
            <div className="player-tip"><Icon name="ban" size={12} /> 本流程有 {breakpoints.size} 个断点:自动前进会在断点处暂停。</div>
          )}
          <div className="player-tip">
            高亮 = 上一步发生变化;<br />条件分支按变量自动走向;<br />同种子重开可复现检定结果。
          </div>
        </aside>
      </div>
    </div>
  );
}
