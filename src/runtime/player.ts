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
}

export interface RtSub { nodes: RtNode[]; edges: RtEdge[] }

export interface RtFlow extends RtSub {
  id: string;
  name?: string;
  technicalName?: string;
}

export interface RtVariable { name: string; type: string; value: string }

export interface RtEntity {
  id: string;
  name?: string;
  technicalName?: string;
  fields?: { label: string; value: string; type?: string }[];
}

/** 运行库的输入:引擎包或应用内项目的公共子集 */
export interface RtProject {
  flows: RtFlow[];
  variables?: RtVariable[];
  entities?: RtEntity[];
}

/* ---------- 输出类型 ---------- */

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
  /** null = 起点选择之外不会出现;正常为目标节点 id */
  nodeId: string | null;
  edgeId?: string;
  effect?: string;
  once?: boolean;
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
}

export interface FlowRuntimeOptions {
  /** 固定随机种子:同种子演出的检定掷骰序列完全一致;缺省随机 */
  seed?: number;
  /** 每产生一条演出记录时回调(引擎接管展示) */
  onBeat?: (beat: RuntimeBeat) => void;
}

/** 画布组织类节点,不参与叙事 */
const ANNOTATION = new Set(['note', 'zone']);
/** 单出边时自动前进的直通型节点 */
const AUTO_ADVANCE = new Set(['hub', 'instruction', 'condition', 'exit', 'check']);

const NODE_LABEL: Record<string, string> = {
  dialogue: '对白', fragment: '剧情片段', hub: '汇聚点', condition: '条件分支',
  instruction: '指令', jump: '跳转', exit: '出口', check: '检定',
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

export class FlowRuntime {
  readonly flow: RtFlow;
  readonly log: RuntimeBeat[] = [];
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
    const flow = project.flows.find((f) => f.id === flowRef || (f.technicalName && f.technicalName === flowRef));
    if (!flow) throw new Error(`流程不存在:${flowRef}`);
    this.flow = flow;
    this.seed = options.seed ?? randomSeed();
    this.rng = mulberry32(this.seed);
    this.entityById = new Map((project.entities ?? []).map((e) => [e.id, e]));
    const walk = (sub: RtSub) => {
      for (const n of sub.nodes) {
        if (n.data.technicalName) this.techToId.set(n.data.technicalName, n.id);
        if (n.data.sub) walk(n.data.sub);
      }
    };
    walk(flow);
  }

  /** 开始(或重新开始)演出;传 seed 可复现同一次掷骰序列 */
  start(startNodeId?: string, seed?: number) {
    this.seed = seed ?? this.seed;
    this.rng = mulberry32(this.seed);
    this.rolls = 0;
    this.log.length = 0;
    this.choices = [];
    this.ended = false;
    this.curPath = [];
    this.seen.clear();
    this.taken.clear();
    this.checks.clear();
    this.entityProps = buildEntityProps(
      (this.project.entities ?? []).map((e) => ({ id: e.id, technicalName: e.technicalName, fields: e.fields ?? [] })),
    );
    this.vars = {};
    for (const v of this.project.variables ?? []) this.vars[v.name] = coerceVar(v.type, v.value);

    if (startNodeId && this.flow.nodes.some((n) => n.id === startNodeId)) {
      this.visit([], startNodeId);
      return;
    }
    const starts = startNodes(this.flow);
    if (starts.length === 0) { this.ended = true; return; }
    if (starts.length === 1) { this.visit([], starts[0].id); return; }
    this.choices = starts.map((s) => ({ label: s.data.title || NODE_LABEL[s.type] || s.type, nodeId: s.id }));
  }

  /** 选择当前选项(按下标) */
  choose(index: number) {
    const c = this.choices[index];
    if (!c || !c.nodeId || this.ended) return;
    if (c.edgeId && c.once) this.taken.add(c.edgeId);
    if (c.effect) applyInstructions(c.effect, this.vars, this.ctx());
    this.visit(this.curPath, c.nodeId);
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
    this.choices = s.choices;
    this.ended = s.ended;
    this.log.length = 0;
    this.log.push(...s.log);
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
      let edges = cur ? c.edges.filter((e) => e.source === cur!.id) : [];
      if (exitId) {
        const named = edges.filter((e) => e.sourceHandle === `exit:${exitId}`);
        edges = named.length > 0 ? named : edges.filter((e) => !e.sourceHandle);
        exitId = null;
      } else if (cur?.type === 'fragment') {
        edges = edges.filter((e) => !e.sourceHandle);
      }
      if (cur?.type === 'condition') {
        const result = evalCondition(cur.data.text ?? '', this.vars, ctx);
        if (result !== null) {
          const want = result ? 'true' : 'false';
          const picked = edges.filter((e) => e.sourceHandle === want);
          edges = picked.length > 0 ? picked : [];
        }
        // null:无法求值 → 保留全部引脚交由调用方选择
      }
      if (cur?.type === 'check') {
        const passed = this.checks.get(cur.id) ?? false;
        const want = passed ? 'success' : 'fail';
        const picked = edges.filter((e) => e.sourceHandle === want);
        edges = picked.length > 0 ? picked : [];
      }
      const usable = edges.filter((e) =>
        !(e.once && this.taken.has(e.id)) &&
        (!e.condition || evalCondition(e.condition, this.vars, ctx) !== false),
      );
      const nonFallback = usable.filter((e) => !e.fallback);
      const finalUsable = nonFallback.length > 0 ? nonFallback : usable;
      if (finalUsable.length > 0) {
        return {
          path: curP,
          choices: finalUsable.map((e) => {
            const target = c.nodes.find((n) => n.id === e.target);
            return {
              label: (typeof e.label === 'string' && e.label) || target?.data.title || (target ? NODE_LABEL[target.type] ?? '继续' : '继续'),
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
      cur = this.container(curP).nodes.find((n) => n.id === fragId);
    }
    return { path: curP, choices: [] };
  }

  /** 进入并展示一个节点,自动处理直通型节点 */
  private visit(path: string[], nodeId: string) {
    let curP = [...path];
    let id: string | null = nodeId;

    for (let guard = 0; guard < 100 && id; guard++) {
      const c = this.container(curP);
      const node = c.nodes.find((n) => n.id === id);
      if (!node) break;
      this.seen.add(id);
      const ctx = this.ctx();
      const speaker = node.data.speakerId ? this.entityById.get(node.data.speakerId) : undefined;

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
            curP = [...curP, node.id];
            const starts = startNodes(sub);
            if (starts.length === 1) { id = starts[0].id; continue; }
            this.curPath = curP;
            this.choices = starts.map((s) => ({ label: s.data.title || NODE_LABEL[s.type] || s.type, nodeId: s.id }));
            return;
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
          break;
        }
        case 'condition': {
          const result = evalCondition(node.data.text ?? '', this.vars, ctx);
          this.pushBeat({
            kind: 'condition', title: node.data.title || '条件分支', text: node.data.text ?? '',
            note: result === null ? '无法求值,请手动选择分支' : result ? '→ 真' : '→ 假',
          });
          break;
        }
        case 'jump':
          this.pushBeat({ kind: 'jump', title: node.data.title || '跳转', text: node.data.text ?? '' });
          break;
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
          break;
        }
      }

      const { choices: cs, path: outP } = this.outgoingChoices(curP, node);
      curP = outP;

      if (cs.length === 0) {
        this.curPath = curP;
        this.choices = [];
        this.ended = true;
        return;
      }
      if (cs.length === 1 && AUTO_ADVANCE.has(node.type)) {
        const c0 = cs[0];
        if (c0.edgeId && c0.once) this.taken.add(c0.edgeId);
        if (c0.effect) applyInstructions(c0.effect, this.vars, this.ctx());
        id = c0.nodeId;
        continue;
      }
      this.curPath = curP;
      this.choices = cs;
      return;
    }

    this.choices = [];
    this.ended = true;
  }
}
