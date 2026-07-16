import type {
  ArcStage, BrainNote, DocBlock, Document, Entity, EntityField, EntityKind, EntityRelation,
  Folder, Foreshadow, MapDoc, OutlineRow, Project, ResearchCard,
  TimelineEvent, TimelinePoint, TimelineTrack,
} from '../types';
import { ENTITY_KIND_LABEL, PALETTE } from '../types';
import { uid } from '../util';

/**
 * R5-A 完整项目导入(小说版)。
 * 共用管线:多来源采集 → 来源类型与可信度标注 → 项目生成计划(用户审阅)
 * → 分模块候选数据 → 一致性校验 → 完整差异预检 → 单次事务 apply。
 * 铁律:小说配置以文档为权威;不生成流程 / 变量 / 条件等游戏机制;
 * 候选设定与冲突显式标为「待定」并保留来源,绝不擅自定稿。
 */

/* ---------- 材料与配置 ---------- */

export type MaterialKind = 'manuscript' | 'setting' | 'note' | 'ai';
export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = {
  manuscript: '正文',
  setting: '设定',
  note: '笔记',
  ai: 'AI 咨询记录',
};

export type MaterialTrust = 'canon' | 'normal' | 'draft';
export const MATERIAL_TRUST_LABEL: Record<MaterialTrust, string> = {
  canon: '定稿(权威)',
  normal: '一般',
  draft: '草案(仅供参考)',
};

export interface SourceMaterial {
  id: string;
  name: string;
  kind: MaterialKind;
  trust: MaterialTrust;
  text: string;
}

export type ProjectKind = 'novel' | 'shorts';
export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  novel: '长篇小说(卷 / 章 / 场景)',
  shorts: '短篇集(每章一篇)',
};

export interface ImportConfig {
  projectKind: ProjectKind;
}

/** 根据材料构成给出项目类型建议(仅建议,选择权在用户) */
export function suggestProjectKind(materials: SourceMaterial[]): { kind: ProjectKind; reason: string } {
  const manuscriptChars = materials.filter((m) => m.kind === 'manuscript').reduce((s, m) => s + m.text.length, 0);
  const total = materials.reduce((s, m) => s + m.text.length, 0) || 1;
  if (manuscriptChars / total > 0.5 && manuscriptChars > 30000) {
    return { kind: 'novel', reason: '正文材料占比高且篇幅较长,建议按长篇小说组织卷章' };
  }
  return { kind: 'novel', reason: '默认建议长篇小说;若材料是多篇独立故事可改选短篇集' };
}

const MATERIAL_TOTAL_LIMIT = 200000;

/** 把材料拼成带来源标注的输入文本(总量截断) */
export function materialsToText(materials: SourceMaterial[]): { text: string; truncated: boolean } {
  let out = '';
  let truncated = false;
  for (const m of materials) {
    const header = `\n\n===== 材料:${m.name} | 类型:${MATERIAL_KIND_LABEL[m.kind]} | 可信度:${MATERIAL_TRUST_LABEL[m.trust]} =====\n\n`;
    const remain = MATERIAL_TOTAL_LIMIT - out.length - header.length;
    if (remain <= 0) { truncated = true; break; }
    let body = m.text;
    if (body.length > remain) { body = body.slice(0, remain); truncated = true; }
    out += header + body;
  }
  return { text: out.trim(), truncated };
}

/* ---------- 阶段一:项目生成计划 ---------- */

export interface PlanScene { title: string }
export interface PlanChapter { title: string; scenes: string[] }
export interface PlanVolume { title: string; chapters: PlanChapter[] }
export interface PendingIssue {
  topic: string;
  options: { claim: string; source: string; evidence: string }[];
}
export interface ImportPlan {
  projectName: string;
  summary: string;
  volumes: PlanVolume[];
  entities: { kind: EntityKind; name: string; brief: string }[];
  timelineTracks: string[];
  pending: PendingIssue[];
}

export function buildPlanPrompt(config: ImportConfig): string {
  const shape = config.projectKind === 'shorts'
    ? '这是一部短篇集:每个 volume 代表一个分辑(没有分辑就只输出一个),每个 chapter 代表一篇短篇,scenes 是该篇内的场景。'
    : '这是一部长篇小说:volumes = 卷,chapters = 章,scenes = 章内场景标题列表。';
  return `你是叙事设计工具的项目规划助手。用户提供多份带来源标注的材料(正文 / 设定 / 笔记 / AI 咨询记录,各自标注了可信度)。
你的任务是先产出一份「项目生成计划」供用户审阅,不生成正文细节。严格输出以下 JSON,不要输出任何 JSON 以外的内容:

{
  "projectName": "作品名(材料中没有就拟一个贴切的)",
  "summary": "两三句话的故事概述",
  "volumes": [{ "title": "卷名", "chapters": [{ "title": "章名", "scenes": ["场景标题", "…"] }] }],
  "entities": [{ "kind": "character|location|item|faction|concept", "name": "名称", "brief": "一句话" }],
  "timelineTracks": ["时间线轨道名,如:主线 / 回忆线"],
  "pending": [
    { "topic": "存在分歧或未定稿的问题", "options": [
      { "claim": "一种说法", "source": "出处材料名", "evidence": "原文短引" }
    ] }
  ]
}

规则:
- ${shape}
- 结构以「正文」类材料为权威;设定 / 笔记补充背景;「AI 咨询记录」与「草案」可信度低,其中的方案若与权威材料冲突或尚未定稿,一律进 pending,不要采纳为事实
- 材料之间互相矛盾的信息(数字、关系、时间线等)必须进 pending 并给出各方出处与引文
- 场景划分尊重正文既有的分章分节;正文没写到的部分不要虚构章节
- 只抽取材料中存在的信息;没有的类别输出空数组`;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function normalizePlan(raw: unknown): { plan: ImportPlan; warnings: string[] } {
  const warnings: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;
  const plan: ImportPlan = {
    projectName: str(o.projectName) || '导入项目',
    summary: str(o.summary),
    volumes: [],
    entities: [],
    timelineTracks: [],
    pending: [],
  };
  for (const v of Array.isArray(o.volumes) ? o.volumes : []) {
    const vo = v as Record<string, unknown>;
    const chapters: PlanChapter[] = [];
    for (const c of Array.isArray(vo.chapters) ? vo.chapters : []) {
      const co = c as Record<string, unknown>;
      const title = str(co.title);
      if (!title) continue;
      chapters.push({
        title,
        scenes: (Array.isArray(co.scenes) ? co.scenes : []).map(str).filter(Boolean),
      });
    }
    const title = str(vo.title);
    if (!title && !chapters.length) continue;
    plan.volumes.push({ title: title || '未命名卷', chapters });
  }
  if (!plan.volumes.length) warnings.push('计划中没有卷章结构');
  for (const e of Array.isArray(o.entities) ? o.entities : []) {
    const eo = e as Record<string, unknown>;
    const name = str(eo.name);
    if (!name) continue;
    let kind = str(eo.kind) as EntityKind;
    if (!(kind in ENTITY_KIND_LABEL)) kind = 'concept';
    if (!plan.entities.some((x) => x.name === name)) plan.entities.push({ kind, name, brief: str(eo.brief) });
  }
  plan.timelineTracks = (Array.isArray(o.timelineTracks) ? o.timelineTracks : []).map(str).filter(Boolean);
  plan.pending = normalizePending(o.pending);
  return { plan, warnings };
}

function normalizePending(raw: unknown): PendingIssue[] {
  const out: PendingIssue[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const po = p as Record<string, unknown>;
    const topic = str(po.topic);
    if (!topic) continue;
    const options = (Array.isArray(po.options) ? po.options : []).map((op) => {
      const oo = op as Record<string, unknown>;
      return { claim: str(oo.claim), source: str(oo.source), evidence: str(oo.evidence) };
    }).filter((op) => op.claim);
    out.push({ topic, options });
  }
  return out;
}

/* ---------- 阶段二:分模块候选数据 ---------- */

export interface GenScene {
  title: string;
  pov: string;
  location: string;
  time: string;
  blocks: { type: 'heading' | 'action' | 'dialogue'; text: string; speaker?: string }[];
  source: string;
}
export interface GenChapter { title: string; scenes: GenScene[] }
export interface GenVolume { title: string; chapters: GenChapter[] }

export interface GeneratedData {
  structure: GenVolume[];
  entities: { kind: EntityKind; name: string; summary: string; fields: { label: string; value: string }[]; source: string; evidence: string }[];
  relations: { from: string; to: string; label: string; bidirectional: boolean }[];
  arcs: { entity: string; stages: { title: string; note: string; scene: string }[] }[];
  foreshadows: { title: string; note: string; plants: string[]; payoffs: string[] }[];
  outline: { no: string; title: string; time: string; main: string }[];
  timelinePoints: string[];
  timelineEvents: { point: string; title: string; text: string; entities: string[] }[];
  brainstorm: string[];
  pending: PendingIssue[];
}

export function buildGeneratePrompt(plan: ImportPlan, config: ImportConfig): string {
  return `你是叙事设计工具的项目生成助手。用户已经审阅通过了下面的「项目生成计划」,现在请按计划从材料中生成完整的候选数据。
严格输出以下 JSON,不要输出任何 JSON 以外的内容:

{
  "structure": [{ "title": "卷名", "chapters": [{ "title": "章名", "scenes": [
    { "title": "场景标题", "pov": "视角角色名或空串", "location": "地点名或空串", "time": "故事时间标签或空串",
      "blocks": [
        { "type": "heading", "text": "场景标题" },
        { "type": "action", "text": "情节要点 / 叙述(可摘录关键原文)" },
        { "type": "dialogue", "speaker": "说话人名", "text": "关键对白原文" }
      ],
      "source": "主要出处材料名" }
  ] }] }],
  "entities": [{ "kind": "character|location|item|faction|concept", "name": "名称", "summary": "简介",
    "fields": [{ "label": "字段名", "value": "值" }], "source": "出处材料名", "evidence": "原文短引" }],
  "relations": [{ "from": "实体名", "to": "实体名", "label": "关系名", "bidirectional": true }],
  "arcs": [{ "entity": "角色名", "stages": [{ "title": "阶段名", "note": "说明", "scene": "关联场景标题或空串" }] }],
  "foreshadows": [{ "title": "伏笔", "note": "说明", "plants": ["埋设场景标题"], "payoffs": ["回收场景标题"] }],
  "outline": [{ "no": "章序号", "title": "章名", "time": "故事时间", "main": "该章主线一句话" }],
  "timelinePoints": ["时间点标签"],
  "timelineEvents": [{ "point": "时间点标签", "title": "事件", "text": "描述", "entities": ["涉及实体名"] }],
  "brainstorm": ["值得保留的灵感 / 未采用的方案(一条一句)"],
  "pending": [{ "topic": "待定问题", "options": [{ "claim": "说法", "source": "材料名", "evidence": "引文" }] }]
}

已审阅的项目生成计划:
${JSON.stringify(plan, null, 2)}

规则:
- structure 必须与计划的卷章结构一致(可为场景补充细节,不可增删卷章)
- 场景 blocks 是初稿骨架:情节要点 + 关键对白摘录,不要求全文;每场 3-10 个块
- ${config.projectKind === 'shorts' ? '短篇集:chapter = 一篇短篇' : '长篇:正文材料的分章优先'}
- 关系 / 弧线 / 伏笔只写材料中有依据的;冲突与候选方案进 pending,不进正式数据
- 所有名称引用(pov / speaker / relations / arcs / entities)必须与 entities 列表中的名称一致
- 只抽取材料中存在的信息;没有的类别输出空数组`;
}

export function normalizeGenerated(raw: unknown): { data: GeneratedData; warnings: string[] } {
  const warnings: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;
  const data: GeneratedData = {
    structure: [], entities: [], relations: [], arcs: [], foreshadows: [],
    outline: [], timelinePoints: [], timelineEvents: [], brainstorm: [], pending: [],
  };

  for (const v of Array.isArray(o.structure) ? o.structure : []) {
    const vo = v as Record<string, unknown>;
    const chapters: GenChapter[] = [];
    for (const c of Array.isArray(vo.chapters) ? vo.chapters : []) {
      const co = c as Record<string, unknown>;
      const scenes: GenScene[] = [];
      for (const s of Array.isArray(co.scenes) ? co.scenes : []) {
        const so = s as Record<string, unknown>;
        const blocks = (Array.isArray(so.blocks) ? so.blocks : []).map((b) => {
          const bo = b as Record<string, unknown>;
          const type = str(bo.type);
          const text = str(bo.text);
          if (!text) return null;
          return {
            type: (type === 'heading' || type === 'dialogue' ? type : 'action') as 'heading' | 'action' | 'dialogue',
            text,
            speaker: str(bo.speaker) || undefined,
          };
        }).filter((b): b is NonNullable<typeof b> => !!b);
        const title = str(so.title);
        if (!title && !blocks.length) continue;
        scenes.push({
          title: title || '未命名场景',
          pov: str(so.pov), location: str(so.location), time: str(so.time),
          blocks: blocks.length ? blocks : [{ type: 'heading', text: title }],
          source: str(so.source),
        });
      }
      const title = str(co.title);
      if (!title && !scenes.length) continue;
      chapters.push({ title: title || '未命名章', scenes });
    }
    data.structure.push({ title: str(vo.title) || '未命名卷', chapters });
  }
  if (!data.structure.length) warnings.push('生成结果中没有卷章结构');

  for (const e of Array.isArray(o.entities) ? o.entities : []) {
    const eo = e as Record<string, unknown>;
    const name = str(eo.name);
    if (!name) continue;
    let kind = str(eo.kind) as EntityKind;
    if (!(kind in ENTITY_KIND_LABEL)) { warnings.push(`实体「${name}」类型未识别,按「设定」导入`); kind = 'concept'; }
    if (data.entities.some((x) => x.name === name)) continue;
    data.entities.push({
      kind, name, summary: str(eo.summary),
      fields: (Array.isArray(eo.fields) ? eo.fields : [])
        .map((f) => ({ label: str((f as Record<string, unknown>).label), value: str((f as Record<string, unknown>).value) }))
        .filter((f) => f.label && f.value),
      source: str(eo.source), evidence: str(eo.evidence),
    });
  }

  for (const r of Array.isArray(o.relations) ? o.relations : []) {
    const ro = r as Record<string, unknown>;
    const from = str(ro.from);
    const to = str(ro.to);
    const label = str(ro.label);
    if (!from || !to || !label || from === to) continue;
    data.relations.push({ from, to, label, bidirectional: ro.bidirectional !== false });
  }

  for (const a of Array.isArray(o.arcs) ? o.arcs : []) {
    const ao = a as Record<string, unknown>;
    const entity = str(ao.entity);
    if (!entity) continue;
    const stages = (Array.isArray(ao.stages) ? ao.stages : []).map((st) => {
      const so = st as Record<string, unknown>;
      return { title: str(so.title), note: str(so.note), scene: str(so.scene) };
    }).filter((st) => st.title);
    if (stages.length) data.arcs.push({ entity, stages });
  }

  for (const f of Array.isArray(o.foreshadows) ? o.foreshadows : []) {
    const fo = f as Record<string, unknown>;
    const title = str(fo.title);
    if (!title) continue;
    data.foreshadows.push({
      title, note: str(fo.note),
      plants: (Array.isArray(fo.plants) ? fo.plants : []).map(str).filter(Boolean),
      payoffs: (Array.isArray(fo.payoffs) ? fo.payoffs : []).map(str).filter(Boolean),
    });
  }

  for (const row of Array.isArray(o.outline) ? o.outline : []) {
    const ro = row as Record<string, unknown>;
    const title = str(ro.title);
    const main = str(ro.main);
    if (!title && !main) continue;
    data.outline.push({ no: str(ro.no), title, time: str(ro.time), main });
  }

  data.timelinePoints = (Array.isArray(o.timelinePoints) ? o.timelinePoints : []).map(str).filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  for (const ev of Array.isArray(o.timelineEvents) ? o.timelineEvents : []) {
    const eo = ev as Record<string, unknown>;
    const point = str(eo.point);
    const title = str(eo.title);
    if (!point || !title) continue;
    if (!data.timelinePoints.includes(point)) data.timelinePoints.push(point);
    data.timelineEvents.push({
      point, title, text: str(eo.text),
      entities: (Array.isArray(eo.entities) ? eo.entities : []).map(str).filter(Boolean),
    });
  }

  data.brainstorm = (Array.isArray(o.brainstorm) ? o.brainstorm : []).map(str).filter(Boolean);
  data.pending = normalizePending(o.pending);
  return { data, warnings };
}

/* ---------- 完整差异预检 ---------- */

export interface ProjectImportPreview {
  counts: Record<string, { add: number; update: number; skip: number }>;
  warnings: string[];
  pending: PendingIssue[];
  projectName: string;
  newFolders: Folder[];
  newDocs: Document[];
  newEntities: Entity[];
  entityUpdates: { id: string; setSummary?: string; addFields: EntityField[]; appendNote?: string }[];
  newRelations: EntityRelation[];
  newArcs: ArcStage[];
  newForeshadows: Foreshadow[];
  newOutlineRows: OutlineRow[];
  newTrack: TimelineTrack | null;
  newPoints: TimelinePoint[];
  newEvents: TimelineEvent[];
  newCards: ResearchCard[];
  newNotes: BrainNote[];
  newMap: MapDoc | null;
}

const norm = (s: string) => s.trim().toLowerCase();

export function buildProjectImportPreview(
  project: Project,
  plan: ImportPlan,
  data: GeneratedData,
  materials: SourceMaterial[],
  extraWarnings: string[] = [],
): ProjectImportPreview {
  const warnings = [...extraWarnings];
  const now = Date.now();

  // 实体:同名只补空白(与 R3-A 同一原则),证据写入备注
  const byName = new Map(project.entities.map((e) => [norm(e.name), e]));
  const newEntities: Entity[] = [];
  const entityUpdates: ProjectImportPreview['entityUpdates'] = [];
  let entitySkip = 0;
  for (const ex of data.entities) {
    const sourceNote = ex.source ? `来源:${ex.source}${ex.evidence ? ` ——「${ex.evidence}」` : ''}` : '';
    const existing = byName.get(norm(ex.name));
    if (existing) {
      const addFields = ex.fields
        .filter((f) => !existing.fields.some((ef) => norm(ef.label) === norm(f.label)))
        .map((f) => ({ id: uid(), label: f.label, value: f.value }));
      const setSummary = !existing.summary.trim() && ex.summary ? ex.summary : undefined;
      if (addFields.length || setSummary) entityUpdates.push({ id: existing.id, setSummary, addFields });
      else entitySkip++;
    } else {
      const entity: Entity = {
        id: uid(), kind: ex.kind, name: ex.name,
        color: PALETTE[(newEntities.length + project.entities.length) % PALETTE.length],
        emoji: '', summary: ex.summary,
        fields: ex.fields.map((f) => ({ id: uid(), label: f.label, value: f.value })),
        notes: sourceNote, createdAt: now,
      };
      newEntities.push(entity);
      byName.set(norm(entity.name), entity);
    }
  }
  const allEntities = [...project.entities, ...newEntities];
  const entityId = (name: string) => allEntities.find((e) => norm(e.name) === norm(name))?.id;
  const characterId = (name: string) => {
    const e = allEntities.find((x) => norm(x.name) === norm(name));
    return e?.kind === 'character' ? e.id : undefined;
  };

  // 文件夹树 + 场景文档(卷/章 = document 文件夹;文档为权威内容,不生成流程)
  const newFolders: Folder[] = [];
  const newDocs: Document[] = [];
  const docIdByTitle = new Map<string, string>();
  data.structure.forEach((vol, vi) => {
    const volFolder: Folder = { id: uid(), name: vol.title, module: 'document', order: vi };
    newFolders.push(volFolder);
    vol.chapters.forEach((ch, ci) => {
      const chFolder: Folder = { id: uid(), name: ch.title, module: 'document', parentId: volFolder.id, order: ci };
      newFolders.push(chFolder);
      ch.scenes.forEach((scene, si) => {
        const blocks: DocBlock[] = scene.blocks.map((b) => {
          if (b.type === 'dialogue') {
            return { id: uid(), type: 'dialogue' as const, text: b.text, speakerId: b.speaker ? characterId(b.speaker) : undefined };
          }
          return { id: uid(), type: b.type, text: b.text };
        });
        const doc: Document = {
          id: uid(), folderId: chFolder.id, order: si,
          name: scene.title, category: 'AI 初稿', blocks,
          notes: scene.source ? `来源:${scene.source}` : '',
          status: 'outline',
          povId: scene.pov ? characterId(scene.pov) : undefined,
          locationId: scene.location ? entityId(scene.location) : undefined,
          timeLabel: scene.time || undefined,
          createdAt: now + newDocs.length, updatedAt: now + newDocs.length,
        };
        newDocs.push(doc);
        if (!docIdByTitle.has(norm(scene.title))) docIdByTitle.set(norm(scene.title), doc.id);
      });
    });
  });

  // 关系 / 弧线 / 伏笔(名称解析失败的丢弃并告警)
  const newRelations: EntityRelation[] = [];
  for (const r of data.relations) {
    const fromId = entityId(r.from);
    const toId = entityId(r.to);
    if (!fromId || !toId || fromId === toId) { warnings.push(`关系「${r.from} —${r.label}— ${r.to}」的实体无法解析,已丢弃`); continue; }
    newRelations.push({ id: uid(), fromId, toId, label: r.label, bidirectional: r.bidirectional || undefined });
  }
  const newArcs: ArcStage[] = [];
  for (const a of data.arcs) {
    const eid = entityId(a.entity);
    if (!eid) { warnings.push(`弧线角色「${a.entity}」无法解析,已丢弃`); continue; }
    a.stages.forEach((st, i) => {
      newArcs.push({ id: uid(), entityId: eid, title: st.title, note: st.note, docId: st.scene ? docIdByTitle.get(norm(st.scene)) : undefined, order: i });
    });
  }
  const newForeshadows: Foreshadow[] = data.foreshadows.map((f) => ({
    id: uid(), title: f.title, note: f.note,
    plants: f.plants.map((s) => docIdByTitle.get(norm(s))).filter((x): x is string => !!x).map((docId) => ({ id: uid(), docId })),
    payoffs: f.payoffs.map((s) => docIdByTitle.get(norm(s))).filter((x): x is string => !!x).map((docId) => ({ id: uid(), docId })),
    createdAt: now,
  }));

  // 大纲(罗琳表:行 = 章)
  const newOutlineRows: OutlineRow[] = data.outline.map((r, i) => ({
    id: uid(), no: r.no || String(project.outlineRows.length + i + 1), time: r.time, title: r.title, main: r.main, cells: {},
  }));

  // 时间线
  const pointByLabel = new Map(project.timelinePoints.map((p) => [p.label.trim(), p]));
  const newPoints: TimelinePoint[] = [];
  let pointSkip = 0;
  for (const label of data.timelinePoints) {
    if (pointByLabel.has(label)) { pointSkip++; continue; }
    const point: TimelinePoint = { id: uid(), label };
    newPoints.push(point);
    pointByLabel.set(label, point);
  }
  let newTrack: TimelineTrack | null = null;
  let trackId = project.timelineTracks[0]?.id;
  if (!trackId && data.timelineEvents.length) {
    newTrack = { id: uid(), name: plan.timelineTracks[0] || '主线', color: PALETTE[4] };
    trackId = newTrack.id;
  }
  const newEvents: TimelineEvent[] = data.timelineEvents.map((ev) => ({
    id: uid(), trackId: trackId!, pointId: pointByLabel.get(ev.point.trim())!.id,
    title: ev.title, text: ev.text,
    entityIds: ev.entities.map((n) => entityId(n)).filter((x): x is string => !!x),
  }));

  // 资料卡:每份材料原文备份 + 待定设定(候选与冲突,显式待定不定稿)
  const pending = [...data.pending];
  for (const issue of plan.pending) {
    if (!pending.some((p) => norm(p.topic) === norm(issue.topic))) pending.push(issue);
  }
  const newCards: ResearchCard[] = [];
  materials.forEach((m, i) => {
    newCards.push({
      id: uid(), title: m.name, content: m.text,
      category: '原始材料', tags: [MATERIAL_KIND_LABEL[m.kind], MATERIAL_TRUST_LABEL[m.trust]],
      color: PALETTE[i % PALETTE.length], source: MATERIAL_KIND_LABEL[m.kind], pinned: false, createdAt: now + i,
    });
  });
  pending.forEach((issue, i) => {
    const content = issue.options.length
      ? issue.options.map((op) => `◇ ${op.claim}${op.source ? `\n  来源:${op.source}` : ''}${op.evidence ? `\n  引文:「${op.evidence}」` : ''}`).join('\n\n')
      : '(材料中存在分歧,待作者定夺)';
    newCards.push({
      id: uid(), title: `【待定】${issue.topic}`, content,
      category: '待定设定', tags: ['待定'], color: PALETTE[1],
      source: 'AI 项目导入', pinned: true, createdAt: now + materials.length + i,
    });
  });

  // 风暴板:灵感 / 未采用方案 + 待定问题(网格排布)
  const newNotes: BrainNote[] = [];
  const brainItems = [...data.brainstorm, ...pending.map((p) => `【待定】${p.topic}`)];
  brainItems.forEach((text, i) => {
    newNotes.push({
      id: uid(), text, color: text.startsWith('【待定】') ? PALETTE[1] : PALETTE[6],
      position: { x: 80 + (i % 4) * 240, y: 80 + Math.floor(i / 4) * 160 },
    });
  });

  // 地图:有地点实体时建一张空地图占位(底图需用户上传)
  const hasLocation = allEntities.some((e) => e.kind === 'location');
  const newMap: MapDoc | null = hasLocation && project.maps.length === 0
    ? { id: uid(), name: '故事地图(待补底图)', markers: [], regions: [] }
    : null;
  if (newMap) warnings.push('已创建空地图:上传底图后即可放置地点标记(地点实体已就绪)');

  return {
    counts: {
      '卷 / 章(文件夹)': { add: newFolders.length, update: 0, skip: 0 },
      '场景文档': { add: newDocs.length, update: 0, skip: 0 },
      '实体': { add: newEntities.length, update: entityUpdates.length, skip: entitySkip },
      '人物关系': { add: newRelations.length, update: 0, skip: 0 },
      '弧线阶段': { add: newArcs.length, update: 0, skip: 0 },
      '伏笔': { add: newForeshadows.length, update: 0, skip: 0 },
      '大纲行': { add: newOutlineRows.length, update: 0, skip: 0 },
      '时间线时间点': { add: newPoints.length, update: 0, skip: pointSkip },
      '时间线事件': { add: newEvents.length, update: 0, skip: 0 },
      '资料卡(原文备份 + 待定)': { add: newCards.length, update: 0, skip: 0 },
      '风暴板便签': { add: newNotes.length, update: 0, skip: 0 },
      '地图': { add: newMap ? 1 : 0, update: 0, skip: 0 },
    },
    warnings,
    pending,
    projectName: plan.projectName,
    newFolders, newDocs, newEntities, entityUpdates, newRelations, newArcs,
    newForeshadows, newOutlineRows, newTrack, newPoints, newEvents, newCards, newNotes, newMap,
  };
}

/** 事务式导入:单次 commit 内应用全部候选数据(撤销一步即可整体回滚) */
export function applyProjectImport(p: Project, preview: ProjectImportPreview) {
  if (!p.name || p.name === '未命名项目') p.name = preview.projectName;
  p.folders.push(...structuredClone(preview.newFolders));
  p.documents.push(...structuredClone(preview.newDocs));
  if (preview.newDocs.length && !p.documentCategories.includes('AI 初稿')) p.documentCategories.push('AI 初稿');
  p.entities.push(...structuredClone(preview.newEntities));
  for (const u of preview.entityUpdates) {
    const e = p.entities.find((x) => x.id === u.id);
    if (!e) continue;
    if (u.setSummary) e.summary = u.setSummary;
    e.fields.push(...structuredClone(u.addFields));
  }
  p.relations = [...(p.relations ?? []), ...structuredClone(preview.newRelations)];
  p.arcs = [...(p.arcs ?? []), ...structuredClone(preview.newArcs)];
  p.foreshadows = [...(p.foreshadows ?? []), ...structuredClone(preview.newForeshadows)];
  p.outlineRows.push(...structuredClone(preview.newOutlineRows));
  if (preview.newTrack) p.timelineTracks.push(structuredClone(preview.newTrack));
  p.timelinePoints.push(...structuredClone(preview.newPoints));
  p.timelineEvents.push(...structuredClone(preview.newEvents));
  p.researchCards.unshift(...structuredClone(preview.newCards));
  for (const cat of ['原始材料', '待定设定']) {
    if (preview.newCards.some((c) => c.category === cat) && !p.researchCategories.includes(cat)) {
      p.researchCategories.push(cat);
    }
  }
  p.brainstormNotes.push(...structuredClone(preview.newNotes));
  if (preview.newMap) p.maps.push(structuredClone(preview.newMap));
}
