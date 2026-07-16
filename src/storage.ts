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
import type { DocBlock, DocBlockType, Document, Entity, EntityField, EntityFieldType, EntityKind, Project, ResearchCard } from './types';
import { ENTITY_KIND_LABEL, PALETTE } from './types';
import { normalizeProject, uid } from './util';
import { documentToMarkdown } from './export';
import { parseProjectData } from './recovery';

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

/** 字段名与保留 meta key 冲突时,原样存进 _conflict_fields 避免覆盖实体身份信息 */
interface ConflictField {
  label: string;
  value: string;
  type?: EntityFieldType;
  filterKind?: EntityKind;
}

export function entityToMd(e: Entity, avatarPath?: string, idToName?: Map<string, string>): string {
  const meta: Record<string, unknown> = {
    loom: 'entity',
    id: e.id,
    kind: e.kind,
    color: e.color,
    emoji: e.emoji,
    createdAt: e.createdAt,
  };
  if (e.technicalName) meta.technicalName = e.technicalName;
  if (e.folderId) meta.folderId = e.folderId;
  if (typeof e.order === 'number' && Number.isFinite(e.order)) meta.order = e.order;
  if (avatarPath) meta.avatar = avatarPath;
  const fieldTypes: Record<string, string> = {};
  const conflicts: ConflictField[] = [];
  for (const f of e.fields) {
    if (!f.label) continue;
    if (ENTITY_META_KEYS.has(f.label)) {
      const c: ConflictField = { label: f.label, value: f.value };
      if (f.type) c.type = f.type;
      if (f.filterKind) c.filterKind = f.filterKind;
      conflicts.push(c);
      continue;
    }
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
  if (conflicts.length > 0) meta._conflict_fields = conflicts;
  let body = e.summary.trim();
  if (e.notes.trim()) body += `\n\n${SECTION_NOTES}\n\n${e.notes.trim()}`;
  return withFrontmatter(meta, body);
}

const ENTITY_META_KEYS = new Set(['loom', 'id', 'kind', 'color', 'emoji', 'avatar', 'createdAt', 'technicalName', 'folderId', 'order', 'tags', 'aliases', 'cssclasses', '_field_types', '_conflict_fields']);
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
  if (Array.isArray(meta._conflict_fields)) {
    for (const raw of meta._conflict_fields as unknown[]) {
      const c = raw as Record<string, unknown>;
      if (typeof c.label !== 'string' || !c.label) continue;
      const type = c.type === 'entity' || c.type === 'entities' ? c.type : undefined;
      const filterKind = KINDS.includes(c.filterKind as EntityKind) ? (c.filterKind as EntityKind) : undefined;
      fields.push({ id: uid(), label: c.label, value: typeof c.value === 'string' ? c.value : String(c.value ?? ''), type, filterKind });
    }
  }
  const avatarFile = typeof meta.avatar === 'string' ? meta.avatar.replace(/^assets\//, '') : null;
  return {
    id: typeof meta.id === 'string' && meta.id ? meta.id : uid(),
    folderId: typeof meta.folderId === 'string' && meta.folderId ? meta.folderId : undefined,
    order: typeof meta.order === 'number' && Number.isFinite(meta.order) ? meta.order : undefined,
    kind,
    name,
    color: typeof meta.color === 'string' ? meta.color : PALETTE[index % PALETTE.length],
    emoji: typeof meta.emoji === 'string' ? meta.emoji : '',
    avatar: (avatarFile && assets?.get(avatarFile)) || undefined,
    summary,
    fields,
    notes,
    technicalName: typeof meta.technicalName === 'string' && meta.technicalName ? meta.technicalName : undefined,
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
  if (c.folderId) meta.folderId = c.folderId;
  if (typeof c.order === 'number' && Number.isFinite(c.order)) meta.order = c.order;
  return withFrontmatter(meta, c.content);
}

export function mdToCard(filename: string, md: string, index: number): ResearchCard {
  const { meta, body } = splitFrontmatter(md);
  return {
    id: typeof meta.id === 'string' && meta.id ? meta.id : uid(),
    folderId: typeof meta.folderId === 'string' && meta.folderId ? meta.folderId : undefined,
    order: typeof meta.order === 'number' && Number.isFinite(meta.order) ? meta.order : undefined,
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

/* ---------- 文档序列化 ---------- */

export function documentToMd(d: Document, entities: Entity[]): string {
  const meta: Record<string, unknown> = {
    loom: 'document',
    id: d.id,
    category: d.category,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
  if (d.technicalName) meta.technicalName = d.technicalName;
  if (d.folderId) meta.folderId = d.folderId;
  if (typeof d.order === 'number' && Number.isFinite(d.order)) meta.order = d.order;
  if (d.notes.trim()) meta.notes = d.notes;
  // 结构化块以 yaml fenced block 无损保存;正文再附上人类可读的剧本渲染
  const blockYaml = stringifyYaml(d.blocks.map((b) => {
    const out: Record<string, unknown> = { id: b.id, type: b.type };
    if (b.unitId) out.unitId = b.unitId;
    if (b.speakerId) out.speakerId = b.speakerId;
    if (b.text) out.text = b.text;
    if (b.choices) out.choices = b.choices;
    if (b.items) out.items = b.items;
    if (typeof b.ordered === 'boolean') out.ordered = b.ordered;
    if (typeof b.level === 'number') out.level = b.level;
    if (b.condition !== undefined) out.condition = b.condition;
    if (b.instruction !== undefined) out.instruction = b.instruction;
    return out;
  })).trimEnd();
  const body = [
    '```yaml loom-blocks',
    blockYaml,
    '```',
    '',
    '## 剧本预览',
    '',
    documentToMarkdown(d, entities),
  ].join('\n');
  return withFrontmatter(meta, body);
}

export function mdToDocument(filename: string, md: string, _index: number): Document {
  const { meta, body } = splitFrontmatter(md);
  const name = filename.replace(/\.md$/i, '');

  // 从 ```yaml loom-blocks … ``` 围栏块里恢复结构化块
  let blocks: DocBlock[] = [];
  const fence = md.match(/```yaml\s+loom-blocks\s*\n([\s\S]*?)\n```/);
  if (fence) {
    try {
      const arr = parseYaml(fence[1]) as unknown[];
      if (Array.isArray(arr)) {
        blocks = arr.map((raw) => {
          const r = raw as Record<string, unknown>;
          const b: DocBlock = {
            id: typeof r.id === 'string' && r.id ? r.id : uid(),
            type: (r.type as DocBlockType) ?? 'note',
            text: '',
          };
          if (typeof r.unitId === 'string' && r.unitId) b.unitId = r.unitId;
          if (typeof r.text === 'string') b.text = r.text;
          if (typeof r.speakerId === 'string') b.speakerId = r.speakerId;
          if (Array.isArray(r.choices)) b.choices = (r.choices as { id?: string; label: string }[]).map((c) => ({
            id: typeof c.id === 'string' && c.id ? c.id : uid(),
            label: c.label ?? '',
          }));
          if (Array.isArray(r.items)) b.items = (r.items as unknown[]).map((x) => String(x ?? ''));
          if (typeof r.ordered === 'boolean') b.ordered = r.ordered;
          if (r.level === 2 || r.level === 3) b.level = r.level;
          if (typeof r.condition === 'string') b.condition = r.condition;
          if (typeof r.instruction === 'string') b.instruction = r.instruction;
          return b;
        });
      }
    } catch { /* 损坏时回落空 */ }
  }
  if (blocks.length === 0) {
    // 兼容:无结构化块时把正文当单一动作块
    const previewIdx = body.indexOf('## 剧本预览');
    const text = (previewIdx >= 0 ? body.slice(previewIdx + 7) : body).trim();
    blocks = text ? [{ id: uid(), type: 'action', text }] : [{ id: uid(), type: 'heading', text: name }];
  }

  return {
    id: typeof meta.id === 'string' && meta.id ? meta.id : uid(),
    folderId: typeof meta.folderId === 'string' && meta.folderId ? meta.folderId : undefined,
    order: typeof meta.order === 'number' && Number.isFinite(meta.order) ? meta.order : undefined,
    name,
    technicalName: typeof meta.technicalName === 'string' && meta.technicalName ? meta.technicalName : undefined,
    category: typeof meta.category === 'string' && meta.category ? meta.category : '未分类',
    blocks,
    notes: typeof meta.notes === 'string' ? meta.notes : '',
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : Date.now(),
    updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : Date.now(),
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
  recoveredFromBackup: boolean;
  entities: MdFile[];
  research: MdFile[];
  documents: MdFile[];
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

/**
 * 每个项目文件夹当前由本应用管理的文件(相对路径)。
 * 保存时只删除「本会话加载过 / 写入过、且这次不再保留」的文件;
 * 外部新建的 md / 图片不在集合里,不会被误删,下次加载时自动导入。
 */
const knownManaged = new Map<string, Set<string>>();

function recordKnown(dir: string, files: ProjectFiles) {
  knownManaged.set(dir, new Set([
    ...files.entities.map((f) => `entities/${f.name}`),
    ...files.research.map((f) => `research/${f.name}`),
    ...files.documents.map((f) => `documents/${f.name}`),
    ...files.assets.map((f) => `assets/${f.name}`),
  ]));
}

export async function pickFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const dir = await open({ directory: true, title: '选择项目文件夹(可以放在 OneDrive / Google Drive 里)' });
  return typeof dir === 'string' ? dir : null;
}

export async function folderHasProject(dir: string): Promise<boolean> {
  const files = await invoke<ProjectFiles>('load_project_dir', { dir });
  return files.projectJson !== null || files.entities.length > 0 || files.research.length > 0 || files.documents.length > 0;
}

export interface LoadedFolderProject {
  project: Project;
  recoveredFromBackup: boolean;
}

export async function loadFromFolder(dir: string): Promise<LoadedFolderProject> {
  const files = await invoke<ProjectFiles>('load_project_dir', { dir });
  recordKnown(dir, files);
  let base: Project;
  if (files.projectJson) {
    const parsed = parseProjectData(files.projectJson);
    if (!parsed) throw new Error('project.json 格式不正确');
    base = parsed;
  } else {
    base = {
      version: 1, name: '未命名项目',
      flows: [], entities: [], brainstormNotes: [], brainstormEdges: [],
      outlineColumns: [], outlineRows: [],
      timelineTracks: [], timelinePoints: [], timelineEvents: [],
      maps: [],
      researchCards: [], researchCategories: [], variables: [],
      assets: [], documents: [], documentCategories: [], attachments: {},
      folders: [],
      nodeTemplates: {},
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
  // documents/:优先以 md 为准(可 Obsidian 直接编辑),project.json 的同名文档被覆盖
  const docByName = new Map(files.documents.map((f) => [f.name, f]));
  base.documents = files.documents
    .map((f, i) => mdToDocument(f.name, f.content, i))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  // 同步分类:把 md 里出现的 category 合并进 project.documentCategories
  for (const d of base.documents) {
    if (d.category && !base.documentCategories.includes(d.category)) base.documentCategories.push(d.category);
    docByName.delete(`${d.name}.md`); // 标记已消费
  }
  normalizeProject(base);
  return { project: base, recoveredFromBackup: files.recoveredFromBackup };
}

export async function saveToFolder(dir: string, project: Project): Promise<void> {
  const entityFiles = assignFilenames(project.entities, (e) => e.name);
  const cardFiles = assignFilenames(project.researchCards, (c) => c.title);
  const docFiles = assignFilenames(project.documents, (d) => d.name);
  const idToName = new Map(project.entities.map((e) => [e.id, e.name]));

  // project.json 里不重复存 md 化的内容,只留引用顺序无关的结构化数据
  const slim = { ...project, entities: [], researchCards: [], documents: [] };

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
  for (const [name, d] of docFiles) {
    files.push({ relPath: `documents/${name}`, content: documentToMd(d, project.entities) });
    keepMd.push(`documents/${name}`);
  }

  const keep = new Set(keepMd);
  const known = knownManaged.get(dir) ?? new Set<string>();
  const deleteFiles = [...known].filter((p) => !keep.has(p));
  await invoke('save_project_dir', { dir, files, deleteFiles });
  knownManaged.set(dir, keep);
}
