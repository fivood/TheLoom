/**
 * 设定集的分类分组(纯逻辑)。
 * 内置的五个 kind 是全场景公用的,不足以描述一部作品自己的世界观骨架
 * (奇幻要种族 / 魔法体系,科幻要星系 / 科技,跑团要怪物 / 宝物),
 * 所以分组轴放开到「文件夹 / 模板 / 类型」三选一——都是项目里已有的数据,不新增字段。
 * 空分类要保留:先摆出骨架再填内容,是「总设计」这个用法的前提。
 */
import type { Entity, EntityKind, Folder, ObjectTemplate } from '../../types';
import { ENTITY_KIND_LABEL } from '../../types';
import { folderPath } from '../../util';

export type CodexGroupBy = 'kind' | 'folder' | 'template' | 'none';

export const CODEX_GROUP_LABEL: Record<CodexGroupBy, string> = {
  kind: '按类型',
  folder: '按分类(文件夹)',
  template: '按模板',
  none: '不分组',
};

export interface CodexGroup {
  key: string;
  label: string;
  items: Entity[];
  /** 有简介的条目数:哪些分类只有名字没内容,一眼可见 */
  filled: number;
  /** 新建时带上的归属,让「＋」直接落进这一类 */
  kind?: EntityKind;
  folderId?: string;
  templateId?: string;
}

const KINDS: EntityKind[] = ['character', 'location', 'item', 'faction', 'concept'];

function pack(key: string, label: string, items: Entity[], extra: Partial<CodexGroup> = {}): CodexGroup {
  return {
    key,
    label,
    items,
    filled: items.filter((e) => e.summary.trim() !== '').length,
    ...extra,
  };
}

export function groupEntities(
  entities: Entity[],
  folders: Folder[],
  templates: ObjectTemplate[],
  by: CodexGroupBy,
): CodexGroup[] {
  if (by === 'none') return [pack('all', '全部', entities)];

  if (by === 'kind') {
    return KINDS.map((kind) => pack(
      kind,
      ENTITY_KIND_LABEL[kind],
      entities.filter((e) => e.kind === kind),
      { kind },
    ));
  }

  if (by === 'template') {
    const mine = templates.filter((t) => t.module === 'entity');
    const known = new Set(mine.map((t) => t.id));
    const groups = mine.map((t) => pack(
      t.id,
      t.name,
      entities.filter((e) => e.templateId === t.id),
      { templateId: t.id, kind: t.entityKind },
    ));
    const rest = entities.filter((e) => !e.templateId || !known.has(e.templateId));
    return [...groups, pack('__none', '未套模板', rest)];
  }

  const mine = folders.filter((f) => f.module === 'entity');
  const known = new Set(mine.map((f) => f.id));
  const groups = mine.map((f) => pack(
    f.id,
    folderPath(f.id, folders) || f.name,
    entities.filter((e) => e.folderId === f.id),
    { folderId: f.id },
  ));
  const rest = entities.filter((e) => !e.folderId || !known.has(e.folderId));
  return [...groups, pack('__none', '未分组', rest)];
}
