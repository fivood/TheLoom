import type {
  ArcStage, DocStatus, Document, Entity, Folder, Foreshadow, ForeshadowStatus, Project,
} from './types';
import { documentWordCount, linearizeByFolders } from './util';
import { documentChapterIdentity } from './documentStructure';

/* ---------- 伏笔状态推导 ---------- */

export function foreshadowStatus(f: Foreshadow): ForeshadowStatus {
  if (f.abandoned) return 'abandoned';
  // 回收了却没埋设:倒着规划时会出现,删掉埋设所在的场景也会掉进这里
  // (unlinkDocumentReferences 会过滤掉那条 plant)。归进「已回收」等于把
  // 台账最该抓的错误藏起来
  if (f.payoffs.length > 0 && f.plants.length === 0) return 'unplanted';
  if (f.payoffs.length > 0) return 'resolved';
  if (f.plants.length > 0) return 'planted';
  return 'idea';
}

/* ---------- 章节分组:文档按 Navigator 树序线性化后,按所属文件夹分组 ---------- */

export interface ChapterGroup {
  /** 分组键:文件夹 id;未分组为空字符串 */
  key: string;
  folderId?: string;
  /** 「第一卷 · 第三章」;未分组显示「未分组」 */
  label: string;
  docs: Document[];
}

export function groupDocsByChapter(documents: Document[], folders: Folder[]): ChapterGroup[] {
  const ordered = linearizeByFolders(documents, folders, 'document');
  const groups: ChapterGroup[] = [];
  for (const d of ordered) {
    const identity = documentChapterIdentity(d, folders);
    const last = groups[groups.length - 1];
    if (last && last.key === identity.key) {
      last.docs.push(d);
    } else {
      groups.push({
        key: identity.key,
        folderId: identity.folderId,
        label: identity.label,
        docs: [d],
      });
    }
  }
  return groups;
}

/* ---------- 章节登场统计 ---------- */

export interface AppearanceCell {
  /** 本章中该角色出现的场景数(说话 / POV / 提及任一即算) */
  scenes: number;
  /** 说话的对白块数 */
  lines: number;
  /** 正文提及次数(按出现该名字的块数计) */
  mentions: number;
  /** 担任 POV 的场景数 */
  pov: number;
  /** 关联到本章场景的角色弧线阶段 */
  stages: ArcStage[];
  /** 出现过该角色的场景(供点击下钻) */
  docs: Document[];
}

export interface AppearanceRow {
  entity: Entity;
  cells: AppearanceCell[];
  totalScenes: number;
}

export interface AppearanceMatrix {
  chapters: ChapterGroup[];
  rows: AppearanceRow[];
}

/**
 * 单个场景中某实体的出现情况。
 *
 * 提及要连别名一起找 —— 中文小说里角色以「周师傅」「掌柜」「老周」出现是常态,
 * 只认全名会大面积漏统计,而登场矩阵漏了,依赖它的规划视图跟着一起漏。
 * 校对模块(proofreading.ts)早就是按 name + aliases 找的,这里跟上。
 * 一个块里同时出现全名和别名只算一次 —— mentions 记的是块数,不是出现次数。
 */
function appearanceInDoc(d: Document, e: Entity): { lines: number; mentions: number; pov: boolean } {
  const forms = [...new Set([e.name, ...(e.aliases ?? [])].map((f) => f.trim()))]
    .filter((f) => f.length >= 2);
  let lines = 0;
  let mentions = 0;
  for (const b of d.blocks) {
    if (b.type === 'dialogue' && b.speakerId === e.id) lines += 1;
    if (forms.length > 0) {
      const texts = [b.text, ...(b.items ?? [])];
      if (texts.some((t) => forms.some((f) => t.includes(f)))) mentions += 1;
    }
  }
  return { lines, mentions, pov: d.povId === e.id };
}

/** 角色 × 章节登场矩阵。仅统计角色类实体,按总登场场景数降序排 */
export function appearanceMatrix(p: Project): AppearanceMatrix {
  const chapters = groupDocsByChapter(p.documents, p.folders);
  const arcs = p.arcs ?? [];
  const characters = p.entities.filter((e) => e.kind === 'character');
  const rows: AppearanceRow[] = characters.map((entity) => {
    const cells = chapters.map((ch) => {
      const cell: AppearanceCell = { scenes: 0, lines: 0, mentions: 0, pov: 0, stages: [], docs: [] };
      const chDocIds = new Set(ch.docs.map((d) => d.id));
      for (const d of ch.docs) {
        const a = appearanceInDoc(d, entity);
        if (a.lines > 0 || a.mentions > 0 || a.pov) {
          cell.scenes += 1;
          cell.docs.push(d);
        }
        cell.lines += a.lines;
        cell.mentions += a.mentions;
        if (a.pov) cell.pov += 1;
      }
      cell.stages = arcs.filter((s) => s.entityId === entity.id && s.docId && chDocIds.has(s.docId));
      return cell;
    });
    return { entity, cells, totalScenes: cells.reduce((s, c) => s + c.scenes, 0) };
  });
  rows.sort((a, b) => b.totalScenes - a.totalScenes || a.entity.createdAt - b.entity.createdAt);
  return { chapters, rows };
}

/* ---------- 节奏图数据 ---------- */

export interface PacingPoint {
  doc: Document;
  words: number;
  tension?: number;
  status?: DocStatus;
  chapterKey: string;
  chapterLabel: string;
  /** 本场景是所属章节的第一个场景(图上画章节分隔) */
  chapterStart: boolean;
}

export function pacingPoints(p: Project): PacingPoint[] {
  const chapters = groupDocsByChapter(p.documents, p.folders);
  const out: PacingPoint[] = [];
  for (const ch of chapters) {
    ch.docs.forEach((doc, i) => {
      out.push({
        doc,
        words: documentWordCount(doc),
        tension: doc.tension,
        status: doc.status,
        chapterKey: ch.key,
        chapterLabel: ch.label,
        chapterStart: i === 0,
      });
    });
  }
  return out;
}

/* ---------- 角色弧线排序 ---------- */

/** 某角色的弧线阶段,按 order(缺省按插入序)稳定排序 */
export function arcStagesOf(p: Project, entityId: string): ArcStage[] {
  return (p.arcs ?? [])
    .filter((a) => a.entityId === entityId)
    .sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY));
}
