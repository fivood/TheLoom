import { create } from 'zustand';
import type {
  BrainEdge, BrainNote, Entity, Flow,
  OutlineColumn, OutlineRow, Project, ResearchCard, Variable,
} from './types';
import { normalizeProject, uid } from './util';
import { getSavedFolder, isTauri, saveToFolder } from './storage';

export { uid, normalizeProject };

const STORAGE_KEY = 'theloom-project-v1';

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

/* ---------- 内置示例项目(按需载入) ---------- */

function sampleProject(): Project {
  const heroId = uid();
  const mentorId = uid();
  const colForeshadow = uid();
  const colRomance = uid();
  const colSide = uid();
  const trackMain = uid(), trackMentor = uid();
  const pt1 = uid(), pt2 = uid(), pt3 = uid();

  const n1 = uid(), n2 = uid(), n3 = uid(), n4 = uid(), n5 = uid(), n6 = uid();

  return {
    version: 1,
    name: '未命名项目',
    flows: [
      {
        id: uid(),
        name: '第一章 · 开场',
        nodes: [
          { id: n1, type: 'fragment', position: { x: 40, y: 160 }, data: { title: '序幕', text: '深夜的旧书店,主角发现一本会自己翻页的书。' } },
          { id: n2, type: 'dialogue', position: { x: 340, y: 60 }, data: { title: '守店人开口', text: '「这本书……不是你在读它,是它在读你。」', speakerId: mentorId } },
          { id: n3, type: 'dialogue', position: { x: 340, y: 280 }, data: { title: '主角的疑问', text: '「你是谁?这里到底是什么地方?」', speakerId: heroId } },
          { id: n4, type: 'condition', position: { x: 660, y: 160 }, data: { title: '是否接过书?', text: 'took_book == true' } },
          { id: n5, type: 'fragment', position: { x: 960, y: 60 }, data: { title: '踏入织机', text: '书页展开成一道门,主角踏入了「叙事织机」的世界。' } },
          { id: n6, type: 'hub', position: { x: 960, y: 300 }, data: { title: '留在现实', text: '' } },
        ],
        edges: [
          { id: uid(), source: n1, target: n2 },
          { id: uid(), source: n1, target: n3 },
          { id: uid(), source: n2, target: n4 },
          { id: uid(), source: n3, target: n4 },
          { id: uid(), source: n4, sourceHandle: 'true', target: n5, label: '接过书' },
          { id: uid(), source: n4, sourceHandle: 'false', target: n6, label: '拒绝' },
        ],
      },
    ],
    entities: [
      {
        id: heroId, kind: 'character', name: '林晚', color: '#1b1b19', emoji: '🌙',
        summary: '深夜误入旧书店的年轻编剧,擅长把生活写成故事,却害怕自己的故事被别人书写。',
        fields: [
          { id: uid(), label: '年龄', value: '26' },
          { id: uid(), label: '职业', value: '编剧' },
          { id: uid(), label: '欲望', value: '写出一个真正属于自己的故事' },
          { id: uid(), label: '恐惧', value: '失去对人生叙事的掌控' },
        ],
        notes: '', createdAt: Date.now(),
      },
      {
        id: mentorId, kind: 'character', name: '守店人', color: '#565550', emoji: '📖',
        summary: '旧书店的看守者,叙事织机的引路人。说话总是只说一半。',
        fields: [
          { id: uid(), label: '身份', value: '织机的看守者' },
          { id: uid(), label: '秘密', value: '曾经也是被书选中的人' },
        ],
        notes: '', createdAt: Date.now(),
      },
      {
        id: uid(), kind: 'location', name: '旧书店「回声」', color: '#8e8d86', emoji: '🏮',
        summary: '只在雨夜营业的书店,书架的尽头连接着叙事织机。',
        fields: [{ id: uid(), label: '氛围', value: '潮湿、暖黄灯光、纸张的味道' }],
        notes: '', createdAt: Date.now(),
      },
    ],
    brainstormNotes: [
      { id: uid(), text: '核心意象:织机 = 故事的经纬线', color: '#ffffff', position: { x: 120, y: 80 } },
      { id: uid(), text: '如果主角发现自己也是别人写的角色?', color: '#e6e4df', position: { x: 420, y: 40 } },
      { id: uid(), text: '守店人的真实身份留到第三幕揭晓', color: '#d8d6d0', position: { x: 420, y: 220 } },
      { id: uid(), text: '每章开头引用一句"书中书"的句子', color: '#f2f1ee', position: { x: 120, y: 260 } },
    ],
    brainstormEdges: [],
    outlineColumns: [
      { id: colForeshadow, title: '伏笔 / 预言', color: '#3a3936' },
      { id: colRomance, title: '感情线', color: '#72716b' },
      { id: colSide, title: '配角线', color: '#8e8d86' },
    ],
    outlineRows: [
      {
        id: uid(), no: '1', time: '雨夜', title: '会翻页的书',
        main: '林晚躲雨进入旧书店,发现一本自己翻页的书,守店人现身。',
        cells: {
          [colForeshadow]: '书的扉页写着林晚的名字(未点明)',
          [colRomance]: '',
          [colSide]: '守店人只说一半的话',
        },
      },
      {
        id: uid(), no: '2', time: '次日清晨', title: '织机初现',
        main: '林晚接过书,踏入叙事织机,看见无数交织的故事线。',
        cells: {
          [colForeshadow]: '有一根断掉的线,颜色和林晚的名字一样',
          [colRomance]: '',
          [colSide]: '',
        },
      },
      {
        id: uid(), no: '3', time: '同日', title: '第一根线',
        main: '守店人教林晚修补一个濒临崩坏的小故事。',
        cells: {
          [colForeshadow]: '',
          [colRomance]: '故事里的少年对林晚说了句谢谢',
          [colSide]: '守店人的手在碰到织机时颤抖',
        },
      },
    ],
    timelineTracks: [
      { id: trackMain, name: '主线 · 林晚', color: '#1b1b19' },
      { id: trackMentor, name: '暗线 · 守店人', color: '#565550' },
    ],
    timelinePoints: [
      { id: pt1, label: '二十年前' },
      { id: pt2, label: '雨夜' },
      { id: pt3, label: '次日清晨' },
    ],
    timelineEvents: [
      {
        id: uid(), trackId: trackMentor, pointId: pt1,
        title: '守店人被书选中', text: '当年的守店人也曾接过一本会翻页的书,从此困在书店。',
        entityIds: [mentorId],
      },
      {
        id: uid(), trackId: trackMain, pointId: pt2,
        title: '林晚进入书店', text: '躲雨,遇见会翻页的书。',
        entityIds: [heroId],
      },
      {
        id: uid(), trackId: trackMentor, pointId: pt2,
        title: '守店人认出预兆', text: '书自己翻页 = 织机在挑选新的看守者。他沉默未言。',
        entityIds: [mentorId],
      },
      {
        id: uid(), trackId: trackMain, pointId: pt3,
        title: '踏入织机', text: '林晚接过书,看见交织的故事线。',
        entityIds: [heroId],
      },
    ],
    researchCards: [
      {
        id: uid(), title: '织机的结构', content: '经线 = 时间,纬线 = 人物。断线意味着故事夭折。修补需要"读者的记忆"作为丝线。',
        category: '世界观', tags: ['核心设定'], color: '#1b1b19', source: '', pinned: true, createdAt: Date.now(),
      },
      {
        id: uid(), title: '真实的织布机原理', content: '传统织布机:经纱固定在机架上,梭子带着纬纱来回穿行。提综装置决定哪些经纱抬起——可类比"哪些角色在这一章登场"。',
        category: '参考资料', tags: ['考据'], color: '#aaa9a1', source: '', pinned: false, createdAt: Date.now(),
      },
      {
        id: uid(), title: '罗琳的表格大纲法', content: 'J.K.罗琳为《凤凰社》手绘表格:每行一章,列为时间、章节标题、主线剧情,以及预言、DA、恋爱线等各条支线——确保每条线在每一章都有交代或有意留白。',
        category: '写作方法', tags: ['大纲', '结构'], color: '#3a3936', source: '', pinned: false, createdAt: Date.now(),
      },
    ],
    researchCategories: ['世界观', '写作方法', '参考资料'],
    variables: [
      { id: uid(), name: 'took_book', type: 'boolean', value: 'false', description: '林晚是否接过守店人的书' },
      { id: uid(), name: 'threads_repaired', type: 'number', value: '0', description: '已修补的故事线数量' },
    ],
    updatedAt: Date.now(),
  };
}

function loadProject(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (p && p.version === 1) return normalizeProject(p);
    }
  } catch { /* 损坏则重建 */ }
  return blankProject();
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

export const useLoom = create<LoomState>((set, get) => {
  const persist = (p: Project) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
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
    project: loadProject(),
    savedAt: Date.now(),
    revision: 0,
    canUndo: false,
    canRedo: false,
    folder: isTauri ? getSavedFolder() : null,
    syncError: null,
    setFolder: (dir) => set({ folder: dir, syncError: null }),

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
