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
- kind 只能取 character(角色)/ location(地点)/ item(物品)/ faction(阵营)/ concept(设定)
- 实体名称使用文中的标准称呼,同一实体不要重复输出
- 场景按叙事顺序拆分,正文摘录压缩为要点式动作块,重要对白保留原文
- 只抽取文本中确实存在的信息,不要虚构
- 没有的类别输出空数组`;

/* ---------- 模型输出校验 ---------- */

export interface ExtractedEntity {
  kind: EntityKind;
  name: string;
  summary: string;
  fields: { label: string; value: string }[];
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
    if (!data.entities.some((x) => x.name === name)) {
      data.entities.push({ kind, name, summary: str(e.summary), fields });
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
  const byName = new Map(project.entities.map((e) => [norm(e.name), e]));

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
      if (addFields.length || setSummary) {
        entityUpdates.push({ id: existing.id, name: existing.name, setSummary, addFields });
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
        createdAt: Date.now(),
      };
      newEntities.push(entity);
      byName.set(norm(entity.name), entity);
    }
  }

  const characterByName = new Map(
    [...project.entities, ...newEntities].filter((e) => e.kind === 'character').map((e) => [norm(e.name), e]),
  );
  const unknownSpeakers: string[] = [];
  const newDocs: Document[] = data.scenes.map((scene, i) => {
    const blocks: DocBlock[] = scene.blocks.map((b) => {
      if (b.type === 'dialogue') {
        const speaker = b.speaker ? characterByName.get(norm(b.speaker)) : undefined;
        if (b.speaker && !speaker && !unknownSpeakers.includes(b.speaker)) unknownSpeakers.push(b.speaker);
        return { id: uid(), type: 'dialogue', text: b.text, speakerId: speaker?.id };
      }
      return { id: uid(), type: b.type, text: b.text };
    });
    return {
      id: uid(),
      name: scene.title,
      category: 'AI 初稿',
      blocks,
      notes: '由 AI 长文抽取生成的初稿骨架,可在文档模块继续整理。',
      status: 'outline' as const,
      createdAt: Date.now() + i,
      updatedAt: Date.now() + i,
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
  const entityIdByName = new Map([...project.entities, ...newEntities].map((e) => [norm(e.name), e.id]));
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
