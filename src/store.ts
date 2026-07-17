import { create } from 'zustand';
import type {
  Annotation, ArcStage, BrainEdge, BrainNote, ColorPalette, Document, Entity, EntityRelation,
  Flow, Folder, Foreshadow, OutlineColumn, OutlineRow, Project, ResearchCard, SavedProjectQuery, Variable,
} from './types';
import { DOC_SNAPSHOT_LIMIT } from './types';
import { normalizeProject, uid, detachAssetEverywhere, syncNarrativeUnits } from './util';
import { mapProjectScripts } from './script';
import { renameEntityField, renameIdentifier, renameSeenTarget } from './script/rename';
import { getSavedFolder, isTauri, saveToFolder, setSavedFolder } from './storage';
import { confirmDialog, alertDialog } from './dialog';
import { sampleProject } from './sample';
import {
  clearProjectRecovery, clearQuarantinedProject, parseProjectData, readProjectWithRecovery,
  saveProjectWithRecovery, storedProjectKey, type RecoveryBackup,
} from './recovery';
import { getStorageUsage, type StorageUsage } from './diagnostics';

export { uid, normalizeProject };

/**
 * 多项目槽位存储:
 *   theloom-slots-v1       槽位元数据数组 SlotMeta[]
 *   theloom-current-v1     当前槽位 id
 *   theloom-project-{id}   每个槽位的项目 JSON
 *
 * 旧的单项目键 theloom-project-v1 首次加载时自动迁移为一个槽位并保留原键作备份。
 */
const SLOTS_KEY = 'theloom-slots-v1';
const CURRENT_KEY = 'theloom-current-v1';
const LEGACY_KEY = 'theloom-project-v1';
const projectKey = storedProjectKey;
const snapshotsKey = (slotId: string) => `theloom-snapshots-${slotId}`;

export interface Snapshot {
  id: string;
  name: string;
  createdAt: number;
  /** 项目 JSON 序列化(完整快照,含所有模块) */
  data: string;
}

function readSnapshots(slotId: string): Snapshot[] {
  try {
    const raw = localStorage.getItem(snapshotsKey(slotId));
    if (raw) return JSON.parse(raw) as Snapshot[];
  } catch { /* 忽略 */ }
  return [];
}
function writeSnapshots(slotId: string, list: Snapshot[]): string | null {
  try {
    localStorage.setItem(snapshotsKey(slotId), JSON.stringify(list));
    return null;
  } catch (error) {
    console.error('快照写入失败', error);
    return error instanceof Error ? error.message : String(error);
  }
}

export interface SlotMeta {
  id: string;
  name: string;
  updatedAt: number;
}

/* ---------- 空白项目(默认) ---------- */

function blankProject(): Project {
  return {
    version: 1,
    name: '未命名项目',
    flows: [{ id: uid(), name: '第一章', nodes: [], edges: [] }],
    entities: [],
    brainstormNotes: [],
    brainstormEdges: [],
    outlineColumns: [],
    outlineRows: [],
    timelineTracks: [],
    timelinePoints: [],
    timelineEvents: [],
    maps: [],
    researchCards: [],
    researchCategories: [],
    variables: [],
    assets: [],
    documents: [],
    documentCategories: [],
    attachments: {},
    folders: [],
    units: [],
    palettes: [],
    updatedAt: Date.now(),
  };
}

function readSlots(): SlotMeta[] {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    if (raw) return JSON.parse(raw) as SlotMeta[];
  } catch { /* 忽略 */ }
  return [];
}
function writeSlots(slots: SlotMeta[]) {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
}
/** 应用启动时的初始化:返回槽位列表、当前 id、当前项目 */
function initSlots(): {
  slots: SlotMeta[];
  currentId: string;
  project: Project;
  recoveryBackup: RecoveryBackup | null;
  quarantinedProject: RecoveryBackup | null;
  recoveryNotice: string | null;
} {
  let slots = readSlots();
  let id = localStorage.getItem(CURRENT_KEY);

  // 首次运行:从旧的单项目键迁移
  if (slots.length === 0) {
    try {
      const legacyRaw = localStorage.getItem(LEGACY_KEY);
      if (legacyRaw) {
        const p = JSON.parse(legacyRaw) as Project;
        if (p && p.version === 1) {
          const newId = uid();
          localStorage.setItem(projectKey(newId), legacyRaw);
          slots = [{ id: newId, name: p.name || '未命名项目', updatedAt: p.updatedAt || Date.now() }];
          writeSlots(slots);
          id = newId;
          localStorage.setItem(CURRENT_KEY, id);
        }
      }
    } catch { /* 忽略 */ }
  }

  // 还是空:建一个空白槽位
  if (slots.length === 0) {
    const newId = uid();
    const p = blankProject();
    localStorage.setItem(projectKey(newId), JSON.stringify(p));
    slots = [{ id: newId, name: p.name, updatedAt: Date.now() }];
    writeSlots(slots);
    id = newId;
    localStorage.setItem(CURRENT_KEY, id);
  }

  // current 指针失效时兜底
  if (!id || !slots.some((s) => s.id === id)) {
    id = slots[0].id;
    localStorage.setItem(CURRENT_KEY, id);
  }

  const loaded = readProjectWithRecovery(localStorage, id);
  const project = loaded.project ?? blankProject();
  return {
    slots,
    currentId: id,
    project,
    recoveryBackup: loaded.backup,
    quarantinedProject: loaded.quarantine,
    recoveryNotice: loaded.notice,
  };
}

/* ---------- Store ---------- */

interface LoomState {
  project: Project;
  savedAt: number;
  saveStatus: 'saved' | 'saving' | 'error';
  saveError: string | null;
  storageUsage: StorageUsage;
  /** 撤销/重做后递增,用于强制画布类组件重新挂载 */
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Tauri 模式下的项目文件夹路径;null = 仅存浏览器 */
  folder: string | null;
  syncError: string | null;
  recoveryBackup: RecoveryBackup | null;
  quarantinedProject: RecoveryBackup | null;
  recoveryNotice: string | null;
  setFolder: (dir: string | null) => void;
  /** 解除文件夹绑定,项目改回浏览器本地存储(文件夹内容保持不变) */
  /** 本地镜像完整写入后才解除绑定;失败时保留原绑定 */
  unbindFolder: () => boolean;
  restoreRecoveryBackup: () => Promise<void>;
  dismissRecoveryNotice: () => void;
  discardQuarantinedProject: () => void;
  setRecoveryNotice: (message: string | null) => void;
  update: (fn: (p: Project) => void) => void;
  undo: () => void;
  redo: () => void;
  replaceProject: (p: Project) => void;
  resetProject: () => void;
  loadSampleProject: () => void;

  /** 多项目槽位 */
  slots: SlotMeta[];
  currentSlotId: string;
  switchSlot: (id: string) => void;
  newSlot: (kind: 'blank' | 'sample') => boolean;
  deleteSlot: (id: string) => void;

  updateFlow: (flowId: string, fn: (f: Flow) => void) => void;

  addEntity: (e: Entity) => void;
  updateEntity: (id: string, patch: Partial<Entity>) => void;
  removeEntity: (id: string) => void;

  setBrainstorm: (notes: BrainNote[], edges: BrainEdge[]) => void;

  addOutlineRow: (afterId?: string) => void;
  updateOutlineRow: (id: string, patch: Partial<OutlineRow>) => void;
  setOutlineCell: (rowId: string, colId: string, value: string) => void;
  removeOutlineRow: (id: string) => void;
  moveOutlineRow: (id: string, dir: -1 | 1) => void;
  addOutlineColumn: (col: OutlineColumn) => void;
  updateOutlineColumn: (id: string, patch: Partial<OutlineColumn>) => void;
  removeOutlineColumn: (id: string) => void;

  addCard: (c: ResearchCard) => void;
  updateCard: (id: string, patch: Partial<ResearchCard>) => void;
  removeCard: (id: string) => void;

  addVariable: (v: Variable) => void;
  updateVariable: (id: string, patch: Partial<Variable>) => void;
  removeVariable: (id: string) => void;
  /** R6 重命名联动:全项目脚本里改写标识符 / 实体字段 / seen 目标 */
  renameScriptIdentifier: (oldName: string, newName: string) => void;
  renameScriptEntityField: (entityTech: string, oldField: string, newField: string) => void;
  renameScriptSeenTarget: (oldName: string, newName: string) => void;

  addAsset: (a: import('./types').Asset) => void;
  updateAsset: (id: string, patch: Partial<import('./types').Asset>) => void;
  removeAsset: (id: string) => void;

  addDocument: (d: Document) => void;
  updateDocument: (id: string, fn: (d: Document) => void) => void;
  removeDocument: (id: string) => void;

  addFolder: (f: Folder) => void;
  updateFolder: (id: string, patch: Partial<Folder>) => void;
  removeFolder: (id: string) => void;

  addSavedQuery: (query: SavedProjectQuery) => void;
  updateSavedQuery: (id: string, patch: Partial<Omit<SavedProjectQuery, 'id' | 'createdAt'>>) => void;
  removeSavedQuery: (id: string) => void;

  addAnnotation: (a: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;

  createDocSnapshot: (docId: string, label: string) => void;
  removeDocSnapshot: (id: string) => void;
  restoreDocSnapshot: (id: string) => void;

  addRelation: (r: EntityRelation) => void;
  updateRelation: (id: string, patch: Partial<EntityRelation>) => void;
  removeRelation: (id: string) => void;
  setRelationLayout: (positions: Record<string, { x: number; y: number }>) => void;

  addArcStage: (a: ArcStage) => void;
  updateArcStage: (id: string, patch: Partial<ArcStage>) => void;
  removeArcStage: (id: string) => void;

  addForeshadow: (f: Foreshadow) => void;
  updateForeshadow: (id: string, fn: (f: Foreshadow) => void) => void;
  removeForeshadow: (id: string) => void;

  addPalette: (p: ColorPalette) => void;
  updatePalette: (id: string, patch: Partial<ColorPalette>) => void;
  removePalette: (id: string) => void;
  setActivePalette: (id: string | null) => void;

  /** 版本历史快照 */
  snapshots: Snapshot[];
  createSnapshot: (name: string) => void;
  restoreSnapshot: (id: string) => Promise<void>;
  deleteSnapshot: (id: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

const UNDO_LIMIT = 50;
const UNDO_COALESCE_MS = 800;
let undoStack: Project[] = [];
let redoStack: Project[] = [];
let lastUndoPush = 0;

const boot = initSlots();

export const useLoom = create<LoomState>((set, get) => {
  const persist = (p: Project) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const id = get().currentSlotId;
      try {
        const result = saveProjectWithRecovery(localStorage, id, p);
        // 同步更新槽位元数据(名称、更新时间)
        const slots = get().slots.map((s) =>
          s.id === id ? { ...s, name: p.name || '未命名项目', updatedAt: p.updatedAt } : s,
        );
        writeSlots(slots);
        set({
          slots,
          savedAt: Date.now(),
          saveStatus: 'saved',
          saveError: result.backupError ? `项目已保存，但自动恢复点写入失败:${result.backupError}` : null,
          recoveryBackup: result.backup,
          storageUsage: getStorageUsage(localStorage),
        });
      } catch (e) {
        if (get().folder && isTauri) {
          // 文件夹模式:localStorage 只是镜像,写不下不算保存失败(文件夹为权威存储)
          set({ savedAt: Date.now(), saveStatus: 'saved', saveError: null, storageUsage: getStorageUsage(localStorage) });
        } else {
          console.error('保存失败', e);
          set({ saveStatus: 'error', saveError: e instanceof Error ? e.message : String(e) });
        }
      }
      const folder = get().folder;
      if (folder && isTauri) {
        saveToFolder(folder, p)
          .then(() => set({ syncError: null }))
          .catch((e) => set({ syncError: String(e) }));
      }
    }, 400);
  };

  /** 换到另一个槽位时:立即冲刷当前槽的保存,清撤销栈 */
  const flushAndSwitch = (targetId: string) => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    // 立即写入当前槽,避免防抖丢失
    try {
      const cur = get();
      saveProjectWithRecovery(localStorage, cur.currentSlotId, cur.project);
    } catch { /* 忽略 */ }
    localStorage.setItem(CURRENT_KEY, targetId);
    undoStack = []; redoStack = []; lastUndoPush = 0;
    const loaded = readProjectWithRecovery(localStorage, targetId);
    const next = loaded.project ?? blankProject();
    set((s) => ({
      project: next,
      currentSlotId: targetId,
      snapshots: readSnapshots(targetId),
      savedAt: Date.now(),
      saveStatus: 'saved',
      saveError: null,
      recoveryBackup: loaded.backup,
      quarantinedProject: loaded.quarantine,
      recoveryNotice: loaded.notice,
      storageUsage: getStorageUsage(localStorage),
      revision: s.revision + 1,
      canUndo: false,
      canRedo: false,
    }));
  };

  const commit = (fn: (p: Project) => void) => {
    const prev = get().project;
    // 快速连续的编辑(如打字)合并为一步撤销
    const now = Date.now();
    if (now - lastUndoPush > UNDO_COALESCE_MS) {
      undoStack.push(prev);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      lastUndoPush = now;
    }
    redoStack = [];
    const next = structuredClone(prev);
    fn(next);
    syncNarrativeUnits(next, prev);
    next.updatedAt = Date.now();
    persist(next);
    set({ project: next, saveStatus: 'saving', saveError: null, canUndo: true, canRedo: false });
  };

  /** 整项目替换(撤销/重做/导入/重置)后递增 revision,让画布重新挂载 */
  const swapProject = (p: Project, extra?: Partial<LoomState>) => {
    persist(p);
    set((s) => ({
      project: p, saveStatus: 'saving', saveError: null, revision: s.revision + 1,
      canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
      ...extra,
    }));
  };

  return {
    project: boot.project,
    savedAt: Date.now(),
    saveStatus: 'saved',
    saveError: null,
    storageUsage: getStorageUsage(localStorage),
    revision: 0,
    canUndo: false,
    canRedo: false,
    folder: isTauri ? getSavedFolder() : null,
    syncError: null,
    recoveryBackup: boot.recoveryBackup,
    quarantinedProject: boot.quarantinedProject,
    recoveryNotice: boot.recoveryNotice,
    setFolder: (dir) => set({ folder: dir, syncError: null }),
    unbindFolder: () => {
      const cur = get();
      if (!cur.folder) return true;
      try {
        saveProjectWithRecovery(localStorage, cur.currentSlotId, cur.project);
        const slots = cur.slots.map((s) =>
          s.id === cur.currentSlotId ? { ...s, name: cur.project.name || '未命名项目', updatedAt: cur.project.updatedAt } : s,
        );
        writeSlots(slots);
        setSavedFolder(null);
        set({
          folder: null, syncError: null, slots,
          savedAt: Date.now(), saveStatus: 'saved', saveError: null,
          storageUsage: getStorageUsage(localStorage),
        });
        return true;
      } catch (e) {
        set({
          saveStatus: 'error',
          saveError: `无法解除文件夹绑定:浏览器本地存储写入失败。项目仍绑定在原文件夹。${e instanceof Error ? e.message : String(e)}`,
        });
        return false;
      }
    },
    dismissRecoveryNotice: () => set({ recoveryNotice: null }),
    setRecoveryNotice: (message) => set({ recoveryNotice: message }),
    discardQuarantinedProject: () => {
      const slotId = get().currentSlotId;
      clearQuarantinedProject(localStorage, slotId);
      set({ quarantinedProject: null });
    },
    restoreRecoveryBackup: async () => {
      const cur = get();
      if (!cur.recoveryBackup) return;
      const project = parseProjectData(cur.recoveryBackup.data);
      if (!project) {
        set({ recoveryBackup: null, recoveryNotice: '自动恢复点已经损坏，无法恢复。' });
        return;
      }
      if (!await confirmDialog({ message: `恢复到 ${new Date(cur.recoveryBackup.createdAt).toLocaleString()} 的自动恢复点?当前状态会进入撤销栈。` })) return;
      undoStack.push(cur.project);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack = [];
      lastUndoPush = 0;
      swapProject(project, { recoveryNotice: null });
    },

    slots: boot.slots,
    currentSlotId: boot.currentId,
    snapshots: readSnapshots(boot.currentId),

    switchSlot: (id) => {
      const cur = get().currentSlotId;
      if (id === cur) return;
      if (!get().slots.some((s) => s.id === id)) return;
      flushAndSwitch(id);
    },
    newSlot: (kind) => {
      const newId = uid();
      try {
        const proj = kind === 'sample' ? sampleProject() : blankProject();
        localStorage.setItem(projectKey(newId), JSON.stringify(proj));
        const meta: SlotMeta = { id: newId, name: proj.name, updatedAt: Date.now() };
        const nextSlots = [...get().slots, meta];
        writeSlots(nextSlots);
        set({ slots: nextSlots, storageUsage: getStorageUsage(localStorage) });
        flushAndSwitch(newId);
        return true;
      } catch (error) {
        try { localStorage.removeItem(projectKey(newId)); } catch {}
        set({
          saveStatus: 'error',
          saveError: `无法创建新项目:${error instanceof Error ? error.message : String(error)}`,
          storageUsage: getStorageUsage(localStorage),
        });
        return false;
      }
    },
    deleteSlot: (id) => {
      const cur = get();
      if (cur.slots.length <= 1) return; // 至少留一个
      const nextSlots = cur.slots.filter((s) => s.id !== id);
      writeSlots(nextSlots);
      localStorage.removeItem(projectKey(id));
      localStorage.removeItem(snapshotsKey(id));
      clearProjectRecovery(localStorage, id);
      set({ slots: nextSlots, storageUsage: getStorageUsage(localStorage) });
      if (cur.currentSlotId === id) flushAndSwitch(nextSlots[0].id);
    },

    update: commit,
    undo: () => {
      const prev = undoStack.pop();
      if (!prev) return;
      redoStack.push(get().project);
      lastUndoPush = 0;
      swapProject(prev);
    },
    redo: () => {
      const next = redoStack.pop();
      if (!next) return;
      undoStack.push(get().project);
      lastUndoPush = 0;
      swapProject(next);
    },
    replaceProject: (p) => {
      undoStack = []; redoStack = []; lastUndoPush = 0;
      swapProject(p);
    },
    resetProject: () => {
      undoStack = []; redoStack = []; lastUndoPush = 0;
      swapProject(blankProject());
    },
    loadSampleProject: () => {
      undoStack = []; redoStack = []; lastUndoPush = 0;
      swapProject(sampleProject());
    },

    updateFlow: (flowId, fn) => commit((p) => {
      const f = p.flows.find((x) => x.id === flowId);
      if (f) fn(f);
    }),

    addEntity: (e) => commit((p) => { p.entities.push(e); }),
    updateEntity: (id, patch) => commit((p) => {
      const e = p.entities.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
    }),
    removeEntity: (id) => commit((p) => {
      p.entities = p.entities.filter((x) => x.id !== id);
      p.relations = (p.relations ?? []).filter((r) => r.fromId !== id && r.toId !== id);
      p.arcs = (p.arcs ?? []).filter((a) => a.entityId !== id);
      if (p.relationLayout) delete p.relationLayout[id];
    }),

    setBrainstorm: (notes, edges) => commit((p) => {
      p.brainstormNotes = notes;
      p.brainstormEdges = edges;
    }),

    addOutlineRow: (afterId) => commit((p) => {
      const row: OutlineRow = { id: uid(), no: String(p.outlineRows.length + 1), time: '', title: '', main: '', cells: {} };
      const i = afterId ? p.outlineRows.findIndex((r) => r.id === afterId) : -1;
      if (i >= 0) p.outlineRows.splice(i + 1, 0, row);
      else p.outlineRows.push(row);
    }),
    updateOutlineRow: (id, patch) => commit((p) => {
      const r = p.outlineRows.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    }),
    setOutlineCell: (rowId, colId, value) => commit((p) => {
      const r = p.outlineRows.find((x) => x.id === rowId);
      if (r) r.cells[colId] = value;
    }),
    removeOutlineRow: (id) => commit((p) => {
      p.outlineRows = p.outlineRows.filter((x) => x.id !== id);
    }),
    moveOutlineRow: (id, dir) => commit((p) => {
      const i = p.outlineRows.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.outlineRows.length) return;
      const [row] = p.outlineRows.splice(i, 1);
      p.outlineRows.splice(j, 0, row);
    }),
    addOutlineColumn: (col) => commit((p) => { p.outlineColumns.push(col); }),
    updateOutlineColumn: (id, patch) => commit((p) => {
      const c = p.outlineColumns.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    }),
    removeOutlineColumn: (id) => commit((p) => {
      p.outlineColumns = p.outlineColumns.filter((x) => x.id !== id);
      for (const r of p.outlineRows) delete r.cells[id];
    }),

    addCard: (c) => commit((p) => {
      p.researchCards.unshift(c);
      if (c.category && !p.researchCategories.includes(c.category)) p.researchCategories.push(c.category);
    }),
    updateCard: (id, patch) => commit((p) => {
      const c = p.researchCards.find((x) => x.id === id);
      if (c) {
        Object.assign(c, patch);
        if (c.category && !p.researchCategories.includes(c.category)) p.researchCategories.push(c.category);
      }
    }),
    removeCard: (id) => commit((p) => {
      p.researchCards = p.researchCards.filter((x) => x.id !== id);
    }),

    addVariable: (v) => commit((p) => { p.variables.push(v); }),
    updateVariable: (id, patch) => commit((p) => {
      const v = p.variables.find((x) => x.id === id);
      if (v) Object.assign(v, patch);
    }),
    removeVariable: (id) => commit((p) => {
      p.variables = p.variables.filter((x) => x.id !== id);
    }),
    renameScriptIdentifier: (oldName, newName) => {
      if (!oldName || !newName || oldName === newName) return;
      commit((p) => { mapProjectScripts(p, (s) => renameIdentifier(s, oldName, newName)); });
    },
    renameScriptEntityField: (entityTech, oldField, newField) => {
      if (!entityTech || !oldField || !newField || oldField === newField) return;
      commit((p) => { mapProjectScripts(p, (s) => renameEntityField(s, entityTech, oldField, newField)); });
    },
    renameScriptSeenTarget: (oldName, newName) => {
      if (!oldName || !newName || oldName === newName) return;
      commit((p) => { mapProjectScripts(p, (s) => renameSeenTarget(s, oldName, newName)); });
    },

    addAsset: (a) => commit((p) => { p.assets.push(a); }),
    updateAsset: (id, patch) => commit((p) => {
      const a = p.assets.find((x) => x.id === id);
      if (a) Object.assign(a, patch);
    }),
    removeAsset: (id) => commit((p) => {
      p.assets = p.assets.filter((x) => x.id !== id);
      detachAssetEverywhere(p, id);
    }),

    addDocument: (d) => commit((p) => {
      p.documents.push(d);
      if (d.category && !p.documentCategories.includes(d.category)) p.documentCategories.push(d.category);
    }),
    updateDocument: (id, fn) => commit((p) => {
      const d = p.documents.find((x) => x.id === id);
      if (!d) return;
      fn(d);
      d.updatedAt = Date.now();
      if (d.category && !p.documentCategories.includes(d.category)) p.documentCategories.push(d.category);
    }),
    removeDocument: (id) => commit((p) => {
      p.documents = p.documents.filter((x) => x.id !== id);
      for (const a of p.arcs ?? []) if (a.docId === id) a.docId = undefined;
      for (const f of p.foreshadows ?? []) {
        f.plants = f.plants.filter((ref) => ref.docId !== id);
        f.payoffs = f.payoffs.filter((ref) => ref.docId !== id);
      }
      p.annotations = (p.annotations ?? []).filter((a) => a.docId !== id);
      p.docSnapshots = (p.docSnapshots ?? []).filter((s) => s.docId !== id);
    }),

    addAnnotation: (a) => commit((p) => { p.annotations ??= []; p.annotations.push(a); }),
    updateAnnotation: (id, patch) => commit((p) => {
      const a = (p.annotations ?? []).find((x) => x.id === id);
      if (a) Object.assign(a, patch);
    }),
    removeAnnotation: (id) => commit((p) => {
      p.annotations = (p.annotations ?? []).filter((x) => x.id !== id);
    }),

    createDocSnapshot: (docId, label) => commit((p) => {
      const d = p.documents.find((x) => x.id === docId);
      if (!d) return;
      p.docSnapshots ??= [];
      p.docSnapshots.push({
        id: uid(), docId, label, revision: d.revision,
        blocks: structuredClone(d.blocks), createdAt: Date.now(),
      });
      // 每篇上限:超出丢最旧
      const mine = p.docSnapshots.filter((s) => s.docId === docId);
      if (mine.length > DOC_SNAPSHOT_LIMIT) {
        const drop = new Set(
          [...mine].sort((a, b) => a.createdAt - b.createdAt)
            .slice(0, mine.length - DOC_SNAPSHOT_LIMIT).map((s) => s.id),
        );
        p.docSnapshots = p.docSnapshots.filter((s) => !drop.has(s.id));
      }
    }),
    removeDocSnapshot: (id) => commit((p) => {
      p.docSnapshots = (p.docSnapshots ?? []).filter((s) => s.id !== id);
    }),
    restoreDocSnapshot: (id) => commit((p) => {
      const snap = (p.docSnapshots ?? []).find((s) => s.id === id);
      if (!snap) return;
      const d = p.documents.find((x) => x.id === snap.docId);
      if (!d) return;
      d.blocks = structuredClone(snap.blocks);
      d.updatedAt = Date.now();
    }),

    addFolder: (f) => commit((p) => { p.folders.push(f); }),
    updateFolder: (id, patch) => commit((p) => {
      const f = p.folders.find((x) => x.id === id);
      if (f) Object.assign(f, patch);
    }),
    removeFolder: (id) => commit((p) => {
      // 递归收集该文件夹及其所有后代文件夹 id
      const toDelete = new Set<string>([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const f of p.folders) {
          if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
            toDelete.add(f.id);
            changed = true;
          }
        }
      }
      p.folders = p.folders.filter((f) => !toDelete.has(f.id));
      for (const saved of p.savedQueries ?? []) {
        if (toDelete.has(saved.query.folderId)) saved.query.folderId = 'any';
      }
      // 解除受影响文件夹下所有对象的归属(此处覆盖所有用 folderId 的对象类型)
      const clear = (fid: string) => {
        for (const fl of p.flows) if (fl.folderId === fid) fl.folderId = undefined;
        for (const entity of p.entities) if (entity.folderId === fid) entity.folderId = undefined;
        for (const asset of p.assets) if (asset.folderId === fid) asset.folderId = undefined;
        for (const document of p.documents) if (document.folderId === fid) document.folderId = undefined;
        for (const card of p.researchCards) if (card.folderId === fid) card.folderId = undefined;
      };
      for (const fid of toDelete) clear(fid);
    }),

    addSavedQuery: (query) => commit((p) => {
      p.savedQueries ??= [];
      p.savedQueries.push(query);
    }),
    updateSavedQuery: (id, patch) => commit((p) => {
      const saved = (p.savedQueries ?? []).find((query) => query.id === id);
      if (saved) Object.assign(saved, patch, { updatedAt: Date.now() });
    }),
    removeSavedQuery: (id) => commit((p) => {
      p.savedQueries = (p.savedQueries ?? []).filter((query) => query.id !== id);
    }),

    addRelation: (r) => commit((p) => { p.relations ??= []; p.relations.push(r); }),
    updateRelation: (id, patch) => commit((p) => {
      const r = (p.relations ?? []).find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    }),
    removeRelation: (id) => commit((p) => {
      p.relations = (p.relations ?? []).filter((x) => x.id !== id);
    }),
    setRelationLayout: (positions) => commit((p) => {
      p.relationLayout = { ...(p.relationLayout ?? {}), ...positions };
    }),

    addArcStage: (a) => commit((p) => { p.arcs ??= []; p.arcs.push(a); }),
    updateArcStage: (id, patch) => commit((p) => {
      const a = (p.arcs ?? []).find((x) => x.id === id);
      if (a) Object.assign(a, patch);
    }),
    removeArcStage: (id) => commit((p) => {
      p.arcs = (p.arcs ?? []).filter((x) => x.id !== id);
    }),

    addForeshadow: (f) => commit((p) => { p.foreshadows ??= []; p.foreshadows.push(f); }),
    updateForeshadow: (id, fn) => commit((p) => {
      const f = (p.foreshadows ?? []).find((x) => x.id === id);
      if (f) fn(f);
    }),
    removeForeshadow: (id) => commit((p) => {
      p.foreshadows = (p.foreshadows ?? []).filter((x) => x.id !== id);
    }),

    addPalette: (pal) => commit((p) => { p.palettes ??= []; p.palettes.push(pal); }),
    updatePalette: (id, patch) => commit((p) => {
      const pal = (p.palettes ?? []).find((x) => x.id === id);
      if (pal) Object.assign(pal, patch);
    }),
    removePalette: (id) => commit((p) => {
      p.palettes = (p.palettes ?? []).filter((x) => x.id !== id);
      if (p.activePaletteId === id) p.activePaletteId = undefined;
    }),
    setActivePalette: (id) => commit((p) => { p.activePaletteId = id ?? undefined; }),

    createSnapshot: (name) => {
      const cur = get();
      const snap: Snapshot = { id: uid(), name: name || `版本 ${new Date().toLocaleString()}`, createdAt: Date.now(), data: JSON.stringify(cur.project) };
      const list = [snap, ...cur.snapshots].slice(0, 30); // 上限 30 个,避免 localStorage 爆
      const error = writeSnapshots(cur.currentSlotId, list);
      if (error) {
        set({ saveError: `快照保存失败:${error}`, storageUsage: getStorageUsage(localStorage) });
        return;
      }
      set({ snapshots: list, storageUsage: getStorageUsage(localStorage) });
    },
    restoreSnapshot: async (id) => {
      const cur = get();
      const snap = cur.snapshots.find((s) => s.id === id);
      if (!snap) return;
      try {
        const p = JSON.parse(snap.data) as Project;
        if (!p || p.version !== 1) throw new Error('快照格式不正确');
        normalizeProject(p);
        if (!await confirmDialog({ message: `回滚到「${snap.name}」?当前状态会进入撤销栈(可用 Ctrl+Z 恢复)。` })) return;
        undoStack.push(cur.project);
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        redoStack = [];
        lastUndoPush = 0;
        swapProject(p);
      } catch (e) {
        await alertDialog(`回滚失败:${e}`);
      }
    },
    deleteSnapshot: (id) => {
      const cur = get();
      const list = cur.snapshots.filter((s) => s.id !== id);
      const error = writeSnapshots(cur.currentSlotId, list);
      if (error) {
        set({ saveError: `快照删除失败:${error}`, storageUsage: getStorageUsage(localStorage) });
        return;
      }
      set({ snapshots: list, storageUsage: getStorageUsage(localStorage) });
    },
  };
});

/* ---------- 导入 / 导出 ---------- */

export function exportProject(p: Project) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.name || 'theloom'}.loom.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importProject(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = JSON.parse(String(reader.result)) as Project;
        if (!p || p.version !== 1 || !Array.isArray(p.flows)) throw new Error('文件格式不正确');
        resolve(normalizeProject(p));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
