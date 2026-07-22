/**
 * 项目级 xlsx 导入 / 导出。
 * 一个 workbook 覆盖:实体、大纲、变量、时间线(轨道 + 时间点 + 事件)、资源。
 * 每个 sheet 第一列都是稳定 ID(便于往返:相同 ID 走更新,新增 ID 走创建)。
 *
 * 导入始终先做预检,不直接落入项目:UI 展示 add / update / remove 统计后用户确认。
 */

import type { Asset, Entity, EntityField, EntityKind, OutlineColumn, OutlineRow, Project, TimelineEvent, TimelinePoint, TimelineTrack, Variable, VariableType } from '../types';
import { ENTITY_KIND_LABEL } from '../types';
import { uid } from '../util';
import { writeXlsx, readXlsx, type ParsedSheet, type Sheet } from './xlsx';

/* ---------- 导出 ---------- */

const SHEET = {
  entities: '实体',
  entityFields: '实体字段',
  outline: '大纲',
  outlineColumns: '大纲剧情线',
  variables: '变量',
  timelineTracks: '时间线轨道',
  timelinePoints: '时间线时间点',
  timelineEvents: '时间线事件',
  assets: '资源',
} as const;

const KIND_TO_LABEL: Record<EntityKind, string> = ENTITY_KIND_LABEL;
const LABEL_TO_KIND: Record<string, EntityKind> = Object.fromEntries(
  (Object.keys(KIND_TO_LABEL) as EntityKind[]).flatMap((k) => [[KIND_TO_LABEL[k], k], [k, k]]),
) as Record<string, EntityKind>;

function entitySheet(p: Project): Sheet {
  const rows: (string | number | boolean)[][] = [];
  rows.push(['ID', '类型', '名称', '技术名', '简介', '颜色', 'Emoji', '备注']);
  for (const e of p.entities) {
    rows.push([
      e.id,
      KIND_TO_LABEL[e.kind] ?? e.kind,
      e.name,
      e.technicalName ?? '',
      e.summary ?? '',
      e.color ?? '',
      e.emoji ?? '',
      e.notes ?? '',
    ]);
  }
  return { name: SHEET.entities, rows };
}

/** 长表:每行 = 一条实体字段,便于任意列名扩展 */
function entityFieldsSheet(p: Project): Sheet {
  const rows: (string | number | boolean)[][] = [];
  rows.push(['字段ID', '实体ID', '实体名称', '字段名', '类型', '限定类型', '值']);
  for (const e of p.entities) {
    for (const f of e.fields ?? []) {
      rows.push([
        f.id,
        e.id,
        e.name,
        f.label,
        f.type ?? 'text',
        f.filterKind ?? '',
        f.value ?? '',
      ]);
    }
  }
  return { name: SHEET.entityFields, rows };
}

function outlineSheet(p: Project): Sheet {
  const cols = p.outlineColumns;
  const header = ['ID', '章节号', '故事时间', '章节标题', '主线剧情', '章节文件夹ID', '场景ID', ...cols.map((c) => `【线】${c.title}`)];
  const rows: (string | number | boolean)[][] = [header];
  const colIds = cols.map((c) => c.id);
  for (const r of p.outlineRows) {
    rows.push([
      r.id,
      r.no ?? '',
      r.time ?? '',
      r.title ?? '',
      r.main ?? '',
      r.chapterFolderId ?? '',
      r.documentId ?? '',
      ...colIds.map((id) => r.cells[id] ?? ''),
    ]);
  }
  return { name: SHEET.outline, rows };
}

function outlineColumnsSheet(p: Project): Sheet {
  const rows: (string | number | boolean)[][] = [['ID', '标题', '颜色']];
  for (const c of p.outlineColumns) rows.push([c.id, c.title ?? '', c.color ?? '']);
  return { name: SHEET.outlineColumns, rows };
}

function variablesSheet(p: Project): Sheet {
  const rows: (string | number | boolean)[][] = [['ID', '变量名', '类型', '默认值', '说明']];
  for (const v of p.variables) rows.push([v.id, v.name, v.type, v.value, v.description ?? '']);
  return { name: SHEET.variables, rows };
}

function timelineTracksSheet(p: Project): Sheet {
  const rows: (string | number | boolean)[][] = [['ID', '轨道名', '颜色']];
  for (const t of p.timelineTracks) rows.push([t.id, t.name, t.color ?? '']);
  return { name: SHEET.timelineTracks, rows };
}
function timelinePointsSheet(p: Project): Sheet {
  const rows: (string | number | boolean)[][] = [['ID', '标签', '顺序']];
  p.timelinePoints.forEach((pt, i) => rows.push([pt.id, pt.label, i + 1]));
  return { name: SHEET.timelinePoints, rows };
}
function timelineEventsSheet(p: Project): Sheet {
  const trackName = new Map(p.timelineTracks.map((t) => [t.id, t.name] as const));
  const pointLabel = new Map(p.timelinePoints.map((pt) => [pt.id, pt.label] as const));
  const entName = new Map(p.entities.map((e) => [e.id, e.name] as const));
  const documentName = new Map(p.documents.map((document) => [document.id, document.name] as const));
  const rows: (string | number | boolean)[][] = [
    ['ID', '轨道ID', '轨道名', '时间点ID', '时间点', '标题', '描述', '关联实体名', '关联实体ID', '关联场景名', '关联场景ID', '颜色'],
  ];
  for (const ev of p.timelineEvents) {
    const names = ev.entityIds.map((id) => entName.get(id) ?? '').filter(Boolean).join(' / ');
    const documentNames = (ev.documentIds ?? []).map((id) => documentName.get(id) ?? '').filter(Boolean).join(' / ');
    rows.push([
      ev.id,
      ev.trackId, trackName.get(ev.trackId) ?? '',
      ev.pointId, pointLabel.get(ev.pointId) ?? '',
      ev.title, ev.text ?? '',
      names, ev.entityIds.join(','),
      documentNames, (ev.documentIds ?? []).join(','),
      ev.color ?? '',
    ]);
  }
  return { name: SHEET.timelineEvents, rows };
}

function assetsSheet(p: Project): Sheet {
  const rows: (string | number | boolean)[][] = [['ID', '名称', '类型', 'MIME', '大小(字节)', '技术名', '标签', '来源', '授权', '备注']];
  for (const a of p.assets) rows.push([
    a.id, a.name, a.kind, a.mime, a.size, a.technicalName ?? '', a.tags.join(' '), a.source ?? '', a.license ?? '', a.notes ?? '',
  ]);
  return { name: SHEET.assets, rows };
}

export async function projectToXlsx(p: Project): Promise<Blob> {
  const sheets: Sheet[] = [
    entitySheet(p),
    entityFieldsSheet(p),
    outlineSheet(p),
    outlineColumnsSheet(p),
    variablesSheet(p),
    timelineTracksSheet(p),
    timelinePointsSheet(p),
    timelineEventsSheet(p),
    assetsSheet(p),
  ];
  return writeXlsx(sheets);
}

/* ---------- 导入 · 预检 ---------- */

export interface DiffCounts { add: number; update: number; skip: number }

export interface XlsxImportPreview {
  /** 未识别的 sheet 名(仅作为提醒,不阻止导入) */
  ignoredSheets: string[];
  /** 每类对象的变更统计 */
  counts: {
    entities: DiffCounts;
    entityFields: DiffCounts;
    outlineRows: DiffCounts;
    outlineColumns: DiffCounts;
    variables: DiffCounts;
    timelineTracks: DiffCounts;
    timelinePoints: DiffCounts;
    timelineEvents: DiffCounts;
    assets: DiffCounts;
  };
  /** 硬性错误(阻止导入) */
  errors: string[];
  /** 软警告(允许继续) */
  warnings: string[];
  /** 应用后的项目快照(不修改原项目) */
  next: Project;
}

/** 空 diff */
const zeroDiff = (): DiffCounts => ({ add: 0, update: 0, skip: 0 });

/** 从 header 行找列索引;找不到返回 -1 */
function findCol(header: string[], ...candidates: string[]): number {
  const norm = (s: string) => s.trim().replace(/\s+/g, '').toLowerCase();
  const set = new Set(candidates.map(norm));
  for (let i = 0; i < header.length; i++) if (set.has(norm(header[i]))) return i;
  return -1;
}

interface SheetIndex {
  headers: string[];
  rows: string[][];
}
function pickSheet(sheets: ParsedSheet[], name: string): SheetIndex | null {
  const norm = (s: string) => s.trim().replace(/\s+/g, '').toLowerCase();
  const target = norm(name);
  const s = sheets.find((x) => norm(x.name) === target);
  if (!s || s.rows.length === 0) return null;
  return { headers: s.rows[0], rows: s.rows.slice(1).filter((r) => r.some((c) => c !== '')) };
}

/** 预检 xlsx 导入,产出下一版 Project 与差异统计 */
export async function previewProjectXlsx(buf: ArrayBuffer | Uint8Array, project: Project): Promise<XlsxImportPreview> {
  const sheets = await readXlsx(buf);
  const known = new Set<string>(Object.values(SHEET));
  const ignoredSheets = sheets.map((s) => s.name).filter((n) => !known.has(n));

  const errors: string[] = [];
  const warnings: string[] = [];
  const next: Project = structuredClone(project);
  const counts: XlsxImportPreview['counts'] = {
    entities: zeroDiff(),
    entityFields: zeroDiff(),
    outlineRows: zeroDiff(),
    outlineColumns: zeroDiff(),
    variables: zeroDiff(),
    timelineTracks: zeroDiff(),
    timelinePoints: zeroDiff(),
    timelineEvents: zeroDiff(),
    assets: zeroDiff(),
  };

  /* --- 实体 --- */
  const entSheet = pickSheet(sheets, SHEET.entities);
  if (entSheet) {
    const h = entSheet.headers;
    const cId = findCol(h, 'ID', 'id');
    const cKind = findCol(h, '类型', 'kind');
    const cName = findCol(h, '名称', 'name');
    const cTech = findCol(h, '技术名', 'technicalName');
    const cSummary = findCol(h, '简介', 'summary');
    const cColor = findCol(h, '颜色', 'color');
    const cEmoji = findCol(h, 'Emoji', 'emoji');
    const cNotes = findCol(h, '备注', 'notes');
    if (cName < 0) errors.push('[实体] 缺少「名称」列');
    else {
      const byId = new Map(next.entities.map((e) => [e.id, e] as const));
      const byName = new Map(next.entities.map((e) => [e.name, e] as const));
      for (const r of entSheet.rows) {
        const name = (r[cName] ?? '').trim();
        if (!name) { counts.entities.skip++; continue; }
        const id = cId >= 0 ? (r[cId] ?? '').trim() : '';
        const existing = (id && byId.get(id)) || byName.get(name);
        const kind = cKind >= 0 ? (LABEL_TO_KIND[(r[cKind] ?? '').trim()] ?? existing?.kind ?? 'concept') : (existing?.kind ?? 'concept');
        const patch: Partial<Entity> = {
          kind,
          name,
          summary: cSummary >= 0 ? (r[cSummary] ?? '') : (existing?.summary ?? ''),
          color: cColor >= 0 && r[cColor] ? r[cColor] : (existing?.color ?? '#565550'),
          emoji: cEmoji >= 0 ? (r[cEmoji] ?? '') : (existing?.emoji ?? ''),
          notes: cNotes >= 0 ? (r[cNotes] ?? '') : (existing?.notes ?? ''),
          technicalName: cTech >= 0 && r[cTech] ? r[cTech] : existing?.technicalName,
        };
        if (existing) {
          Object.assign(existing, patch);
          counts.entities.update++;
        } else {
          const created: Entity = {
            id: id || uid(),
            kind, name,
            color: patch.color!, emoji: patch.emoji ?? '',
            summary: patch.summary ?? '',
            fields: [],
            notes: patch.notes ?? '',
            technicalName: patch.technicalName,
            createdAt: Date.now(),
          };
          next.entities.push(created);
          byId.set(created.id, created);
          byName.set(created.name, created);
          counts.entities.add++;
        }
      }
    }
  }

  /* --- 实体字段 --- */
  const efSheet = pickSheet(sheets, SHEET.entityFields);
  if (efSheet) {
    const h = efSheet.headers;
    const cFid = findCol(h, '字段ID', 'fieldId');
    const cEid = findCol(h, '实体ID', 'entityId');
    const cEname = findCol(h, '实体名称', 'entityName');
    const cLabel = findCol(h, '字段名', 'label');
    const cType = findCol(h, '类型', 'type');
    const cFilter = findCol(h, '限定类型', 'filterKind');
    const cValue = findCol(h, '值', 'value');
    if (cLabel < 0) warnings.push('[实体字段] 缺少「字段名」列,跳过整表');
    else {
      const byId = new Map(next.entities.map((e) => [e.id, e] as const));
      const byName = new Map(next.entities.map((e) => [e.name, e] as const));
      // 收集本表触及的实体,清空它们的字段再重建(唯一稳妥的合并方式)
      const touchedEntities = new Set<Entity>();
      const buffer = new Map<Entity, EntityField[]>();
      for (const r of efSheet.rows) {
        const ent = (cEid >= 0 && byId.get((r[cEid] ?? '').trim())) ||
                    (cEname >= 0 && byName.get((r[cEname] ?? '').trim())) || null;
        if (!ent) { warnings.push(`[实体字段] 找不到实体:${cEname >= 0 ? r[cEname] : r[cEid] ?? '?'}`); continue; }
        const label = (r[cLabel] ?? '').trim();
        if (!label) continue;
        const type = cType >= 0 ? (r[cType] ?? '').trim() : '';
        const filterKind = cFilter >= 0 ? (r[cFilter] ?? '').trim() : '';
        const field: EntityField = {
          id: (cFid >= 0 && (r[cFid] ?? '').trim()) || uid(),
          label,
          value: cValue >= 0 ? (r[cValue] ?? '') : '',
        };
        if (type === 'entity' || type === 'entities') field.type = type;
        if (filterKind && LABEL_TO_KIND[filterKind]) field.filterKind = LABEL_TO_KIND[filterKind];
        touchedEntities.add(ent);
        if (!buffer.has(ent)) buffer.set(ent, []);
        buffer.get(ent)!.push(field);
      }
      for (const ent of touchedEntities) {
        const before = ent.fields.length;
        const after = buffer.get(ent)!;
        ent.fields = after;
        if (after.length !== before) counts.entityFields.update++;
        else counts.entityFields.update++;
      }
    }
  }

  /* --- 变量 --- */
  const vSheet = pickSheet(sheets, SHEET.variables);
  if (vSheet) {
    const h = vSheet.headers;
    const cId = findCol(h, 'ID', 'id');
    const cName = findCol(h, '变量名', 'name');
    const cType = findCol(h, '类型', 'type');
    const cValue = findCol(h, '默认值', 'value');
    const cDesc = findCol(h, '说明', 'description');
    if (cName < 0) errors.push('[变量] 缺少「变量名」列');
    else {
      const byId = new Map(next.variables.map((v) => [v.id, v] as const));
      const byName = new Map(next.variables.map((v) => [v.name, v] as const));
      for (const r of vSheet.rows) {
        const name = (r[cName] ?? '').trim();
        if (!name) continue;
        const id = cId >= 0 ? (r[cId] ?? '').trim() : '';
        const existing = (id && byId.get(id)) || byName.get(name);
        const typeRaw = (cType >= 0 ? r[cType] : '').trim();
        const type: VariableType = typeRaw === 'number' || typeRaw === 'string' ? typeRaw : (existing?.type ?? 'boolean');
        const value = cValue >= 0 ? String(r[cValue] ?? '') : (existing?.value ?? '');
        const description = cDesc >= 0 ? (r[cDesc] ?? '') : (existing?.description ?? '');
        if (existing) {
          Object.assign(existing, { name, type, value, description });
          counts.variables.update++;
        } else {
          const created: Variable = { id: id || uid(), name, type, value, description };
          next.variables.push(created);
          byId.set(created.id, created);
          byName.set(created.name, created);
          counts.variables.add++;
        }
      }
    }
  }

  /* --- 大纲剧情线 --- */
  const ocSheet = pickSheet(sheets, SHEET.outlineColumns);
  if (ocSheet) {
    const h = ocSheet.headers;
    const cId = findCol(h, 'ID', 'id');
    const cTitle = findCol(h, '标题', 'title');
    const cColor = findCol(h, '颜色', 'color');
    if (cTitle < 0) warnings.push('[大纲剧情线] 缺少「标题」列,跳过');
    else {
      const byId = new Map(next.outlineColumns.map((c) => [c.id, c] as const));
      const byTitle = new Map(next.outlineColumns.map((c) => [c.title, c] as const));
      for (const r of ocSheet.rows) {
        const title = (r[cTitle] ?? '').trim();
        if (!title) continue;
        const id = cId >= 0 ? (r[cId] ?? '').trim() : '';
        const existing = (id && byId.get(id)) || byTitle.get(title);
        const color = cColor >= 0 && r[cColor] ? r[cColor] : (existing?.color ?? '#565550');
        if (existing) { existing.title = title; existing.color = color; counts.outlineColumns.update++; }
        else {
          const created: OutlineColumn = { id: id || uid(), title, color };
          next.outlineColumns.push(created);
          byId.set(created.id, created);
          byTitle.set(created.title, created);
          counts.outlineColumns.add++;
        }
      }
    }
  }

  /* --- 大纲行 --- */
  const oSheet = pickSheet(sheets, SHEET.outline);
  if (oSheet) {
    const h = oSheet.headers;
    const cId = findCol(h, 'ID', 'id');
    const cNo = findCol(h, '章节号', 'no');
    const cTime = findCol(h, '故事时间', 'time');
    const cTitle = findCol(h, '章节标题', 'title');
    const cMain = findCol(h, '主线剧情', 'main');
    const cChapterFolderId = findCol(h, '章节文件夹ID', 'chapterFolderId');
    const cDocumentId = findCol(h, '场景ID', 'documentId');
    // 剧情线列都以 【线】 前缀开头
    const lineCols: { title: string; idx: number }[] = [];
    h.forEach((name, i) => {
      const m = name.match(/^【线】(.+)$/);
      if (m) lineCols.push({ title: m[1].trim(), idx: i });
    });
    const colByTitle = new Map(next.outlineColumns.map((c) => [c.title, c] as const));
    // 自动新建缺失的剧情线列
    for (const lc of lineCols) {
      if (!colByTitle.has(lc.title)) {
        const created: OutlineColumn = { id: uid(), title: lc.title, color: '#565550' };
        next.outlineColumns.push(created);
        colByTitle.set(lc.title, created);
        counts.outlineColumns.add++;
      }
    }
    const byId = new Map(next.outlineRows.map((r) => [r.id, r] as const));
    const chapterFolderIds = new Set(next.folders
      .filter((folder) => folder.module === 'document' && folder.documentRole === 'chapter')
      .map((folder) => folder.id));
    const documentIds = new Set(next.documents.map((document) => document.id));
    for (const r of oSheet.rows) {
      const id = cId >= 0 ? (r[cId] ?? '').trim() : '';
      const cells: Record<string, string> = {};
      for (const lc of lineCols) {
        const col = colByTitle.get(lc.title);
        if (col) cells[col.id] = r[lc.idx] ?? '';
      }
      const existing = id ? byId.get(id) : undefined;
      const chapterFolderId = cChapterFolderId >= 0 && chapterFolderIds.has((r[cChapterFolderId] ?? '').trim())
        ? (r[cChapterFolderId] ?? '').trim()
        : undefined;
      const documentId = cDocumentId >= 0 && documentIds.has((r[cDocumentId] ?? '').trim())
        ? (r[cDocumentId] ?? '').trim()
        : undefined;
      if (existing) {
        if (cNo >= 0) existing.no = r[cNo] ?? existing.no;
        if (cTime >= 0) existing.time = r[cTime] ?? existing.time;
        if (cTitle >= 0) existing.title = r[cTitle] ?? existing.title;
        if (cMain >= 0) existing.main = r[cMain] ?? existing.main;
        if (cDocumentId >= 0) existing.documentId = documentId;
        if (cChapterFolderId >= 0) existing.chapterFolderId = documentId ? undefined : chapterFolderId;
        existing.cells = { ...existing.cells, ...cells };
        counts.outlineRows.update++;
      } else {
        const created: OutlineRow = {
          id: id || uid(),
          no: cNo >= 0 ? (r[cNo] ?? '') : '',
          time: cTime >= 0 ? (r[cTime] ?? '') : '',
          title: cTitle >= 0 ? (r[cTitle] ?? '') : '',
          main: cMain >= 0 ? (r[cMain] ?? '') : '',
          cells,
          documentId,
          chapterFolderId: documentId ? undefined : chapterFolderId,
        };
        next.outlineRows.push(created);
        byId.set(created.id, created);
        counts.outlineRows.add++;
      }
    }
  }

  /* --- 时间线 · 轨道 --- */
  const ttSheet = pickSheet(sheets, SHEET.timelineTracks);
  if (ttSheet) {
    const h = ttSheet.headers;
    const cId = findCol(h, 'ID', 'id');
    const cName = findCol(h, '轨道名', 'name');
    const cColor = findCol(h, '颜色', 'color');
    if (cName < 0) warnings.push('[时间线轨道] 缺少「轨道名」列');
    else {
      const byId = new Map(next.timelineTracks.map((t) => [t.id, t] as const));
      const byName = new Map(next.timelineTracks.map((t) => [t.name, t] as const));
      for (const r of ttSheet.rows) {
        const name = (r[cName] ?? '').trim();
        if (!name) continue;
        const id = cId >= 0 ? (r[cId] ?? '').trim() : '';
        const existing = (id && byId.get(id)) || byName.get(name);
        const color = cColor >= 0 && r[cColor] ? r[cColor] : (existing?.color ?? '#565550');
        if (existing) { existing.name = name; existing.color = color; counts.timelineTracks.update++; }
        else {
          const created: TimelineTrack = { id: id || uid(), name, color };
          next.timelineTracks.push(created);
          byId.set(created.id, created);
          byName.set(created.name, created);
          counts.timelineTracks.add++;
        }
      }
    }
  }

  /* --- 时间线 · 时间点 --- */
  const tpSheet = pickSheet(sheets, SHEET.timelinePoints);
  if (tpSheet) {
    const h = tpSheet.headers;
    const cId = findCol(h, 'ID', 'id');
    const cLabel = findCol(h, '标签', 'label');
    if (cLabel < 0) warnings.push('[时间线时间点] 缺少「标签」列');
    else {
      const byId = new Map(next.timelinePoints.map((p) => [p.id, p] as const));
      const byLabel = new Map(next.timelinePoints.map((p) => [p.label, p] as const));
      for (const r of tpSheet.rows) {
        const label = (r[cLabel] ?? '').trim();
        if (!label) continue;
        const id = cId >= 0 ? (r[cId] ?? '').trim() : '';
        const existing = (id && byId.get(id)) || byLabel.get(label);
        if (existing) { existing.label = label; counts.timelinePoints.update++; }
        else {
          const created: TimelinePoint = { id: id || uid(), label };
          next.timelinePoints.push(created);
          byId.set(created.id, created);
          byLabel.set(created.label, created);
          counts.timelinePoints.add++;
        }
      }
    }
  }

  /* --- 时间线 · 事件 --- */
  const teSheet = pickSheet(sheets, SHEET.timelineEvents);
  if (teSheet) {
    const h = teSheet.headers;
    const cId = findCol(h, 'ID', 'id');
    const cTrackId = findCol(h, '轨道ID', 'trackId');
    const cTrackName = findCol(h, '轨道名', 'trackName');
    const cPointId = findCol(h, '时间点ID', 'pointId');
    const cPointLabel = findCol(h, '时间点', 'pointLabel');
    const cTitle = findCol(h, '标题', 'title');
    const cText = findCol(h, '描述', 'text');
    const cEntNames = findCol(h, '关联实体名', 'entityNames');
    const cEntIds = findCol(h, '关联实体ID', 'entityIds');
    const cDocumentNames = findCol(h, '关联场景名', 'documentNames');
    const cDocumentIds = findCol(h, '关联场景ID', 'documentIds');
    const cColor = findCol(h, '颜色', 'color');
    if (cTitle < 0) warnings.push('[时间线事件] 缺少「标题」列');
    else {
      const byId = new Map(next.timelineEvents.map((e) => [e.id, e] as const));
      const trackById = new Map(next.timelineTracks.map((t) => [t.id, t] as const));
      const trackByName = new Map(next.timelineTracks.map((t) => [t.name, t] as const));
      const pointById = new Map(next.timelinePoints.map((p) => [p.id, p] as const));
      const pointByLabel = new Map(next.timelinePoints.map((p) => [p.label, p] as const));
      const entById = new Map(next.entities.map((e) => [e.id, e] as const));
      const entByName = new Map(next.entities.map((e) => [e.name, e] as const));
      const documentById = new Map(next.documents.map((document) => [document.id, document] as const));
      const documentByName = new Map(next.documents.map((document) => [document.name, document] as const));
      for (const r of teSheet.rows) {
        const title = (r[cTitle] ?? '').trim();
        if (!title) continue;
        const track = (cTrackId >= 0 && trackById.get((r[cTrackId] ?? '').trim())) ||
                      (cTrackName >= 0 && trackByName.get((r[cTrackName] ?? '').trim())) || null;
        const point = (cPointId >= 0 && pointById.get((r[cPointId] ?? '').trim())) ||
                      (cPointLabel >= 0 && pointByLabel.get((r[cPointLabel] ?? '').trim())) || null;
        if (!track || !point) {
          warnings.push(`[时间线事件] 找不到轨道或时间点:${title}`);
          continue;
        }
        const entIdsRaw: string[] = [];
        if (cEntIds >= 0) entIdsRaw.push(...(r[cEntIds] ?? '').split(/[,,、;;]/).map((s) => s.trim()).filter(Boolean));
        if (cEntNames >= 0) entIdsRaw.push(...(r[cEntNames] ?? '').split(/[\/\|,,;;]/).map((s) => s.trim()).filter(Boolean));
        const entIds: string[] = [];
        for (const raw of entIdsRaw) {
          if (entById.has(raw)) entIds.push(raw);
          else if (entByName.has(raw)) entIds.push(entByName.get(raw)!.id);
        }
        const documentRefsRaw: string[] = [];
        if (cDocumentIds >= 0) documentRefsRaw.push(...(r[cDocumentIds] ?? '').split(/[,，、;]/).map((value) => value.trim()).filter(Boolean));
        if (cDocumentNames >= 0) documentRefsRaw.push(...(r[cDocumentNames] ?? '').split(/[\/|,，;；]/).map((value) => value.trim()).filter(Boolean));
        const documentIds: string[] = [];
        for (const raw of documentRefsRaw) {
          if (documentById.has(raw)) documentIds.push(raw);
          else if (documentByName.has(raw)) documentIds.push(documentByName.get(raw)!.id);
        }
        const id = cId >= 0 ? (r[cId] ?? '').trim() : '';
        const existing = id ? byId.get(id) : undefined;
        const color = cColor >= 0 ? (r[cColor] ?? undefined) : undefined;
        if (existing) {
          existing.trackId = track.id;
          existing.pointId = point.id;
          existing.title = title;
          existing.text = cText >= 0 ? (r[cText] ?? '') : existing.text;
          existing.entityIds = [...new Set(entIds)];
          if (cDocumentIds >= 0 || cDocumentNames >= 0) existing.documentIds = [...new Set(documentIds)];
          if (color !== undefined) existing.color = color || undefined;
          counts.timelineEvents.update++;
        } else {
          const created: TimelineEvent = {
            id: id || uid(), trackId: track.id, pointId: point.id, title,
            text: cText >= 0 ? (r[cText] ?? '') : '',
            entityIds: [...new Set(entIds)],
            documentIds: [...new Set(documentIds)],
            color: color || undefined,
          };
          next.timelineEvents.push(created);
          byId.set(created.id, created);
          counts.timelineEvents.add++;
        }
      }
    }
  }

  /* --- 资源(仅元数据往返;二进制不在 xlsx 范围内) --- */
  const aSheet = pickSheet(sheets, SHEET.assets);
  if (aSheet) {
    const h = aSheet.headers;
    const cId = findCol(h, 'ID', 'id');
    const cName = findCol(h, '名称', 'name');
    const cTech = findCol(h, '技术名', 'technicalName');
    const cTags = findCol(h, '标签', 'tags');
    const cSource = findCol(h, '来源', 'source');
    const cLicense = findCol(h, '授权', 'license');
    const cNotes = findCol(h, '备注', 'notes');
    if (cName < 0 || cId < 0) warnings.push('[资源] 缺少「ID」或「名称」,只允许更新元数据');
    else {
      const byId = new Map(next.assets.map((a) => [a.id, a] as const));
      for (const r of aSheet.rows) {
        const id = (r[cId] ?? '').trim();
        const existing = id ? byId.get(id) : null;
        if (!existing) { counts.assets.skip++; continue; }
        const patch: Partial<Asset> = {
          name: r[cName] ?? existing.name,
          technicalName: cTech >= 0 && r[cTech] ? r[cTech] : existing.technicalName,
          tags: cTags >= 0 ? (r[cTags] ?? '').split(/[\s,,;;]+/).filter(Boolean) : existing.tags,
          source: cSource >= 0 ? (r[cSource] ?? '') : existing.source,
          license: cLicense >= 0 ? (r[cLicense] || undefined) : existing.license,
          notes: cNotes >= 0 ? (r[cNotes] ?? '') : existing.notes,
        };
        Object.assign(existing, patch);
        counts.assets.update++;
      }
    }
  }

  next.updatedAt = Date.now();
  return { ignoredSheets, counts, errors, warnings, next };
}
