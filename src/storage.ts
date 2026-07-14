/**
 * 文件夹存储层(仅 Tauri 桌面版可用)
 *
 * 项目文件夹结构 —— 直接就是一个 Obsidian 兼容的库(或库的子目录):
 *   project.json      流程 / 大纲 / 时间线 / 风暴 / 变量等结构化数据
 *   entities/*.md     实体卡:YAML frontmatter + 正文(简介、备注)
 *   research/*.md     资料卡:YAML frontmatter + 正文
 *
 * 把这个文件夹放进 OneDrive / Google Drive 同步目录即可云同步;
 * 在 Obsidian 中直接打开该文件夹,实体卡和资料卡就是普通笔记,
 * 支持双链、标签和图谱。entities/ 与 research/ 下新建的 .md
 * 会在下次加载时自动导入为实体 / 资料卡。
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Entity, EntityField, EntityFieldType, EntityKind, Project, ResearchCard } from './types';
import { ENTITY_KIND_LABEL, PALETTE } from './types';
import { normalizeProject, uid } from './util';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const FOLDER_KEY = 'theloom-folder';

export function getSavedFolder(): string | null {
  return localStorage.getItem(FOLDER_KEY);
}
export function setSavedFolder(dir: string | null) {
  if (dir) localStorage.setItem(FOLDER_KEY, dir);
  else localStorage.removeItem(FOLDER_KEY);
}

/* ---------- Markdown 序列化 ---------- */

interface FrontmatterDoc {
  meta: Record<string, unknown>;
  body: string;
}

function splitFrontmatter(md: string): FrontmatterDoc {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: md.trim() };
  let meta: Record<string, unknown> = {};
  try {
    meta = (parseYaml(m[1]) as Record<string, unknown>) ?? {};
  } catch { /* frontmatter 损坏时按正文处理 */ }
  return { meta, body: m[2].trim() };
}

function withFrontmatter(meta: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(meta).trimEnd()}\n---\n\n${body.trim()}\n`;
}

const SECTION_NOTES = '## 备注';

export function entityToMd(e: Entity, avatarPath?: string, idToName?: Map<string, string>): string {
  const meta: Record<string, unknown> = {
    loom: 'entity',
    id: e.id,
    kind: e.kind,
    color: e.color,
    emoji: e.emoji,
    createdAt: e.createdAt,
  };
  if (avatarPath) meta.avatar = avatarPath;
  const fieldTypes: Record<string, string> = {};
  for (const f of e.fields) {
    if (!f.label) continue;
    const type = f.type ?? 'text';
    if (type === 'text') {
      meta[f.label] = f.value;
    } else if (type === 'entity') {
      const nm = idToName?.get(f.value);
      meta[f.label] = nm ? `[[${nm}]]` : f.value;
      fieldTypes[f.label] = f.filterKind ? `entity:${f.filterKind}` : 'entity';
    } else {
      const ids = f.value.split(',').map((s) => s.trim()).filter(Boolean);
      meta[f.label] = ids.map((id) => (idToName?.get(id) ? `[[${idToName.get(id)}]]` : id));
      fieldTypes[f.label] = f.filterKind ? `entities:${f.filterKind}` : 'entities';
    }
  }
  if (Object.keys(fieldTypes).length > 0) meta._field_types = fieldTypes;
  let body = e.summary.trim();
  if (e.notes.trim()) body += `\n\n${SECTION_NOTES}\n\n${e.notes.trim()}`;
  return withFrontmatter(meta, body);
}

const ENTITY_META_KEYS = new Set(['loom', 'id', 'kind', 'color', 'emoji', 'avatar', 'createdAt', 'tags', 'aliases', 'cssclasses', '_field_types']);
const KINDS = Object.keys(ENTITY_KIND_LABEL) as EntityKind[];

/** [[Name]] → Name;非链接返回 null */
function parseWikiLink(s: string): string | null {
  const m = /^\[\[(.+?)\]\]$/.exec(String(s).trim());
  return m ? m[1] : null;
}

export function mdToEntity(filename: string, md: string, index: number, assets?: Map<string, string>): Entity {
  const { meta, body } = splitFrontmatter(md);
  const name = filename.replace(/\.md$/i, '');
  const notesIdx = body.indexOf(SECTION_NOTES);
  const summary = notesIdx >= 0 ? body.slice(0, notesIdx).trim() : body;
  const notes = notesIdx >= 0 ? body.slice(notesIdx + SECTION_NOTES.length).trim() : '';
  const kind = KINDS.includes(meta.kind as EntityKind) ? (meta.kind as EntityKind) : 'concept';
  const fieldTypes = (meta._field_types ?? {}) as Record<string, string>;
  const fields: EntityField[] = Object.entries(meta)
    .filter(([k]) => !ENTITY_META_KEYS.has(k))
    .map(([k, v]) => {
      const tSpec = fieldTypes[k];
      let type: EntityFieldType | undefined;
      let filterKind: EntityKind | undefined;
      if (tSpec) {
        const [t, f] = tSpec.split(':');
        if (t === 'entity' || t === 'entities') type = t;
        if (f && KINDS.includes(f as EntityKind)) filterKind = f as EntityKind;
      }
      let value: string;
      if (Array.isArray(v)) {
        // 多值:每项可能是 [[Name]] 或原样
        value = v.map((x) => parseWikiLink(String(x)) ?? String(x)).join(',');
        if (!type) type = 'entities';
      } else {
        const wl = parseWikiLink(String(v ?? ''));
        if (wl !== null) {
          value = wl;
          if (!type) type = 'entity';
        } else {
          value = String(v ?? '');
        }
      }
      return { id: uid(), label: k, value, type, filterKind };
    });
  const avatarFile = typeof meta.avatar === 'string' ? meta.avatar.replace(/^assets\//, '') : null;
  return {
    id: typeof meta.id === 'string' && meta.id ? meta.id : uid(),
    kind,
    name,
    color: typeof meta.color === 'string' ? meta.color : PALETTE[index % PALETTE.length],
    emoji: typeof meta.emoji === 'string' ? meta.emoji : '',
    avatar: (avatarFile && assets?.get(avatarFile)) || undefined,
    summary,
    fields,
    notes,
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : Date.now(),
  };
}

/** 加载后把引用字段中残留的实体名解析为 id */
export function resolveEntityRefs(entities: Entity[]) {
  const byName = new Map(entities.map((e) => [e.name, e.id]));
  const byId = new Set(entities.map((e) => e.id));
  for (const e of entities) {
    for (const f of e.fields) {
      if (f.type === 'entity') {
        if (!byId.has(f.value)) f.value = byName.get(f.value) ?? f.value;
      } else if (f.type === 'entities') {
        f.value = f.value.split(',').map((v) => v.trim())
          .map((v) => (byId.has(v) ? v : byName.get(v) ?? v))
          .filter(Boolean).join(',');
      }
    }
  }
}

export function cardToMd(c: ResearchCard): string {
  const meta: Record<string, unknown> = {
    loom: 'research',
    id: c.id,
    category: c.category,
    tags: c.tags,
    color: c.color,
    pinned: c.pinned,
    createdAt: c.createdAt,
  };
  if (c.source) meta.source = c.source;
  return withFrontmatter(meta, c.content);
}

export function mdToCard(filename: string, md: string, index: number): ResearchCard {
  const { meta, body } = splitFrontmatter(md);
  return {
    id: typeof meta.id === 'string' && meta.id ? meta.id : uid(),
    title: filename.replace(/\.md$/i, ''),
    content: body,
    category: typeof meta.category === 'string' && meta.category ? meta.category : '未分类',
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    color: typeof meta.color === 'string' ? meta.color : PALETTE[index % PALETTE.length],
    source: typeof meta.source === 'string' ? meta.source : '',
    pinned: meta.pinned === true,
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : Date.now(),
  };
}

/* ---------- 文件名 ---------- */

function sanitizeFilename(name: string, fallback: string): string {
  const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || fallback;
}

/** 生成不重复的文件名集合:重名时追加短 id */
function assignFilenames<T extends { id: string }>(items: T[], nameOf: (t: T) => string): Map<string, T> {
  const used = new Set<string>();
  const out = new Map<string, T>();
  for (const item of items) {
    let base = sanitizeFilename(nameOf(item), item.id);
    if (used.has(base.toLowerCase())) base = `${base} ${item.id.slice(0, 6)}`;
    used.add(base.toLowerCase());
    out.set(`${base}.md`, item);
  }
  return out;
}

/* ---------- Tauri 文件夹读写 ---------- */

interface MdFile { name: string; content: string }
interface ProjectFiles {
  projectJson: string | null;
  entities: MdFile[];
  research: MdFile[];
  /** assets/ 下的图片,content 为 base64 */
  assets: MdFile[];
}

function assetMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function pickFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const dir = await open({ directory: true, title: '选择项目文件夹(可以放在 OneDrive / Google Drive 里)' });
  return typeof dir === 'string' ? dir : null;
}

export async function folderHasProject(dir: string): Promise<boolean> {
  const files = await invoke<ProjectFiles>('load_project_dir', { dir });
  return files.projectJson !== null || files.entities.length > 0 || files.research.length > 0;
}

export async function loadFromFolder(dir: string): Promise<Project> {
  const files = await invoke<ProjectFiles>('load_project_dir', { dir });
  let base: Project;
  if (files.projectJson) {
    base = JSON.parse(files.projectJson) as Project;
    if (!base || base.version !== 1) throw new Error('project.json 格式不正确');
  } else {
    base = {
      version: 1, name: '未命名项目',
      flows: [], entities: [], brainstormNotes: [], brainstormEdges: [],
      outlineColumns: [], outlineRows: [],
      timelineTracks: [], timelinePoints: [], timelineEvents: [],
      maps: [],
      researchCards: [], researchCategories: [], variables: [],
      updatedAt: Date.now(),
    };
  }
  normalizeProject(base);
  const assets = new Map(files.assets.map((f) => [f.name, `data:${assetMime(f.name)};base64,${f.content}`]));
  base.entities = files.entities
    .map((f, i) => mdToEntity(f.name, f.content, i, assets))
    .sort((a, b) => a.createdAt - b.createdAt);
  resolveEntityRefs(base.entities);
  base.researchCards = files.research
    .map((f, i) => mdToCard(f.name, f.content, i))
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const c of base.researchCards) {
    if (c.category && !base.researchCategories.includes(c.category)) base.researchCategories.push(c.category);
  }
  return base;
}

export async function saveToFolder(dir: string, project: Project): Promise<void> {
  const entityFiles = assignFilenames(project.entities, (e) => e.name);
  const cardFiles = assignFilenames(project.researchCards, (c) => c.title);
  const idToName = new Map(project.entities.map((e) => [e.id, e.name]));

  // project.json 里不重复存 md 化的内容,只留引用顺序无关的结构化数据
  const slim = { ...project, entities: [], researchCards: [] };

  const files: { relPath: string; content: string; base64?: boolean }[] = [
    { relPath: 'project.json', content: JSON.stringify(slim, null, 2) },
  ];
  const keepMd: string[] = [];

  for (const [name, e] of entityFiles) {
    let avatarPath: string | undefined;
    if (e.avatar) {
      const payload = e.avatar.split(',')[1];
      if (payload) {
        avatarPath = `assets/entity-${e.id}.png`;
        files.push({ relPath: avatarPath, content: payload, base64: true });
        keepMd.push(avatarPath);
      }
    }
    // md 中不内嵌图片数据,只引用 assets/ 路径;实体引用字段用 [[Name]] wiki-link 便于 Obsidian 打开
    files.push({ relPath: `entities/${name}`, content: entityToMd({ ...e, avatar: undefined }, avatarPath, idToName) });
    keepMd.push(`entities/${name}`);
  }
  for (const [name, c] of cardFiles) {
    files.push({ relPath: `research/${name}`, content: cardToMd(c) });
    keepMd.push(`research/${name}`);
  }

  await invoke('save_project_dir', { dir, files, keepMd });
}
