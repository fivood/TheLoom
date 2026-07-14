import { create } from 'zustand';
import type {
  BrainEdge, BrainNote, Entity, Flow,
  OutlineColumn, OutlineRow, Project, ResearchCard, Variable,
} from './types';
import { normalizeProject, uid } from './util';
import { getSavedFolder, isTauri, saveToFolder } from './storage';
import { sampleProject } from './sample';

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
const projectKey = (id: string) => `theloom-project-${id}`;

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
    researchCards: [],
    researchCategories: [],
    variables: [],
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
function readProjectAt(id: string): Project | null {
  try {
    const raw = localStorage.getItem(projectKey(id));
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (p && p.version === 1) return normalizeProject(p);
    }
  } catch { /* 忽略 */ }
  return null;
}

/** 应用启动时的初始化:返回槽位列表、当前 id、当前项目 */
function initSlots(): { slots: SlotMeta[]; currentId: string; project: Project } {
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

  const project = readProjectAt(id) ?? blankProject();
  return { slots, currentId: id, project };
}

/* ---------- Store ---------- */

interface LoomState {
  project: Project;
  savedAt: number;
  /** 撤销/重做后递增,用于强制画布类组件重新挂载 */
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Tauri 模式下的项目文件夹路径;null = 仅存浏览器 */
  folder: string | null;
  syncError: string | null;
  setFolder: (dir: string | null) => void;
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
  newSlot: (kind: 'blank' | 'sample') => void;
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
        localStorage.setItem(projectKey(id), JSON.stringify(p));
        // 同步更新槽位元数据(名称、更新时间)
        const slots = get().slots.map((s) =>
          s.id === id ? { ...s, name: p.name || '未命名项目', updatedAt: p.updatedAt } : s,
        );
        writeSlots(slots);
        set({ slots });
      } catch (e) {
        console.error('保存失败', e);
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
      localStorage.setItem(projectKey(cur.currentSlotId), JSON.stringify(cur.project));
    } catch { /* 忽略 */ }
    localStorage.setItem(CURRENT_KEY, targetId);
    undoStack = []; redoStack = []; lastUndoPush = 0;
    const next = readProjectAt(targetId) ?? blankProject();
    set((s) => ({
      project: next,
      currentSlotId: targetId,
      savedAt: Date.now(),
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
    next.updatedAt = Date.now();
    persist(next);
    set({ project: next, savedAt: Date.now(), canUndo: true, canRedo: false });
  };

  /** 整项目替换(撤销/重做/导入/重置)后递增 revision,让画布重新挂载 */
  const swapProject = (p: Project, extra?: Partial<LoomState>) => {
    persist(p);
    set((s) => ({
      project: p, savedAt: Date.now(), revision: s.revision + 1,
      canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
      ...extra,
    }));
  };

  return {
    project: boot.project,
    savedAt: Date.now(),
    revision: 0,
    canUndo: false,
    canRedo: false,
    folder: isTauri ? getSavedFolder() : null,
    syncError: null,
    setFolder: (dir) => set({ folder: dir, syncError: null }),

    slots: boot.slots,
    currentSlotId: boot.currentId,

    switchSlot: (id) => {
      const cur = get().currentSlotId;
      if (id === cur) return;
      if (!get().slots.some((s) => s.id === id)) return;
      flushAndSwitch(id);
    },
    newSlot: (kind) => {
      const newId = uid();
      const proj = kind === 'sample' ? sampleProject() : blankProject();
      localStorage.setItem(projectKey(newId), JSON.stringify(proj));
      const meta: SlotMeta = { id: newId, name: proj.name, updatedAt: Date.now() };
      const nextSlots = [...get().slots, meta];
      writeSlots(nextSlots);
      set({ slots: nextSlots });
      flushAndSwitch(newId);
    },
    deleteSlot: (id) => {
      const cur = get();
      if (cur.slots.length <= 1) return; // 至少留一个
      const nextSlots = cur.slots.filter((s) => s.id !== id);
      writeSlots(nextSlots);
      localStorage.removeItem(projectKey(id));
      set({ slots: nextSlots });
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
