/**
 * 独立流程运行库(R9)—— 不依赖 React / zustand / 应用状态,
 * 只依赖纯脚本层(src/script)与种子 RNG(src/rng)。
 *
 * 行进语义与应用内演出(Player.tsx)一致:
 *   直通节点自动前进、无出边逐层回溯、exit 走父层片段命名引脚、
 *   fragment 默认引脚、fallback 遮蔽、一次性选项、条件边过滤、
 *   检定 2d6+技能 vs 难度(红检定沿用首次结果)、实体属性读写。
 * 两处语义若改动必须同步(另见 simulate.ts 的同名注释)。
 *
 * 输入是结构化最小类型:应用内 Flow / Variable / Entity 与
 * 引擎导出包(EnginePackage)都直接满足,引擎侧可从 JSON 直接构造。
 */
import {
  applyInstructions, buildEntityProps, coerceVar, evalCondition, evalNumber,
  type EvalCtx, type VarValue,
} from '../script';
import { mulberry32, randomSeed, resumeRng, rollD6 } from '../rng';
import { selectOutgoing } from '../flowWalk';

export type { VarValue } from '../script';

/* ---------- 最小结构类型 ---------- */

export interface RtNodeData {
  title?: string;
  text?: string;
  speakerId?: string;
  sub?: RtSub;
  checkExpr?: string;
  checkDc?: number;
  checkRed?: boolean;
  technicalName?: string;
  /** R19-2 跨流程:jump / call 的目标 */
  targetFlow?: string;
  targetEntry?: string;
  args?: { name: string; expr: string }[];
  returnVar?: string;
  returnExpr?: string;
  /** R19-3 外部事件 */
  eventName?: string;
  eventArgs?: { name: string; expr: string }[];
  eventWait?: 'continue' | 'ack' | 'value';
  eventResultVar?: string;
  [key: string]: unknown;
}

export interface RtNode { id: string; type: string; data: RtNodeData }

export interface RtEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  condition?: string;
  effect?: string;
  once?: boolean;
  fallback?: boolean;
  choiceId?: string;
}

export interface RtSub { nodes: RtNode[]; edges: RtEdge[] }

export interface RtParam { name: string; type: string; default?: string }
export interface RtEntry { key: string; nodeId: string; label?: string; params?: RtParam[] }

export interface RtFlow extends RtSub {
  id: string;
  name?: string;
  technicalName?: string;
  /** R19-2 命名入口 */
  entries?: RtEntry[];
}

export interface RtVariable { name: string; type: string; value: string }

export interface RtEntity {
  id: string;
  name?: string;
  technicalName?: string;
  fields?: { label: string; value: string; type?: string }[];
}

/** 运行库的输入:引擎包或应用内项目的公共子集 */
export interface RtEventParam { name: string; type: string; default?: string }
export interface RtExternalEvent {
  name: string;
  label?: string;
  description?: string;
  params?: RtEventParam[];
  returnType?: string;
}

export interface RtProject {
  runtimeProtocolVersion?: number;
  flows: RtFlow[];
  variables?: RtVariable[];
  entities?: RtEntity[];
  attachments?: Record<string, string[]>;
  /** R19-3 外部事件声明 */
  externalEvents?: RtExternalEvent[];
}

/* ---------- 输出类型 ---------- */

export const RUNTIME_PROTOCOL_VERSION = 2 as const;

export interface RuntimeBeat {
  kind: string;
  title: string;
  text: string;
  speakerId?: string;
  speakerName?: string;
  note?: string;
}

export interface RuntimeChoice {
  label: string;
  choiceKey: string;
  /** null = 起点选择之外不会出现;正常为目标节点 id */
  nodeId: string | null;
  edgeId?: string;
  effect?: string;
  once?: boolean;
}

export interface RuntimeValueChange {
  name: string;
  before: VarValue | null;
  after: VarValue | null;
}

export interface RuntimeEntityChange {
  entityTechnicalName: string;
  field: string;
  before: VarValue | null;
  after: VarValue | null;
}

export interface RuntimeChanges {
  variables: RuntimeValueChange[];
  entities: RuntimeEntityChange[];
}

export interface RuntimeEvent extends RuntimeBeat {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  sourceProtocolVersion: number;
  event: 'enter' | 'display' | 'leave';
  flowId: string;
  flowTechnicalName?: string;
  nodeId: string;
  nodeTechnicalName?: string;
  path: string[];
  nodeType: string;
  fields: { label: string; value: string; type?: string }[];
  assetIds: string[];
  edgeId?: string;
  choiceKey?: string;
  changes: RuntimeChanges;
}

/**
 * R19-2 调用帧:call 压栈,return / 自然结束弹栈。
 * savedParams 记录进入前的参数变量原值,弹栈时还原成局部作用域语义。
 */
export interface RuntimeFrame {
  /** 返回点所在流程 */
  flowId: string;
  /** 返回点的容器 path */
  path: string[];
  /** 返回点节点 id(call 节点自身,弹栈后从它的出边继续) */
  nodeId: string;
  /** 返回值写入的变量名 */
  returnVar?: string;
  /** 进入被调流程前的参数变量原值;null 表示原本不存在该变量 */
  savedParams: { name: string; value: VarValue | null }[];
}

/**
 * R19-3 交给宿主的外部事件调用。
 * 运行库只负责「说清楚要什么」,具体怎么做由宿主引擎决定。
 */
export interface ExternalEventCall {
  /** 事件技术名 */
  name: string;
  /** 已求值的实参(不是表达式) */
  args: Record<string, VarValue>;
  wait: 'continue' | 'ack' | 'value';
  /** 发起该事件的节点定位,便于宿主做日志与断点 */
  flowId: string;
  nodeId: string;
  path: string[];
  nodeTechnicalName?: string;
}

/**
 * R19-3 挂起态:等待模式为 ack / value 时,演出停在这里,
 * 直到宿主调用 `resolveExternal()`。它必须进快照,否则存档在事件处
 * 读回来会卡住。
 */
export interface PendingExternal {
  call: ExternalEventCall;
  /** 回值写入的变量名 */
  resultVar?: string;
  /** 恢复点:事件节点自身,解决后从它的出边继续 */
  flowId: string;
  path: string[];
  nodeId: string;
}

/** 完整运行态快照:引擎存档用;restore 后掷骰序列不漂移 */
export interface RuntimeSnapshot {
  seed: number;
  rolls: number;
  vars: Record<string, VarValue>;
  seen: string[];
  taken: string[];
  checks: [string, boolean][];
  entityProps: Record<string, Record<string, VarValue>>;
  curPath: string[];
  choices: RuntimeChoice[];
  ended: boolean;
  log: RuntimeBeat[];
  events?: RuntimeEvent[];
  /** R19-2:当前所在流程 id;旧存档缺失时按构造时的入口流程恢复 */
  flowId?: string;
  /** R19-2:调用栈;旧存档缺失时按空栈恢复 */
  callStack?: RuntimeFrame[];
  /** R19-3:停在外部事件上时的挂起态;旧存档缺失即未挂起 */
  pendingExternal?: PendingExternal | null;
}

export interface FlowRuntimeOptions {
  /** 固定随机种子:同种子演出的检定掷骰序列完全一致;缺省随机 */
  seed?: number;
  /** 每产生一条演出记录时回调(引擎接管展示) */
  onBeat?: (beat: RuntimeBeat) => void;
  /** v2 节点生命周期事件;旧包也会按确定性默认值补齐 */
  onEvent?: (event: RuntimeEvent) => void;
  /**
   * R19-3 外部事件:宿主在这里执行引擎侧动作。
   * wait='continue' 时返回值被忽略,演出不停;
   * wait='ack' / 'value' 时演出会挂起,宿主完成后调用 `resolveExternal()`。
   * 宿主也可以在回调里同步调用 resolveExternal(适合能立即完成的动作)。
   */
  onExternalEvent?: (call: ExternalEventCall) => void;
}

/** 画布组织类节点,不参与叙事 */
const ANNOTATION = new Set(['note', 'zone']);
/** 单出边时自动前进的直通型节点(R19-2:call 返回后也自动继续) */
const AUTO_ADVANCE = new Set(['hub', 'instruction', 'condition', 'exit', 'check', 'call', 'event']);

const NODE_LABEL: Record<string, string> = {
  dialogue: '对白', fragment: '剧情片段', hub: '汇聚点', condition: '条件分支',
  instruction: '指令', jump: '跳转', exit: '出口', check: '检定',
  call: '调用', return: '返回', event: '外部事件',
};

function startNodes(sub: RtSub): RtNode[] {
  const hasIncoming = new Set(sub.edges.map((e) => e.target));
  const story = sub.nodes.filter((n) => !ANNOTATION.has(n.type));
  const starts = story.filter((n) => !hasIncoming.has(n.id));
  return starts.length > 0 ? starts : story;
}

function resolveSub(root: RtSub, path: string[]): RtSub | null {
  let cur: RtSub = root;
  for (const id of path) {
    const node = cur.nodes.find((n) => n.id === id);
    if (!node?.data.sub) return null;
    cur = node.data.sub;
  }
  return cur;
}

function stateChanges(
  beforeVars: Record<string, VarValue>,
  beforeEntities: Record<string, Record<string, VarValue>>,
  afterVars: Record<string, VarValue>,
  afterEntities: Record<string, Record<string, VarValue>>,
): RuntimeChanges {
  const variables: RuntimeValueChange[] = [];
  const entities: RuntimeEntityChange[] = [];
  for (const name of new Set([...Object.keys(beforeVars), ...Object.keys(afterVars)])) {
    if (beforeVars[name] !== afterVars[name]) {
      variables.push({ name, before: beforeVars[name] ?? null, after: afterVars[name] ?? null });
    }
  }
  for (const entityTechnicalName of new Set([...Object.keys(beforeEntities), ...Object.keys(afterEntities)])) {
    const before = beforeEntities[entityTechnicalName] ?? {};
    const after = afterEntities[entityTechnicalName] ?? {};
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[field] !== after[field]) {
        entities.push({
          entityTechnicalName,
          field,
          before: before[field] ?? null,
          after: after[field] ?? null,
        });
      }
    }
  }
  return { variables, entities };
}

const EMPTY_CHANGES = (): RuntimeChanges => ({ variables: [], entities: [] });

/** R19-2 调用栈深度上限:超过按无限递归处理,就地停下而不是耗尽栈 */
export const MAX_CALL_DEPTH = 32;

export class FlowRuntime {
  readonly protocolVersion = RUNTIME_PROTOCOL_VERSION;
  readonly sourceProtocolVersion: number;
  /** 入口流程;跨流程调用时 `flow` 会变,这个始终是最初进入的那个 */
  readonly rootFlow: RtFlow;
  /** 当前所在流程(R19-2 jump / call 会切换) */
  flow: RtFlow;
  /** R19-2 调用栈:栈顶是最近一次 call 的返回点 */
  callStack: RuntimeFrame[] = [];
  /** R19-3:非 null 表示演出正停在一个外部事件上,等宿主 resolveExternal */
  pendingExternal: PendingExternal | null = null;
  /** R19-3 重入保护:visit 循环内时,resolveExternal 只记状态,由循环自己继续 */
  private walking = false;
  readonly log: RuntimeBeat[] = [];
  readonly events: RuntimeEvent[] = [];
  choices: RuntimeChoice[] = [];
  ended = false;
  vars: Record<string, VarValue> = {};
  entityProps: Record<string, Record<string, VarValue>> = {};
  seed: number;

  private readonly project: RtProject;
  private readonly options: FlowRuntimeOptions;
  private rng: () => number;
  private rolls = 0;
  private curPath: string[] = [];
  private readonly seen = new Set<string>();
  private readonly taken = new Set<string>();
  private readonly checks = new Map<string, boolean>();
  private readonly techToId = new Map<string, string>();
  private readonly entityById: Map<string, RtEntity>;

  /** flowRef 可以是流程 id 或技术名 */
  constructor(project: RtProject, flowRef: string, options: FlowRuntimeOptions = {}) {
    this.project = project;
    this.options = options;
    this.sourceProtocolVersion = Number.isInteger(project.runtimeProtocolVersion) && project.runtimeProtocolVersion! > 0
      ? project.runtimeProtocolVersion!
      : 1;
    const flow = project.flows.find((f) => f.id === flowRef || (f.technicalName && f.technicalName === flowRef));
    if (!flow) throw new Error(`流程不存在:${flowRef}`);
    this.rootFlow = flow;
    this.flow = flow;
    this.seed = options.seed ?? randomSeed();
    this.rng = mulberry32(this.seed);
    this.entityById = new Map((project.entities ?? []).map((e) => [e.id, e]));
    // R19-2:seen() 目标可能落在被调流程里,技术名索引覆盖全部流程
    // (技术名项目内唯一,由 audit 的重复技术名检查保证)
    const walk = (sub: RtSub) => {
      for (const n of sub.nodes) {
        if (n.data.technicalName) this.techToId.set(n.data.technicalName, n.id);
        if (n.data.sub) walk(n.data.sub);
      }
    };
    for (const f of project.flows) walk(f);
  }

  /** R19-2:按技术名或 id 找流程 */
  private findFlow(ref: string): RtFlow | undefined {
    return this.project.flows.find((f) => f.id === ref || (f.technicalName && f.technicalName === ref));
  }

  /**
   * R19-2:解析目标流程的入口节点。
   * 指定 entryKey 时必须命中命名入口;否则退回默认起点(唯一无入边节点)。
   * 返回 null 表示无法进入(目标空流程或入口不存在),调用方按"就地结束"处理。
   */
  private resolveEntry(flow: RtFlow, entryKey?: string): { nodeId: string; params: RtParam[] } | null {
    if (entryKey) {
      const entry = (flow.entries ?? []).find((e) => e.key === entryKey);
      if (!entry || !flow.nodes.some((n) => n.id === entry.nodeId)) return null;
      return { nodeId: entry.nodeId, params: entry.params ?? [] };
    }
    const starts = startNodes(flow);
    if (starts.length === 0) return null;
    return { nodeId: starts[0].id, params: [] };
  }

  /**
   * R19-2:按目标入口的参数声明绑定实参。
   * 返回被覆盖变量的原值,供 call 弹栈时还原(jump 不还原)。
   */
  private bindArgs(
    params: RtParam[],
    args: { name: string; expr: string }[] | undefined,
    ctx: EvalCtx,
  ): { name: string; value: VarValue | null }[] {
    const saved: { name: string; value: VarValue | null }[] = [];
    if (params.length === 0) return saved;
    const byName = new Map((args ?? []).map((a) => [a.name, a.expr]));
    for (const p of params) {
      saved.push({ name: p.name, value: p.name in this.vars ? this.vars[p.name] : null });
      const expr = byName.get(p.name);
      let value: VarValue;
      if (expr !== undefined && expr.trim()) {
        // 布尔与数值走表达式求值;文本参数直接取字面量,避免把普通文案当标识符
        if (p.type === 'boolean') value = evalCondition(expr, this.vars, ctx) ?? false;
        else if (p.type === 'number') value = evalNumber(expr, this.vars, ctx);
        else value = expr;
      } else {
        // 未传实参 → 用声明的默认值,空默认值按类型取零值
        value = coerceVar(p.type, p.default ?? '');
      }
      this.vars[p.name] = value;
    }
    return saved;
  }

  /** R19-2:弹栈还原参数原值 */
  private restoreParams(saved: { name: string; value: VarValue | null }[]) {
    for (const s of saved) {
      if (s.value === null) delete this.vars[s.name];
      else this.vars[s.name] = s.value;
    }
  }

  /** 开始(或重新开始)演出;传 seed 可复现同一次掷骰序列 */
  start(startNodeId?: string, seed?: number) {
    this.seed = seed ?? this.seed;
    this.rng = mulberry32(this.seed);
    this.rolls = 0;
    this.log.length = 0;
    this.events.length = 0;
    this.choices = [];
    this.ended = false;
    this.curPath = [];
    this.flow = this.rootFlow;
    this.callStack = [];
    this.pendingExternal = null;
    this.seen.clear();
    this.taken.clear();
    this.checks.clear();
    this.entityProps = buildEntityProps(
      (this.project.entities ?? []).map((e) => ({ id: e.id, technicalName: e.technicalName, fields: e.fields ?? [] })),
    );
    this.vars = {};
    for (const v of this.project.variables ?? []) this.vars[v.name] = coerceVar(v.type, v.value);

    if (startNodeId && this.flow.nodes.some((n) => n.id === startNodeId)) {
      this.visit([], startNodeId, { choiceKey: `start:${startNodeId}` });
      return;
    }
    // R19-2:startNodeId 也可以是命名入口的 key
    if (startNodeId) {
      const entry = (this.flow.entries ?? []).find((e) => e.key === startNodeId);
      if (entry && this.flow.nodes.some((n) => n.id === entry.nodeId)) {
        this.bindArgs(entry.params ?? [], undefined, this.ctx());
        this.visit([], entry.nodeId, { choiceKey: `entry:${entry.key}` });
        return;
      }
    }
    const starts = startNodes(this.flow);
    if (starts.length === 0) { this.ended = true; return; }
    if (starts.length === 1) {
      this.visit([], starts[0].id, { choiceKey: `start:${starts[0].id}` });
      return;
    }
    this.choices = starts.map((s) => ({
      label: s.data.title || NODE_LABEL[s.type] || s.type,
      choiceKey: `start:${s.id}`,
      nodeId: s.id,
    }));
  }

  /** 选择当前选项(按下标) */
  choose(index: number) {
    const c = this.choices[index];
    if (!c || !c.nodeId || this.ended) return;
    const beforeVars = structuredClone(this.vars);
    const beforeEntities = structuredClone(this.entityProps);
    if (c.edgeId && c.once) this.taken.add(c.edgeId);
    if (c.effect) applyInstructions(c.effect, this.vars, this.ctx());
    this.visit(
      this.curPath,
      c.nodeId,
      { edgeId: c.edgeId, choiceKey: c.choiceKey },
      stateChanges(beforeVars, beforeEntities, this.vars, this.entityProps),
    );
  }

  /* ---------- 存档 ---------- */

  snapshot(): RuntimeSnapshot {
    return structuredClone({
      seed: this.seed,
      rolls: this.rolls,
      vars: this.vars,
      seen: [...this.seen],
      taken: [...this.taken],
      checks: [...this.checks.entries()],
      entityProps: this.entityProps,
      curPath: this.curPath,
      choices: this.choices,
      ended: this.ended,
      log: this.log,
      events: this.events,
      flowId: this.flow.id,
      callStack: this.callStack,
      pendingExternal: this.pendingExternal,
    });
  }

  restore(snap: RuntimeSnapshot) {
    const s = structuredClone(snap);
    this.seed = s.seed;
    this.rng = resumeRng(s.seed, s.rolls);
    this.rolls = s.rolls;
    this.vars = s.vars;
    this.seen.clear();
    for (const id of s.seen) this.seen.add(id);
    this.taken.clear();
    for (const id of s.taken) this.taken.add(id);
    this.checks.clear();
    for (const [k, v] of s.checks) this.checks.set(k, v);
    this.entityProps = s.entityProps;
    this.curPath = s.curPath;
    // R19-2:旧存档没有 flowId / callStack,按入口流程 + 空栈恢复
    this.flow = (s.flowId && this.project.flows.find((f) => f.id === s.flowId)) || this.rootFlow;
    this.callStack = s.callStack ?? [];
    this.pendingExternal = s.pendingExternal ?? null;
    this.choices = s.choices.map((choice) => ({
      ...choice,
      choiceKey: choice.choiceKey ?? (choice.edgeId ? `edge:${choice.edgeId}` : `start:${choice.nodeId ?? 'none'}`),
    }));
    this.ended = s.ended;
    this.log.length = 0;
    this.log.push(...s.log);
    this.events.length = 0;
    this.events.push(...(s.events ?? []));
  }

  /* ---------- 内部 ---------- */

  private ctx(): EvalCtx {
    return {
      seen: (tn) => this.seen.has(this.techToId.get(tn) ?? '__none__'),
      entityProps: this.entityProps,
    };
  }

  private container(path: string[]): RtSub {
    return resolveSub(this.flow, path) ?? { nodes: [], edges: [] };
  }

  private pushBeat(beat: RuntimeBeat) {
    this.log.push(beat);
    this.options.onBeat?.(beat);
  }

  private pushEvent(
    event: RuntimeEvent['event'],
    path: string[],
    node: RtNode,
    trigger: { edgeId?: string; choiceKey?: string },
    changes: RuntimeChanges,
    note?: string,
  ) {
    const speaker = node.data.speakerId ? this.entityById.get(node.data.speakerId) : undefined;
    const out: RuntimeEvent = {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      sourceProtocolVersion: this.sourceProtocolVersion,
      event,
      flowId: this.flow.id,
      nodeId: node.id,
      path: [...path],
      nodeType: node.type,
      kind: node.type,
      title: node.data.title ?? '',
      text: node.data.text ?? '',
      fields: Array.isArray(node.data.fields)
        ? structuredClone(node.data.fields as { label: string; value: string; type?: string }[])
        : [],
      assetIds: [...(this.project.attachments?.[node.id] ?? [])],
      changes: structuredClone(changes),
    };
    if (this.flow.technicalName) out.flowTechnicalName = this.flow.technicalName;
    if (node.data.technicalName) out.nodeTechnicalName = node.data.technicalName;
    if (speaker?.id) out.speakerId = speaker.id;
    if (speaker?.name) out.speakerName = speaker.name;
    if (trigger.edgeId) out.edgeId = trigger.edgeId;
    if (trigger.choiceKey) out.choiceKey = trigger.choiceKey;
    if (note) out.note = note;
    this.events.push(out);
    this.options.onEvent?.(out);
  }

  /** 节点出边 → 选项;无出边逐层回溯;exit 走父层片段命名引脚 */
  private outgoingChoices(path: string[], node: RtNode): { choices: RuntimeChoice[]; path: string[] } {
    let curP = [...path];
    let cur: RtNode | undefined = node;
    let exitId: string | null = null;
    const ctx = this.ctx();
    for (let guard = 0; guard < 64; guard++) {
      if (cur?.type === 'exit' && curP.length > 0) {
        exitId = cur.id;
        const fragId = curP[curP.length - 1];
        curP = curP.slice(0, -1);
        cur = this.container(curP).nodes.find((n) => n.id === fragId);
      }
      const c = this.container(curP);
      const all = cur ? c.edges.filter((e) => e.source === cur!.id) : [];
      const { usable: finalUsable } = selectOutgoing(all, {
        exitId,
        nodeType: cur?.type,
        condResult: cur?.type === 'condition' ? evalCondition(cur.data.text ?? '', this.vars, ctx) : undefined,
        checkPassed: cur ? this.checks.get(cur.id) ?? false : false,
        isTaken: (id) => this.taken.has(id),
        edgeAllowed: (cond) => evalCondition(cond, this.vars, ctx) !== false,
      });
      exitId = null;
      if (finalUsable.length > 0) {
        return {
          path: curP,
          choices: finalUsable.map((e) => {
            const target = c.nodes.find((n) => n.id === e.target);
            return {
              label: (typeof e.label === 'string' && e.label) || target?.data.title || (target ? NODE_LABEL[target.type] ?? '继续' : '继续'),
              nodeId: e.target,
              edgeId: e.id,
              choiceKey: e.choiceId || `edge:${e.id}`,
              effect: e.effect,
              once: e.once,
            };
          }),
        };
      }
      if (curP.length === 0) return { path: curP, choices: [] };
      const fragId = curP[curP.length - 1];
      curP = curP.slice(0, -1);
      cur = this.container(curP).nodes.find((n) => n.id === fragId);
    }
    return { path: curP, choices: [] };
  }

  /**
   * R19-2:弹出一个调用帧,回到调用点。
   * 顺序要求:先还原参数原值,再写返回值 —— 返回值变量可能与参数同名,应由返回值胜出。
   * 返回 null 表示栈空或调用点已失效(流程被删),调用方按结束处理。
   */
  private popFrame(returnValue: VarValue | null): { node: RtNode; path: string[] } | null {
    const frame = this.callStack.pop();
    if (!frame) return null;
    this.restoreParams(frame.savedParams);
    const flow = this.project.flows.find((f) => f.id === frame.flowId);
    if (!flow) return null;
    this.flow = flow;
    if (frame.returnVar && returnValue !== null) this.vars[frame.returnVar] = returnValue;
    const node = this.container(frame.path).nodes.find((n) => n.id === frame.nodeId);
    if (!node) return null;
    return { node, path: [...frame.path] };
  }

  /**
   * 从 node 的出边继续行进。
   * 无出边时:R19-2 调用栈非空 → 隐式返回并从调用点继续;栈空 → 演出结束。
   * 返回 null 表示本次行进到此为止(方法内已设置 choices / ended)。
   */
  private advanceFrom(
    path: string[],
    node: RtNode,
    autoAdvance: boolean,
  ): { id: string | null; trigger: { edgeId?: string; choiceKey?: string }; changes: RuntimeChanges; path: string[] } | null {
    let curNode = node;
    let curP = path;
    let auto = autoAdvance;
    for (let guard = 0; guard <= MAX_CALL_DEPTH; guard++) {
      const { choices: cs, path: outP } = this.outgoingChoices(curP, curNode);
      curP = outP;
      if (cs.length === 0) {
        const resumed = this.popFrame(null);
        if (!resumed) { this.curPath = curP; this.choices = []; this.ended = true; return null; }
        curNode = resumed.node;
        curP = resumed.path;
        auto = true;
        continue;
      }
      if (cs.length === 1 && auto) {
        const c0 = cs[0];
        const beforeVars = structuredClone(this.vars);
        const beforeEntities = structuredClone(this.entityProps);
        if (c0.edgeId && c0.once) this.taken.add(c0.edgeId);
        if (c0.effect) applyInstructions(c0.effect, this.vars, this.ctx());
        return {
          id: c0.nodeId,
          trigger: { edgeId: c0.edgeId, choiceKey: c0.choiceKey },
          changes: stateChanges(beforeVars, beforeEntities, this.vars, this.entityProps),
          path: curP,
        };
      }
      this.curPath = curP;
      this.choices = cs;
      return null;
    }
    this.curPath = curP;
    this.choices = [];
    this.ended = true;
    return null;
  }

  /**
   * R19-3:宿主完成外部事件后调用,演出从事件节点的出边继续。
   * `value` 仅在 wait='value' 且节点配了接收变量时写入。
   * 返回 false 表示当前并没有挂起的事件(重复调用是安全的)。
   */
  resolveExternal(value?: VarValue): boolean {
    const pending = this.pendingExternal;
    if (!pending) return false;
    this.pendingExternal = null;
    if (pending.resultVar && value !== undefined) this.vars[pending.resultVar] = value;
    // 宿主在 onExternalEvent 里同步调用:交回正在跑的 visit 循环继续,避免重入
    if (this.walking) return true;
    const flow = this.project.flows.find((f) => f.id === pending.flowId);
    if (!flow) { this.ended = true; return true; }
    this.flow = flow;
    const node = this.container(pending.path).nodes.find((n) => n.id === pending.nodeId);
    if (!node) { this.ended = true; return true; }
    const next = this.advanceFrom(pending.path, node, true);
    if (!next || !next.id) return true;
    this.visit(next.path, next.id, next.trigger, next.changes);
    return true;
  }

  /** 进入并展示一个节点,自动处理直通型节点 */
  private visit(
    path: string[],
    nodeId: string,
    initialTrigger: { edgeId?: string; choiceKey?: string } = {},
    initialChanges: RuntimeChanges = EMPTY_CHANGES(),
  ) {
    const outerWalking = this.walking;
    this.walking = true;
    try {
      this.visitInner(path, nodeId, initialTrigger, initialChanges);
    } finally {
      this.walking = outerWalking;
    }
  }

  private visitInner(
    path: string[],
    nodeId: string,
    initialTrigger: { edgeId?: string; choiceKey?: string } = {},
    initialChanges: RuntimeChanges = EMPTY_CHANGES(),
  ) {
    let curP = [...path];
    let id: string | null = nodeId;
    let trigger = initialTrigger;
    let enterChanges = initialChanges;

    for (let guard = 0; guard < 100 && id; guard++) {
      const c = this.container(curP);
      const node = c.nodes.find((n) => n.id === id);
      if (!node) break;
      this.pushEvent('enter', curP, node, trigger, enterChanges);
      this.seen.add(id);
      const ctx = this.ctx();
      const speaker = node.data.speakerId ? this.entityById.get(node.data.speakerId) : undefined;
      const beforeVars = structuredClone(this.vars);
      const beforeEntities = structuredClone(this.entityProps);
      let displayNote: string | undefined;
      let nestedStarts: RtNode[] | null = null;
      let nestedPath: string[] | null = null;
      // R19-2:本节点是否要切到别的流程 / 弹栈返回
      let crossTarget: { flow: RtFlow; nodeId: string } | null = null;
      let doReturn = false;
      let returnValue: VarValue | null = null;
      // R19-3:非 null 表示本节点要挂起等宿主
      let suspend: PendingExternal | null = null;

      switch (node.type) {
        case 'dialogue':
          this.pushBeat({
            kind: 'dialogue', title: node.data.title ?? '', text: node.data.text ?? '',
            speakerId: speaker?.id, speakerName: speaker?.name,
          });
          break;
        case 'fragment': {
          this.pushBeat({ kind: 'fragment', title: node.data.title || '剧情片段', text: node.data.text ?? '' });
          const sub = node.data.sub;
          if (sub && sub.nodes.length > 0) {
            nestedPath = [...curP, node.id];
            nestedStarts = startNodes(sub);
          }
          break;
        }
        case 'hub':
          if (node.data.title) this.pushBeat({ kind: 'hub', title: node.data.title, text: '' });
          break;
        case 'instruction': {
          const warnings = applyInstructions(node.data.text ?? '', this.vars, ctx);
          this.pushBeat({
            kind: 'instruction', title: node.data.title || '指令', text: node.data.text ?? '',
            note: warnings.length ? warnings.join(';') : undefined,
          });
          displayNote = warnings.length ? warnings.join(';') : undefined;
          break;
        }
        case 'condition': {
          const result = evalCondition(node.data.text ?? '', this.vars, ctx);
          this.pushBeat({
            kind: 'condition', title: node.data.title || '条件分支', text: node.data.text ?? '',
            note: result === null ? '无法求值,请手动选择分支' : result ? '→ 真' : '→ 假',
          });
          displayNote = result === null ? '无法求值,请手动选择分支' : result ? '→ 真' : '→ 假';
          break;
        }
        case 'jump':
        case 'call': {
          const isCall = node.type === 'call';
          const targetRef = (node.data.targetFlow ?? '').trim();
          if (!targetRef) {
            // 无目标 = R19-2 之前的装饰性跳转:只留一条 beat,继续走出边
            this.pushBeat({ kind: node.type, title: node.data.title || '跳转', text: node.data.text ?? '' });
            break;
          }
          const target = this.findFlow(targetRef);
          const entry = target ? this.resolveEntry(target, node.data.targetEntry) : null;
          if (!target || !entry) {
            const why = !target ? `目标流程不存在:${targetRef}` : `目标入口不存在:${node.data.targetEntry || '默认起点'}`;
            this.pushBeat({ kind: node.type, title: node.data.title || (isCall ? '调用' : '跳转'), text: node.data.text ?? '', note: why });
            displayNote = why;
            break;
          }
          if (isCall) {
            if (this.callStack.length >= MAX_CALL_DEPTH) {
              const why = `调用深度超过 ${MAX_CALL_DEPTH} 层,已停止(可能是无限递归)`;
              this.pushBeat({ kind: 'call', title: node.data.title || '调用', text: node.data.text ?? '', note: why });
              displayNote = why;
              break;
            }
            const saved = this.bindArgs(entry.params, node.data.args, ctx);
            this.callStack.push({
              flowId: this.flow.id,
              path: [...curP],
              nodeId: node.id,
              returnVar: node.data.returnVar,
              savedParams: saved,
            });
          } else {
            // jump 不返回,参数直接写入(不记录还原)
            this.bindArgs(entry.params, node.data.args, ctx);
          }
          const label = target.name || target.technicalName || targetRef;
          const note = `${isCall ? '调用' : '跳转'} → ${label}${node.data.targetEntry ? ` · ${node.data.targetEntry}` : ''}`;
          this.pushBeat({ kind: node.type, title: node.data.title || (isCall ? '调用' : '跳转'), text: node.data.text ?? '', note });
          displayNote = note;
          crossTarget = { flow: target, nodeId: entry.nodeId };
          break;
        }
        case 'event': {
          const evName = (node.data.eventName ?? '').trim();
          const decl = (this.project.externalEvents ?? []).find((e) => e.name === evName);
          if (!evName || !decl) {
            const why = evName ? `事件「${evName}」未在项目中声明,已跳过` : '未选择要请求的事件,已跳过';
            this.pushBeat({ kind: 'event', title: node.data.title || '外部事件', text: node.data.text ?? '', note: why });
            displayNote = why;
            break;
          }
          const wait = (node.data.eventWait as PendingExternal['call']['wait'] | undefined) ?? 'continue';
          // 实参按声明求值:文本取字面量,布尔与数值走表达式(与 R19-2 传参同口径)
          const byName = new Map((node.data.eventArgs ?? []).map((a) => [a.name, a.expr]));
          const args: Record<string, VarValue> = {};
          for (const prm of decl.params ?? []) {
            const expr = byName.get(prm.name);
            if (expr !== undefined && expr.trim()) {
              if (prm.type === 'boolean') args[prm.name] = evalCondition(expr, this.vars, ctx) ?? false;
              else if (prm.type === 'number') args[prm.name] = evalNumber(expr, this.vars, ctx);
              else args[prm.name] = expr;
            } else {
              args[prm.name] = coerceVar(prm.type, prm.default ?? '');
            }
          }
          const call: ExternalEventCall = {
            name: evName, args, wait,
            flowId: this.flow.id, nodeId: node.id, path: [...curP],
          };
          if (node.data.technicalName) call.nodeTechnicalName = node.data.technicalName;
          const argText = Object.entries(args).map(([k, v]) => `${k}=${String(v)}`).join(', ');
          const note = `[事件] ${decl.label || evName}${argText ? `(${argText})` : ''} · ${
            wait === 'continue' ? '立即继续' : wait === 'ack' ? '等待宿主确认' : '等待宿主返回值'}`;
          this.pushBeat({ kind: 'event', title: node.data.title || decl.label || evName, text: node.data.text ?? '', note });
          displayNote = note;
          if (wait === 'continue') {
            this.options.onExternalEvent?.(call);
          } else {
            suspend = {
              call,
              resultVar: wait === 'value' ? node.data.eventResultVar : undefined,
              flowId: this.flow.id, path: [...curP], nodeId: node.id,
            };
          }
          break;
        }
        case 'return': {
          const hasValue = typeof node.data.returnExpr === 'string' && node.data.returnExpr.trim() !== '';
          if (hasValue) returnValue = evalNumber(node.data.returnExpr, this.vars, ctx);
          this.pushBeat({
            kind: 'return', title: node.data.title || '返回', text: node.data.text ?? '',
            note: this.callStack.length === 0
              ? '调用栈为空,演出结束'
              : hasValue ? `返回值 ${returnValue}` : '返回调用点',
          });
          displayNote = this.callStack.length === 0
            ? '调用栈为空,演出结束'
            : hasValue ? `返回值 ${returnValue}` : '返回调用点';
          doReturn = true;
          break;
        }
        case 'exit':
          this.pushBeat({ kind: 'exit', title: `⇥ 经「${node.data.title || '出口'}」离开子流程`, text: '' });
          break;
        case 'check': {
          const red = node.data.checkRed === true;
          const dc = Number(node.data.checkDc ?? 10);
          let note: string;
          if (red && this.checks.has(node.id)) {
            note = `红色检定只有一次机会 → 沿用先前结果:${this.checks.get(node.id) ? '成功' : '失败'}`;
          } else {
            const skill = evalNumber(node.data.checkExpr, this.vars, ctx);
            const d1 = rollD6(this.rng);
            const d2 = rollD6(this.rng);
            this.rolls += 2;
            const passed = d1 + d2 + skill >= dc;
            this.checks.set(node.id, passed);
            note = `2d6 = ${d1}+${d2},技能 ${skill},合计 ${d1 + d2 + skill} vs 难度 ${dc} → ${passed ? '成功' : '失败'}`;
          }
          this.pushBeat({
            kind: 'check',
            title: `${red ? '红色' : '白色'}检定 · ${node.data.title || node.data.checkExpr || ''}`,
            text: node.data.text ?? '',
            note,
          });
          displayNote = note;
          break;
        }
      }

      this.pushEvent(
        'display',
        curP,
        node,
        trigger,
        stateChanges(beforeVars, beforeEntities, this.vars, this.entityProps),
        displayNote,
      );
      this.pushEvent('leave', curP, node, trigger, EMPTY_CHANGES(), displayNote);

      // R19-3:挂起等宿主。先置 pendingExternal 再通知,这样宿主可以在回调里
      // 同步调用 resolveExternal(能立即完成的动作);回调返回后若仍挂着,
      // 就停下来等异步 resolve —— 此时既不结束也不给选项。
      if (suspend) {
        this.pendingExternal = suspend;
        this.options.onExternalEvent?.(suspend.call);
        if (this.pendingExternal) {
          this.curPath = curP;
          this.choices = [];
          return;
        }
      }

      // R19-2:切到目标流程入口(jump 不返回 / call 已压栈)
      if (crossTarget) {
        this.flow = crossTarget.flow;
        curP = [];
        id = crossTarget.nodeId;
        trigger = { choiceKey: `entry:${node.data.targetEntry || crossTarget.nodeId}` };
        enterChanges = EMPTY_CHANGES();
        continue;
      }

      // R19-2:显式返回 —— 弹栈后从调用点的出边继续
      if (doReturn) {
        const resumed = this.popFrame(returnValue);
        if (!resumed) { this.curPath = curP; this.choices = []; this.ended = true; return; }
        const next = this.advanceFrom(resumed.path, resumed.node, true);
        if (!next) return;
        id = next.id;
        trigger = next.trigger;
        enterChanges = next.changes;
        curP = next.path;
        continue;
      }

      if (nestedStarts && nestedPath) {
        curP = nestedPath;
        if (nestedStarts.length === 1) {
          id = nestedStarts[0].id;
          trigger = { choiceKey: `start:${id}` };
          enterChanges = EMPTY_CHANGES();
          continue;
        }
        this.curPath = curP;
        this.choices = nestedStarts.map((s) => ({
          label: s.data.title || NODE_LABEL[s.type] || s.type,
          choiceKey: `start:${s.id}`,
          nodeId: s.id,
        }));
        return;
      }

      const next = this.advanceFrom(curP, node, AUTO_ADVANCE.has(node.type));
      if (!next) return;
      id = next.id;
      trigger = next.trigger;
      enterChanges = next.changes;
      curP = next.path;
    }

    this.choices = [];
    this.ended = true;
  }
}
