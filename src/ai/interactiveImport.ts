import type { Flow, FlowEdge, FlowNode, Project, Variable, VariableType } from '../types';
import { normalizeProject, sanitizeTechnicalName, uid } from '../util';
import { auditProject } from '../audit';
import { simulateFlow } from '../simulate';
import {
  buildProjectImportPreview, normalizeGenerated, normalizePlan,
  applyProjectImport,
  type GeneratedData, type ImportPlan, type PendingIssue, type ProjectImportPreview, type SourceMaterial,
} from './projectImport';

/**
 * R10-A5 完整互动项目生成。
 * 在 R5-A 小说管线(卷章 / 场景 / 实体 / 规划 / 时间线)之上叠加互动层:
 * 流程节点、选择、技术名、变量、条件 / 指令 / 检定与 fallback。
 * 铁律:生成结果必须通过 R6 脚本检查、R10 高级体检(内置全项目路径测试)
 * 与结局可达性验收后才允许事务式导入;blocked 状态没有导入按钮。
 */

/* ---------- 配置 ---------- */

export interface InteractiveOptions {
  /** 分支密度:轻(章末抉择)/ 中(场景级分支)/ 重(密集分支与回路) */
  branchDensity: 'light' | 'medium' | 'heavy';
  /** 目标结局数(2-6) */
  endings: number;
  /** 使用 2d6 检定节点 */
  useChecks: boolean;
  /** 失败回路:retry = 失败回到抉择点重试;branch = 失败走独立分支继续 */
  failMode: 'retry' | 'branch';
}

export const BRANCH_DENSITY_LABEL: Record<InteractiveOptions['branchDensity'], string> = {
  light: '轻(章末抉择)',
  medium: '中(场景级分支)',
  heavy: '重(密集分支与回路)',
};

export const FAIL_MODE_LABEL: Record<InteractiveOptions['failMode'], string> = {
  retry: '失败回到抉择点(回路)',
  branch: '失败走独立分支',
};

export function defaultInteractiveOptions(): InteractiveOptions {
  return { branchDensity: 'medium', endings: 3, useChecks: true, failMode: 'branch' };
}

/* ---------- 阶段一:互动计划扩展 ---------- */

export interface PlanVariable {
  name: string;
  type: VariableType;
  value: string;
  description: string;
}
export interface PlanEnding {
  title: string;
  technicalName: string;
  summary: string;
}
export interface InteractiveExtrasPlan {
  variables: PlanVariable[];
  endings: PlanEnding[];
}

const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SCRIPT_GUIDE = `脚本语法(严格遵守,超出语法的表达式会被类型检查拒绝):
- 条件:变量与比较运算,如 trust > 3 && met_ghost、courage >= 2 || flag
- 指令:赋值语句,分号分隔,如 trust = trust + 1; met_ghost = true
- 走过判断:seen("节点技术名") / unseen("节点技术名")
- 变量名只能是英文字母 / 数字 / 下划线,且在 variables 里声明过
- 不要使用未声明的变量、函数或中文变量名`;

export function buildInteractivePlanPrompt(options: InteractiveOptions): string {
  return `你是叙事设计工具的互动剧本规划助手。用户提供多份带来源标注的材料(正文 / 设定 / 笔记 / AI 咨询记录,各自标注了可信度)。
你的任务是产出一份「互动项目生成计划」供用户审阅,不生成正文细节。严格输出以下 JSON,不要输出任何 JSON 以外的内容:

{
  "projectName": "作品名",
  "summary": "两三句话的故事概述",
  "volumes": [{ "title": "卷名(单卷作品只输出一卷)", "chapters": [{ "title": "章名", "scenes": ["场景标题", "…"] }] }],
  "entities": [{ "kind": "character|location|item|faction|concept", "name": "名称", "brief": "一句话" }],
  "timelineTracks": ["时间线轨道名"],
  "variables": [{ "name": "英文变量名", "type": "boolean|number|string", "value": "初始值", "description": "用途说明" }],
  "endings": [{ "title": "结局名", "technicalName": "英文技术名", "summary": "达成条件概述" }],
  "pending": [{ "topic": "存在分歧或未定稿的问题", "options": [{ "claim": "一种说法", "source": "出处材料名", "evidence": "原文短引" }] }]
}

规则:
- 结构以「正文」类材料为权威;「AI 咨询记录」与「草案」的冲突方案一律进 pending
- 变量服务于分支与结局判定:数量克制(3-8 个),每个都要在结局条件概述里用得上
- 结局数量目标:${options.endings} 个;分支密度:${BRANCH_DENSITY_LABEL[options.branchDensity]}
- ${options.useChecks ? '可以规划 2d6 检定点(冒险 / 对抗 / 说服等场合)' : '不使用检定,分支全部由选择与变量驱动'}
- 变量名与结局技术名只能是英文字母 / 数字 / 下划线
- 只抽取材料中存在的信息;没有的类别输出空数组`;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function normalizeInteractivePlan(raw: unknown): { plan: ImportPlan; extras: InteractiveExtrasPlan; warnings: string[] } {
  const { plan, warnings } = normalizePlan(raw);
  const o = (raw ?? {}) as Record<string, unknown>;
  const extras: InteractiveExtrasPlan = { variables: [], endings: [] };

  for (const v of Array.isArray(o.variables) ? o.variables : []) {
    const vo = v as Record<string, unknown>;
    const name = str(vo.name);
    if (!name) continue;
    if (!VAR_NAME_RE.test(name)) { warnings.push(`变量名「${name}」不合法(需英文标识符),已丢弃`); continue; }
    const type = str(vo.type) as VariableType;
    if (extras.variables.some((x) => x.name === name)) continue;
    extras.variables.push({
      name,
      type: type === 'number' || type === 'string' ? type : 'boolean',
      value: str(vo.value) || (type === 'number' ? '0' : type === 'string' ? '' : 'false'),
      description: str(vo.description),
    });
  }

  const usedTech = new Set<string>();
  for (const e of Array.isArray(o.endings) ? o.endings : []) {
    const eo = e as Record<string, unknown>;
    const title = str(eo.title);
    if (!title) continue;
    let tech = sanitizeTechnicalName(str(eo.technicalName) || `ending_${extras.endings.length + 1}`);
    if (!tech) tech = `ending_${extras.endings.length + 1}`;
    while (usedTech.has(tech)) tech = `${tech}_x`;
    usedTech.add(tech);
    extras.endings.push({ title, technicalName: tech, summary: str(eo.summary) });
  }
  if (extras.endings.length === 0) warnings.push('计划中没有结局;互动项目至少需要一个结局');

  return { plan, extras, warnings };
}

/* ---------- 阶段二:互动生成扩展 ---------- */

export interface GenFlowNodeIn {
  id: string;
  type: 'dialogue' | 'hub' | 'condition' | 'instruction' | 'check';
  title: string;
  text: string;
  speaker?: string;
  technicalName?: string;
  checkExpr?: string;
  checkDc?: number;
  checkRed?: boolean;
  /** 结局技术名:该节点是对应结局的终点 */
  ending?: string;
}
export interface GenFlowEdgeIn {
  from: string;
  to: string;
  handle?: 'true' | 'false' | 'success' | 'fail';
  label?: string;
  condition?: string;
  effect?: string;
  once?: boolean;
  fallback?: boolean;
}
export interface GenFlowIn {
  name: string;
  technicalName: string;
  nodes: GenFlowNodeIn[];
  edges: GenFlowEdgeIn[];
}
export interface InteractiveGenerated {
  base: GeneratedData;
  variables: PlanVariable[];
  flows: GenFlowIn[];
  /** 结局技术名 → 节点 id(生成侧 id) */
  endingNodes: { technicalName: string; title: string; flow: string; node: string }[];
}

export function buildInteractiveGeneratePrompt(plan: ImportPlan, extras: InteractiveExtrasPlan, options: InteractiveOptions): string {
  const failRule = options.failMode === 'retry'
    ? '失败后用一条边连回抉择 / 检定前的节点形成重试回路(注意用变量或一次性选项防止无限死循环)'
    : '失败走独立的失败分支继续叙事,不回头';
  return `你是叙事设计工具的互动剧本生成助手。用户已审阅通过「互动项目生成计划」,现在按计划从材料生成完整候选数据。
严格输出以下 JSON,不要输出任何 JSON 以外的内容:

{
  "structure": [{ "title": "卷名", "chapters": [{ "title": "章名", "scenes": [
    { "title": "场景标题", "pov": "视角角色名或空串", "location": "地点名或空串", "time": "故事时间或空串",
      "blocks": [{ "type": "heading|action|dialogue", "speaker": "说话人名(仅 dialogue)", "text": "…" }],
      "source": "出处材料名" } ] }] }],
  "entities": [{ "kind": "character|location|item|faction|concept", "name": "名称", "summary": "简介",
    "fields": [{ "label": "字段名", "value": "值" }], "source": "出处材料名", "evidence": "原文短引" }],
  "relations": [{ "from": "实体名", "to": "实体名", "label": "关系名", "bidirectional": true }],
  "arcs": [], "foreshadows": [], "outline": [{ "no": "1", "title": "章名", "time": "", "main": "一句话" }],
  "timelinePoints": ["时间点"], "timelineEvents": [{ "point": "时间点", "title": "事件", "text": "", "entities": [] }],
  "brainstorm": [],
  "variables": [{ "name": "英文变量名", "type": "boolean|number|string", "value": "初始值", "description": "" }],
  "flows": [{
    "name": "流程名(通常一章一条)", "technicalName": "英文技术名",
    "nodes": [
      { "id": "n1", "type": "dialogue", "title": "标题", "text": "对白或叙述", "speaker": "说话人名或空" },
      { "id": "n2", "type": "hub", "title": "抉择:走哪边?" },
      { "id": "n3", "type": "condition", "text": "trust > 2" },
      { "id": "n4", "type": "instruction", "text": "trust = trust + 1" },
      ${options.useChecks ? '{ "id": "n5", "type": "check", "title": "说服守卫", "checkExpr": "courage", "checkDc": 8, "checkRed": false },' : ''}
      { "id": "n9", "type": "dialogue", "title": "结局名", "text": "结局描写", "ending": "结局技术名" }
    ],
    "edges": [
      { "from": "n1", "to": "n2" },
      { "from": "n2", "to": "n3", "label": "选项文字", "effect": "trust = trust + 1", "once": false },
      { "from": "n3", "to": "n4", "handle": "true" },
      { "from": "n3", "to": "n9", "handle": "false" },
      { "from": "n2", "to": "n9", "fallback": true, "label": "兜底" }
    ]
  }],
  "endingNodes": [{ "technicalName": "结局技术名", "title": "结局名", "flow": "流程技术名", "node": "节点 id" }],
  "pending": [{ "topic": "待定问题", "options": [{ "claim": "说法", "source": "材料名", "evidence": "引文" }] }]
}

${SCRIPT_GUIDE}

流程构造规则:
- structure 与计划卷章一致;flows 通常一章一条,节点 8-25 个,把该章叙事做成可玩分支
- condition 节点的出边必须且只能用 handle "true" / "false";check 节点的出边用 "success" / "fail";其他节点的边不带 handle
- hub 的每条出边都是玩家选项,必须写 label;选项影响用 effect 写指令
- ${options.useChecks ? `检定节点用于冒险 / 对抗时刻;${failRule}` : '不使用 check 节点'}
- 每个 hub 至少考虑一条 fallback 兜底边,防止所有选项被条件过滤后卡死
- 计划里的每个结局(${extras.endings.map((e) => e.technicalName).join('、')})都必须有对应的终点节点(标 ending 字段),并从流程起点存在至少一条可走通的路径
- 只使用 variables 中声明的变量(可沿用计划,也可少量补充);条件与指令必须符合上面的脚本语法
- 分支密度:${BRANCH_DENSITY_LABEL[options.branchDensity]}

已审阅的计划:
${JSON.stringify({ ...plan, variables: extras.variables, endings: extras.endings }, null, 2)}`;
}

export function normalizeInteractiveGenerated(raw: unknown): { data: InteractiveGenerated; warnings: string[] } {
  const { data: base, warnings } = normalizeGenerated(raw);
  const o = (raw ?? {}) as Record<string, unknown>;

  const variables: PlanVariable[] = [];
  for (const v of Array.isArray(o.variables) ? o.variables : []) {
    const vo = v as Record<string, unknown>;
    const name = str(vo.name);
    if (!name || !VAR_NAME_RE.test(name)) {
      if (name) warnings.push(`变量名「${name}」不合法,已丢弃`);
      continue;
    }
    if (variables.some((x) => x.name === name)) continue;
    const type = str(vo.type) as VariableType;
    variables.push({
      name,
      type: type === 'number' || type === 'string' ? type : 'boolean',
      value: str(vo.value) || (type === 'number' ? '0' : type === 'string' ? '' : 'false'),
      description: str(vo.description),
    });
  }

  const flows: GenFlowIn[] = [];
  for (const f of Array.isArray(o.flows) ? o.flows : []) {
    const fo = f as Record<string, unknown>;
    const name = str(fo.name) || `流程 ${flows.length + 1}`;
    const nodes: GenFlowNodeIn[] = [];
    const ids = new Set<string>();
    for (const n of Array.isArray(fo.nodes) ? fo.nodes : []) {
      const no = n as Record<string, unknown>;
      const id = str(no.id);
      if (!id || ids.has(id)) { warnings.push(`流程「${name}」有缺失或重复的节点 id,已丢弃该节点`); continue; }
      ids.add(id);
      const type = str(no.type);
      nodes.push({
        id,
        type: type === 'hub' || type === 'condition' || type === 'instruction' || type === 'check' ? type : 'dialogue',
        title: str(no.title),
        text: str(no.text),
        speaker: str(no.speaker) || undefined,
        technicalName: str(no.technicalName) || undefined,
        checkExpr: str(no.checkExpr) || undefined,
        checkDc: typeof no.checkDc === 'number' && Number.isFinite(no.checkDc) ? no.checkDc : undefined,
        checkRed: no.checkRed === true || undefined,
        ending: str(no.ending) || undefined,
      });
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: GenFlowEdgeIn[] = [];
    // condition / check 出边的 handle 宽容修复:缺失时按顺序补齐
    const handleQueue = new Map<string, string[]>();
    for (const e of Array.isArray(fo.edges) ? fo.edges : []) {
      const eo = e as Record<string, unknown>;
      const from = str(eo.from);
      const to = str(eo.to);
      if (!byId.has(from) || !byId.has(to)) {
        warnings.push(`流程「${name}」有连线指向不存在的节点(${from || '?'} → ${to || '?'}),已丢弃`);
        continue;
      }
      const srcType = byId.get(from)!.type;
      let handle = str(eo.handle) as GenFlowEdgeIn['handle'] | '';
      if (srcType === 'condition') {
        if (handle !== 'true' && handle !== 'false') {
          const q = handleQueue.get(from) ?? ['true', 'false'];
          handle = (q.shift() as 'true' | 'false') ?? 'true';
          handleQueue.set(from, q);
          warnings.push(`流程「${name}」条件节点出边缺少 true/false 标记,已按顺序补齐`);
        }
      } else if (srcType === 'check') {
        if (handle !== 'success' && handle !== 'fail') {
          const q = handleQueue.get(from) ?? ['success', 'fail'];
          handle = (q.shift() as 'success' | 'fail') ?? 'success';
          handleQueue.set(from, q);
          warnings.push(`流程「${name}」检定节点出边缺少 success/fail 标记,已按顺序补齐`);
        }
      } else {
        handle = '';
      }
      edges.push({
        from, to,
        handle: handle || undefined,
        label: str(eo.label) || undefined,
        condition: str(eo.condition) || undefined,
        effect: str(eo.effect) || undefined,
        once: eo.once === true || undefined,
        fallback: eo.fallback === true || undefined,
      });
    }
    if (!nodes.length) { warnings.push(`流程「${name}」没有有效节点,已丢弃`); continue; }
    flows.push({ name, technicalName: sanitizeTechnicalName(str(fo.technicalName)) || `flow_${flows.length + 1}`, nodes, edges });
  }
  if (!flows.length) warnings.push('生成结果中没有流程;互动项目需要至少一条流程');

  const endingNodes: InteractiveGenerated['endingNodes'] = [];
  for (const e of Array.isArray(o.endingNodes) ? o.endingNodes : []) {
    const eo = e as Record<string, unknown>;
    const technicalName = sanitizeTechnicalName(str(eo.technicalName));
    const flowTech = str(eo.flow);
    const node = str(eo.node);
    if (!technicalName || !node) continue;
    endingNodes.push({ technicalName, title: str(eo.title) || technicalName, flow: flowTech, node });
  }
  // 节点上的 ending 标记也纳入(模型可能只标节点不填 endingNodes)
  for (const f of flows) {
    for (const n of f.nodes) {
      if (n.ending && !endingNodes.some((e) => e.technicalName === sanitizeTechnicalName(n.ending!))) {
        endingNodes.push({ technicalName: sanitizeTechnicalName(n.ending), title: n.title || n.ending, flow: f.technicalName, node: n.id });
      }
    }
  }

  return { data: { base, variables, flows, endingNodes }, warnings };
}

/* ---------- 预检构建(id 重映射 + 布局) ---------- */

export interface EndingRef {
  technicalName: string;
  title: string;
  flowId: string;
  flowName: string;
  nodeId: string;
}

export interface InteractiveImportPreview {
  base: ProjectImportPreview;
  newVariables: Variable[];
  newFlows: Flow[];
  endings: EndingRef[];
  warnings: string[];
  pending: PendingIssue[];
}

/** BFS 分层自动布局:x = 深度,y = 同层序号 */
function layoutNodes(nodes: FlowNode[], edges: FlowEdge[]) {
  const incoming = new Set(edges.map((e) => e.target));
  const depth = new Map<string, number>();
  const queue: string[] = nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
  for (const id of queue) depth.set(id, 0);
  if (!queue.length && nodes.length) { depth.set(nodes[0].id, 0); queue.push(nodes[0].id); }
  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    for (const e of edges) {
      if (e.source !== id) continue;
      if (!depth.has(e.target) || depth.get(e.target)! < d + 1) {
        if (!depth.has(e.target)) {
          depth.set(e.target, d + 1);
          queue.push(e.target);
        }
      }
    }
  }
  const laneCount = new Map<number, number>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const lane = laneCount.get(d) ?? 0;
    laneCount.set(d, lane + 1);
    n.position = { x: 80 + d * 280, y: 80 + lane * 150 };
  }
}

export function buildInteractiveImportPreview(
  project: Project,
  plan: ImportPlan,
  extras: InteractiveExtrasPlan,
  generated: InteractiveGenerated,
  materials: SourceMaterial[],
  extraWarnings: string[] = [],
): InteractiveImportPreview {
  const base = buildProjectImportPreview(project, plan, generated.base, materials, extraWarnings);
  const warnings = base.warnings;

  // 变量:计划与生成合并,项目里已有同名的跳过不覆盖
  const newVariables: Variable[] = [];
  const existingVarNames = new Set(project.variables.map((v) => v.name));
  for (const pv of [...extras.variables, ...generated.variables]) {
    if (existingVarNames.has(pv.name)) { warnings.push(`变量「${pv.name}」已存在,保留现有定义`); continue; }
    if (newVariables.some((v) => v.name === pv.name)) continue;
    newVariables.push({ id: uid(), name: pv.name, type: pv.type, value: pv.value, description: pv.description });
  }

  // 流程:生成侧节点 id → uid 重映射;技术名与现有项目消歧;自动布局
  const usedFlowTech = new Set(project.flows.map((f) => f.technicalName).filter(Boolean) as string[]);
  const usedNodeTech = new Set<string>();
  for (const f of project.flows) {
    for (const n of f.nodes) if (n.data.technicalName) usedNodeTech.add(n.data.technicalName);
  }
  const newFlows: Flow[] = [];
  const nodeIdMap = new Map<string, string>(); // `${flowTech}:${genId}` → 真实节点 id
  for (const gf of generated.flows) {
    let flowTech = gf.technicalName;
    while (usedFlowTech.has(flowTech)) flowTech = `${flowTech}_x`;
    usedFlowTech.add(flowTech);

    const speakers = new Map(project.entities.filter((e) => e.kind === 'character').map((e) => [e.name.trim().toLowerCase(), e.id]));
    for (const e of base.newEntities) if (e.kind === 'character') speakers.set(e.name.trim().toLowerCase(), e.id);

    const nodes: FlowNode[] = gf.nodes.map((gn) => {
      const id = uid();
      nodeIdMap.set(`${gf.technicalName}:${gn.id}`, id);
      let tech = gn.technicalName ? sanitizeTechnicalName(gn.technicalName) : '';
      if (tech) {
        while (usedNodeTech.has(tech)) tech = `${tech}_x`;
        usedNodeTech.add(tech);
      }
      return {
        id,
        type: gn.type,
        position: { x: 0, y: 0 },
        data: {
          title: gn.title,
          text: gn.text,
          speakerId: gn.speaker ? speakers.get(gn.speaker.trim().toLowerCase()) : undefined,
          technicalName: tech || undefined,
          ...(gn.type === 'check' ? { checkExpr: gn.checkExpr ?? '', checkDc: gn.checkDc ?? 8, checkRed: gn.checkRed === true } : {}),
        },
      };
    });
    const edges: FlowEdge[] = gf.edges.map((ge) => ({
      id: uid(),
      source: nodeIdMap.get(`${gf.technicalName}:${ge.from}`)!,
      target: nodeIdMap.get(`${gf.technicalName}:${ge.to}`)!,
      sourceHandle: ge.handle ?? undefined,
      label: ge.label,
      condition: ge.condition,
      effect: ge.effect,
      once: ge.once,
      fallback: ge.fallback,
    }));
    layoutNodes(nodes, edges);
    newFlows.push({ id: uid(), name: gf.name, technicalName: flowTech, nodes, edges });
  }

  // 结局引用解析(生成 id → 真实 id)
  const endings: EndingRef[] = [];
  for (const en of generated.endingNodes) {
    const flow = generated.flows.find((f) => f.technicalName === en.flow) ?? generated.flows.find((f) => f.nodes.some((n) => n.id === en.node));
    const idx = flow ? generated.flows.indexOf(flow) : -1;
    const realFlow = idx >= 0 ? newFlows[idx] : undefined;
    const realNodeId = flow ? nodeIdMap.get(`${flow.technicalName}:${en.node}`) : undefined;
    if (!realFlow || !realNodeId) {
      warnings.push(`结局「${en.title}」指向不存在的流程 / 节点,已丢弃`);
      continue;
    }
    endings.push({ technicalName: en.technicalName, title: en.title, flowId: realFlow.id, flowName: realFlow.name, nodeId: realNodeId });
  }
  for (const pe of extras.endings) {
    if (!endings.some((e) => e.technicalName === pe.technicalName)) {
      warnings.push(`计划中的结局「${pe.title}」在生成结果中没有终点节点`);
    }
  }

  base.counts['流程(互动)'] = { add: newFlows.length, update: 0, skip: 0 };
  base.counts['变量'] = { add: newVariables.length, update: 0, skip: 0 };
  base.counts['结局'] = { add: endings.length, update: 0, skip: 0 };

  return { base, newVariables, newFlows, endings, warnings, pending: base.pending };
}

/** 事务式导入:R5-A 内容 + 互动层一次写入 */
export function applyInteractiveImport(p: Project, preview: InteractiveImportPreview) {
  applyProjectImport(p, preview.base);
  p.variables.push(...structuredClone(preview.newVariables));
  p.flows.push(...structuredClone(preview.newFlows));
}

/* ---------- 验收:脚本 / 引用 / 路径 / 结局可达 ---------- */

export interface VerificationIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface InteractiveVerification {
  status: 'pass' | 'warning' | 'blocked';
  issues: VerificationIssue[];
  /** 分项结论(展示用) */
  summary: {
    scriptErrors: number;
    newAuditErrors: number;
    newAuditWarnings: number;
    unreachableEndings: string[];
    endingsChecked: number;
  };
}

/**
 * 在项目克隆上执行导入并验收:
 * - 高级体检前后对比(涵盖脚本类型错误、悬挂引用、全项目路径卡死 / 死循环 / 不可达)
 * - 结局可达性:每个结局节点必须不在其流程的不可达集合里
 * 新增 error 或有不可达结局 → blocked;仅新增 warning → warning。
 */
export function verifyInteractiveImport(project: Project, preview: InteractiveImportPreview): InteractiveVerification {
  const issues: VerificationIssue[] = [];

  // 与 proposal.ts dry-run 相同的问题指纹口径,保证两条验证通道判定一致
  const issueKey = (i: { code: string; severity: string; scope: string; objectId?: string; message: string }) =>
    `${i.code}\n${i.severity}\n${i.scope}\n${i.objectId ?? ''}\n${i.message}`;
  const baseIds = new Set(auditProject(project).map(issueKey));

  const candidate = structuredClone(project);
  applyInteractiveImport(candidate, preview);
  normalizeProject(candidate);

  const afterIssues = auditProject(candidate);
  const added = afterIssues.filter((i) => !baseIds.has(issueKey(i)));
  const addedErrors = added.filter((i) => i.severity === 'error');
  const addedWarnings = added.filter((i) => i.severity === 'warning');
  const scriptErrors = addedErrors.filter((i) => i.source === 'script').length;

  for (const i of addedErrors) {
    issues.push({ severity: 'error', message: `[${i.source}] ${i.message}` });
  }
  for (const i of addedWarnings.slice(0, 20)) {
    issues.push({ severity: 'warning', message: `[${i.source}] ${i.message}` });
  }
  if (addedWarnings.length > 20) {
    issues.push({ severity: 'warning', message: `…以及另外 ${addedWarnings.length - 20} 条新增警告` });
  }

  // 结局可达性(确定性路径遍历;candidate 已含新变量与实体)
  const unreachableEndings: string[] = [];
  for (const ending of preview.endings) {
    const flow = candidate.flows.find((f) => f.id === ending.flowId);
    if (!flow) { unreachableEndings.push(ending.title); continue; }
    const report = simulateFlow(flow, candidate.variables, candidate.entities);
    if (report.unreachable.some((u) => u.nodeId === ending.nodeId)) {
      unreachableEndings.push(ending.title);
      issues.push({ severity: 'error', message: `结局「${ending.title}」(${ending.flowName})没有任何可达路径` });
    }
  }
  if (preview.endings.length === 0) {
    issues.push({ severity: 'error', message: '生成结果中没有任何结局终点节点' });
  }

  const blocked = addedErrors.length > 0 || unreachableEndings.length > 0 || preview.endings.length === 0;
  return {
    status: blocked ? 'blocked' : issues.length > 0 ? 'warning' : 'pass',
    issues,
    summary: {
      scriptErrors,
      newAuditErrors: addedErrors.length,
      newAuditWarnings: addedWarnings.length,
      unreachableEndings,
      endingsChecked: preview.endings.length,
    },
  };
}
