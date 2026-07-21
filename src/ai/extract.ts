import type {
  AiLogEntry, DocBlock, Document, Entity, EntityField, EntityKind,
  Project, TimelineEvent, TimelinePoint, TimelineTrack,
} from '../types';
import { ENTITY_KIND_LABEL, PALETTE } from '../types';
import { uid } from '../util';

/**
 * AI 长文抽取:设计准则是「只写内容,不改结构」——
 * 模型输出经 normalizeExtracted 严格校验,再由 buildAiImportPreview
 * 按稳定 ID / 名称匹配生成差异预览,用户确认后才 applyAiImportPreview。
 * 不存在 AI 直接写项目的路径。
 */

export const DEFAULT_EXTRACT_PROMPT = `你是叙事设计工具的资料抽取助手。用户会给你一段小说、剧本、设定或笔记文本。
从中抽取结构化信息,严格按下面的 JSON 模式输出,不要输出任何 JSON 以外的内容(不要解释、不要 markdown 围栏):

{
  "entities": [
    { "kind": "character|location|item|faction|concept", "name": "名称", "summary": "一句话简介", "fields": [{ "label": "字段名", "value": "值" }] }
  ],
  "scenes": [
    { "title": "场景标题", "blocks": [
      { "type": "heading", "text": "场景标题" },
      { "type": "action", "text": "叙述/动作描写" },
      { "type": "dialogue", "speaker": "说话人名称", "text": "台词" }
    ] }
  ],
  "timelinePoints": ["时间点标签(如:第1日 / 雨夜 / 三年前)"],
  "timelineEvents": [
    { "point": "时间点标签", "title": "事件标题", "text": "事件描述", "entities": ["涉及的实体名称"] }
  ]
}

规则:
- kind 只能取 character / location / item / faction / concept:
  · character = 有名有姓的具体人物(含超自然存在的具体个体);群体只写领袖或代表个体
  · location = 具体地点、场所、房间、区域、行星等,是"角色能到达 / 待在其中"的空间
  · item = 具体可持有 / 交易 / 携带的物件、道具、文件、武器、载具
  · faction = 组织、公司、家族、教派、军团等有边界的群体
  · concept = 世界规则、机制、术语、能力体系、抽象设定;不适合归入前四类的都进这里
- 实体名称使用文中的标准称呼,同一实体不要重复输出
- 场景按叙事顺序拆分,正文摘录压缩为要点式动作块,重要对白保留原文;title 使用能一眼看出情节的短语(如「印刷间验尸」),避免只写地点或人物名
- 说话人姓名严格使用标准名或已登记的别名;正文里出现的简称若不确定归属,dialogue 的 speaker 可留空
- 只抽取文本中确实存在的信息,不要虚构
- 没有的类别输出空数组`;

/**
 * 分两轮模式的阶段指令,追加到 system prompt 末尾。
 * - 第一轮:实体 + 时间线;scenes 输出空数组
 * - 第二轮:场景 + 说话人;其余输出空数组(实体已由第一轮定稿)
 */
export const STAGE1_SUFFIX = `\n\n---\n【本次调用为两轮抽取的第一轮】\n- 只输出 entities / timelinePoints / timelineEvents,scenes 一律返回空数组 []\n- 尽可能穷举文中出现的实体,给每个角色加 aliases 字段列出简称(下一轮抽场景时会用来对齐说话人)`;
export const STAGE2_SUFFIX = `\n\n---\n【本次调用为两轮抽取的第二轮】\n- 只输出 scenes,entities / timelinePoints / timelineEvents 一律返回空数组 []\n- 场景 dialogue 的 speaker 严格使用第一轮已登记的标准名或别名,不确定归属就留空`;

/**
 * 合并两轮抽取结果:实体 / 时间线取 first,场景取 second。
 * 若某轮意外产出了对方的字段,合并时按主字段方保留。
 */
export function mergeExtracted(first: ExtractedData, second: ExtractedData): ExtractedData {
  return {
    entities: first.entities,
    timelinePoints: first.timelinePoints,
    timelineEvents: first.timelineEvents,
    scenes: second.scenes.length ? second.scenes : first.scenes,
  };
}

/**
 * 把项目已有实体拼成一段附注,追加到抽取 system prompt 后面,让模型知道:
 * - 遇到已存在的角色/地点/物品优先复用现有名称,不要造重复项
 * - 说话人姓名要写标准名或已登记的别名,不要用未登记的简称
 * 只列名 + kind + aliases,不含 summary/fields,控制字符预算。
 */
export function composeExtractSystemPrompt(basePrompt: string, project: Project): string {
  const entities = [...project.entities].sort((a, b) => {
    const ao = a.kind === 'character' ? 0 : 1;
    const bo = b.kind === 'character' ? 0 : 1;
    return ao - bo || a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  if (!entities.length) return basePrompt;
  const cap = 100;
  const lines: string[] = [];
  for (const e of entities.slice(0, cap)) {
    const kindLabel = ENTITY_KIND_LABEL[e.kind];
    const aliases = (e.aliases ?? []).filter(Boolean);
    const suffix = aliases.length ? `,别名:${aliases.join('、')}` : '';
    lines.push(`- ${e.name}(${kindLabel}${suffix})`);
  }
  const truncated = entities.length > cap ? `\n(以下省略 ${entities.length - cap} 个)` : '';
  return `${basePrompt}\n\n---\n项目已有实体(请复用同一名称,不要产出与下列指向同一实体的新条目;说话人姓名请优先使用标准名或已列出的别名):\n${lines.join('\n')}${truncated}`;
}

/* ---------- 模型输出校验 ---------- */

export interface ExtractedEntity {
  kind: EntityKind;
  name: string;
  summary: string;
  fields: { label: string; value: string }[];
  aliases?: string[];
}
export interface ExtractedBlock {
  type: 'heading' | 'action' | 'dialogue';
  text: string;
  speaker?: string;
}
export interface ExtractedScene {
  title: string;
  blocks: ExtractedBlock[];
}
export interface ExtractedEvent {
  point: string;
  title: string;
  text: string;
  entities: string[];
}
export interface ExtractedData {
  entities: ExtractedEntity[];
  scenes: ExtractedScene[];
  timelinePoints: string[];
  timelineEvents: ExtractedEvent[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 把模型 JSON 收敛成严格类型;非法条目丢弃并记入 warnings */
export function normalizeExtracted(raw: unknown): { data: ExtractedData; warnings: string[] } {
  const warnings: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;
  const data: ExtractedData = { entities: [], scenes: [], timelinePoints: [], timelineEvents: [] };

  for (const item of Array.isArray(o.entities) ? o.entities : []) {
    const e = item as Record<string, unknown>;
    const name = str(e.name);
    if (!name) { warnings.push('丢弃了一个没有名称的实体'); continue; }
    let kind = str(e.kind) as EntityKind;
    if (!(kind in ENTITY_KIND_LABEL)) {
      warnings.push(`实体「${name}」类型「${str(e.kind) || '空'}」未识别,按「设定」导入`);
      kind = 'concept';
    }
    const fields = (Array.isArray(e.fields) ? e.fields : [])
      .map((f) => ({ label: str((f as Record<string, unknown>).label), value: str((f as Record<string, unknown>).value) }))
      .filter((f) => f.label && f.value);
    const aliasList = Array.isArray(e.aliases)
      ? (e.aliases as unknown[])
          .map((x) => str(x))
          .filter((s) => s && s.toLowerCase() !== name.toLowerCase())
      : [];
    const seenAlias = new Set<string>();
    const aliases = aliasList.filter((s) => {
      const k = s.toLowerCase();
      if (seenAlias.has(k)) return false;
      seenAlias.add(k);
      return true;
    });
    if (!data.entities.some((x) => x.name === name)) {
      data.entities.push({ kind, name, summary: str(e.summary), fields, aliases: aliases.length ? aliases : undefined });
    }
  }

  for (const item of Array.isArray(o.scenes) ? o.scenes : []) {
    const s = item as Record<string, unknown>;
    const blocks: ExtractedBlock[] = [];
    for (const b of Array.isArray(s.blocks) ? s.blocks : []) {
      const bb = b as Record<string, unknown>;
      const type = str(bb.type);
      const text = str(bb.text);
      if (!text) continue;
      if (type === 'heading' || type === 'action' || type === 'dialogue') {
        blocks.push({ type, text, speaker: str(bb.speaker) || undefined });
      } else {
        blocks.push({ type: 'action', text });
      }
    }
    const title = str(s.title) || blocks.find((b) => b.type === 'heading')?.text || '';
    if (!blocks.length) { warnings.push(`丢弃了空场景「${title || '未命名'}」`); continue; }
    data.scenes.push({ title: title || '未命名场景', blocks });
  }

  for (const p of Array.isArray(o.timelinePoints) ? o.timelinePoints : []) {
    const label = str(p);
    if (label && !data.timelinePoints.includes(label)) data.timelinePoints.push(label);
  }

  for (const item of Array.isArray(o.timelineEvents) ? o.timelineEvents : []) {
    const e = item as Record<string, unknown>;
    const point = str(e.point);
    const title = str(e.title);
    if (!point || !title) { warnings.push('丢弃了一个缺少时间点或标题的事件'); continue; }
    if (!data.timelinePoints.includes(point)) data.timelinePoints.push(point);
    data.timelineEvents.push({
      point,
      title,
      text: str(e.text),
      entities: (Array.isArray(e.entities) ? e.entities : []).map(str).filter(Boolean),
    });
  }

  return { data, warnings };
}

/* ---------- 预检(稳定 ID 匹配)与应用 ---------- */

export interface AiEntityUpdate {
  id: string;
  name: string;
  setSummary?: string;
  addFields: EntityField[];
  addAliases?: string[];
}

export interface AiImportPreview {
  counts: {
    entities: { add: number; update: number; skip: number };
    scenes: { add: number };
    timelinePoints: { add: number; skip: number };
    timelineEvents: { add: number };
  };
  warnings: string[];
  unknownSpeakers: string[];
  newEntities: Entity[];
  entityUpdates: AiEntityUpdate[];
  newDocs: Document[];
  newPoints: TimelinePoint[];
  newEvents: TimelineEvent[];
  newTrack: TimelineTrack | null;
}

const norm = (s: string) => s.trim().toLowerCase();

export function buildAiImportPreview(project: Project, data: ExtractedData, extraWarnings: string[] = []): AiImportPreview {
  const warnings = [...extraWarnings];
  const byName = new Map<string, Entity>();
  for (const e of project.entities) {
    byName.set(norm(e.name), e);
    for (const alias of e.aliases ?? []) {
      const key = norm(alias);
      if (key && !byName.has(key)) byName.set(key, e);
    }
  }

  const newEntities: Entity[] = [];
  const entityUpdates: AiEntityUpdate[] = [];
  let entitySkip = 0;
  for (const ex of data.entities) {
    const existing = byName.get(norm(ex.name));
    if (existing) {
      const addFields: EntityField[] = ex.fields
        .filter((f) => !existing.fields.some((ef) => norm(ef.label) === norm(f.label)))
        .map((f) => ({ id: uid(), label: f.label, value: f.value }));
      const setSummary = !existing.summary.trim() && ex.summary ? ex.summary : undefined;
      const existingAliases = new Set([existing.name, ...(existing.aliases ?? [])].map(norm));
      const addAliases = (ex.aliases ?? []).filter((a) => a && !existingAliases.has(norm(a)));
      if (addFields.length || setSummary || addAliases.length) {
        entityUpdates.push({
          id: existing.id, name: existing.name, setSummary, addFields,
          addAliases: addAliases.length ? addAliases : undefined,
        });
      } else {
        entitySkip++;
      }
    } else {
      const entity: Entity = {
        id: uid(),
        kind: ex.kind,
        name: ex.name,
        color: PALETTE[(newEntities.length + project.entities.length) % PALETTE.length],
        emoji: '',
        summary: ex.summary,
        fields: ex.fields.map((f) => ({ id: uid(), label: f.label, value: f.value })),
        notes: '',
        aliases: ex.aliases && ex.aliases.length ? [...ex.aliases] : undefined,
        createdAt: Date.now(),
      };
      newEntities.push(entity);
      byName.set(norm(entity.name), entity);
      for (const alias of ex.aliases ?? []) {
        const key = norm(alias);
        if (key && !byName.has(key)) byName.set(key, entity);
      }
    }
  }

  const characterByName = new Map<string, Entity>();
  for (const e of [...project.entities, ...newEntities]) {
    if (e.kind !== 'character') continue;
    characterByName.set(norm(e.name), e);
    for (const alias of e.aliases ?? []) {
      const key = norm(alias);
      if (key && !characterByName.has(key)) characterByName.set(key, e);
    }
  }
  const unknownSpeakers: string[] = [];
  const baseTime = Date.now();
  const sceneCount = data.scenes.length;
  const padWidth = Math.max(2, String(sceneCount).length);
  const newDocs: Document[] = data.scenes.map((scene, i) => {
    const blocks: DocBlock[] = scene.blocks.map((b) => {
      if (b.type === 'dialogue') {
        const speaker = b.speaker ? characterByName.get(norm(b.speaker)) : undefined;
        if (b.speaker && !speaker && !unknownSpeakers.includes(b.speaker)) unknownSpeakers.push(b.speaker);
        return { id: uid(), type: 'dialogue', text: b.text, speakerId: speaker?.id };
      }
      return { id: uid(), type: b.type, text: b.text };
    });
    const seq = String(i + 1).padStart(padWidth, '0');
    return {
      id: uid(),
      name: `${seq} · ${scene.title}`,
      category: 'AI 初稿',
      blocks,
      notes: '由 AI 长文抽取生成的初稿骨架,可在文档模块继续整理。',
      status: 'outline' as const,
      order: i,
      createdAt: baseTime + (sceneCount - i),
      updatedAt: baseTime + (sceneCount - i),
    };
  });

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
    newTrack = { id: uid(), name: 'AI 导入', color: PALETTE[4] };
    trackId = newTrack.id;
  }
  const entityIdByName = new Map<string, string>();
  for (const e of [...project.entities, ...newEntities]) {
    entityIdByName.set(norm(e.name), e.id);
    for (const alias of e.aliases ?? []) {
      const key = norm(alias);
      if (key && !entityIdByName.has(key)) entityIdByName.set(key, e.id);
    }
  }
  const newEvents: TimelineEvent[] = data.timelineEvents.map((ev) => ({
    id: uid(),
    trackId: trackId!,
    pointId: pointByLabel.get(ev.point.trim())!.id,
    title: ev.title,
    text: ev.text,
    entityIds: ev.entities.map((n) => entityIdByName.get(norm(n))).filter((x): x is string => !!x),
  }));

  if (unknownSpeakers.length) {
    warnings.push(`有 ${unknownSpeakers.length} 位说话人在实体库(含本次新增)中找不到,相应对白不带角色 id`);
  }
  if (!data.entities.length && !data.scenes.length && !data.timelineEvents.length) {
    warnings.push('模型没有抽取到任何内容,请检查文本或调整提示词');
  }

  return {
    counts: {
      entities: { add: newEntities.length, update: entityUpdates.length, skip: entitySkip },
      scenes: { add: newDocs.length },
      timelinePoints: { add: newPoints.length, skip: pointSkip },
      timelineEvents: { add: newEvents.length },
    },
    warnings,
    unknownSpeakers,
    newEntities,
    entityUpdates,
    newDocs,
    newPoints,
    newEvents,
    newTrack,
  };
}

/** 应用预览到项目(在 store commit 的 mutate 回调里调用) */
export function applyAiImportPreview(p: Project, preview: AiImportPreview) {
  p.entities.push(...structuredClone(preview.newEntities));
  for (const u of preview.entityUpdates) {
    const e = p.entities.find((x) => x.id === u.id);
    if (!e) continue;
    if (u.setSummary) e.summary = u.setSummary;
    e.fields.push(...structuredClone(u.addFields));
    if (u.addAliases && u.addAliases.length) {
      const existing = new Set([e.name, ...(e.aliases ?? [])].map((s) => s.trim().toLowerCase()));
      const merged = [...(e.aliases ?? [])];
      for (const a of u.addAliases) {
        const key = a.trim().toLowerCase();
        if (!key || existing.has(key)) continue;
        existing.add(key);
        merged.push(a.trim());
      }
      if (merged.length) e.aliases = merged;
    }
  }
  p.documents.push(...structuredClone(preview.newDocs));
  if (preview.newDocs.length && !p.documentCategories.includes('AI 初稿')) p.documentCategories.push('AI 初稿');
  if (preview.newTrack) p.timelineTracks.push(structuredClone(preview.newTrack));
  p.timelinePoints.push(...structuredClone(preview.newPoints));
  p.timelineEvents.push(...structuredClone(preview.newEvents));
}

/** 追加调用记录(仅元信息),上限 50 条 */
export function pushAiLog(p: Project, entry: Omit<AiLogEntry, 'id' | 'at'>) {
  p.aiLog ??= [];
  p.aiLog.unshift({ id: uid(), at: Date.now(), ...entry });
  if (p.aiLog.length > 50) p.aiLog.length = 50;
}

/* ---------- 按模板补字段 ---------- */

export function buildFieldFillPrompt(entity: Entity, emptyLabels: string[]): { system: string; user: string } {
  return {
    system: `你是叙事设计工具的资料助手。根据用户提供的实体资料,为空缺字段补写内容。
严格输出 JSON 对象:键是字段名,值是补写的内容(字符串,简洁、与已知信息一致,不虚构无依据的细节;实在没有依据的字段省略该键)。不要输出 JSON 以外的内容。`,
    user: [
      `实体:${entity.name}(${ENTITY_KIND_LABEL[entity.kind]})`,
      entity.summary && `简介:${entity.summary}`,
      entity.notes && `备注:${entity.notes}`,
      entity.fields.filter((f) => f.value).length > 0 &&
        `已有字段:\n${entity.fields.filter((f) => f.value).map((f) => `- ${f.label}:${f.value}`).join('\n')}`,
      `需要补写的字段:${emptyLabels.join('、')}`,
    ].filter(Boolean).join('\n\n'),
  };
}

/** 解析补字段输出:只保留请求过的空字段,值必须是非空字符串 */
export function normalizeFieldFill(raw: unknown, emptyLabels: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const o = (raw ?? {}) as Record<string, unknown>;
  for (const label of emptyLabels) {
    const key = Object.keys(o).find((k) => norm(k) === norm(label));
    const value = key ? str(o[key]) : '';
    if (value) out[label] = value;
  }
  return out;
}
