import { create } from 'zustand';
import type { Asset, Document, Entity, FlowNode, Project, SubFlow } from './types';
import { ENTITY_KIND_LABEL, FLOW_NODE_LABEL } from './types';
import { workspaceTabLabel } from './workspace';

export type NavTab = 'flow' | 'entities' | 'assets' | 'documents' | 'brainstorm' | 'outline' | 'timeline' | 'map' | 'research' | 'variables' | 'planning';

export interface NavTarget {
  tab: NavTab;
  flowId?: string;
  path?: string[];
  nodeId?: string;
  entityId?: string;
  cardId?: string;
  eventId?: string;
  mapId?: string;
  markerId?: string;
  assetId?: string;
  docId?: string;
  blockId?: string;
  outlineRowId?: string;
  /** 规划模块:定位伏笔台账条目 */
  foreshadowId?: string;
  /** 规划模块:打开的子视图 */
  planningView?: 'relations' | 'arcs' | 'foreshadow' | 'appearance' | 'wall' | 'pacing';
}

interface NavState {
  target: NavTarget | null;
  seq: number;
  current: NavVisit | null;
  backStack: NavVisit[];
  recent: NavVisit[];
  go: (t: NavTarget, label?: string) => void;
  visit: (t: NavTarget, label: string) => void;
  back: () => void;
  setCurrentLabel: (label: string) => void;
  clear: () => void;
}

export interface NavVisit {
  target: NavTarget;
  label: string;
}

const navKey = (target: NavTarget): string => JSON.stringify(target);
const isModuleRootFor = (current: NavVisit | null, target: NavTarget): boolean => Boolean(
  current
  && current.target.tab === target.tab
  && Object.keys(current.target).length === 1,
);
const pushRecent = (recent: NavVisit[], visit: NavVisit): NavVisit[] => [
  visit,
  ...recent.filter((item) => navKey(item.target) !== navKey(visit.target)),
].slice(0, 12);

/** 跨模块跳转:搜索结果 / 反向引用点击后,由目标模块消费 */
export const useNav = create<NavState>((set) => ({
  target: null,
  seq: 0,
  current: null,
  backStack: [],
  recent: [],
  go: (target, label) => set((state) => {
    const visit = { target, label: label ?? '前往目标' };
    const changed = !state.current || navKey(state.current.target) !== navKey(target);
    const pushCurrent = changed && state.current && !isModuleRootFor(state.current, target);
    return {
      target,
      seq: state.seq + 1,
      current: visit,
      backStack: pushCurrent ? [...state.backStack, state.current!].slice(-30) : state.backStack,
      recent: pushRecent(state.recent, visit),
    };
  }),
  visit: (target, label) => set((state) => {
    const visit = { target, label };
    const changed = !state.current || navKey(state.current.target) !== navKey(target);
    const pushCurrent = changed && state.current && !isModuleRootFor(state.current, target);
    return {
      current: visit,
      backStack: pushCurrent ? [...state.backStack, state.current!].slice(-30) : state.backStack,
      recent: pushRecent(state.recent, visit),
    };
  }),
  back: () => set((state) => {
    const previous = state.backStack[state.backStack.length - 1];
    if (!previous) return state;
    return {
      target: previous.target,
      seq: state.seq + 1,
      current: previous,
      backStack: state.backStack.slice(0, -1),
      recent: pushRecent(state.recent, previous),
    };
  }),
  setCurrentLabel: (label) => set((state) => state.current ? {
    current: { ...state.current, label },
    recent: pushRecent(state.recent, { ...state.current, label }),
  } : state),
  clear: () => set({ target: null }),
}));

export function describeNavTarget(project: Project, target: NavTarget): string {
  const preset = project.workspacePreset ?? 'universal';
  if (target.docId) return `场景 · ${project.documents.find((document) => document.id === target.docId)?.name ?? '已删除场景'}`;
  if (target.flowId) return `流程 · ${project.flows.find((flow) => flow.id === target.flowId)?.name ?? '已删除流程'}`;
  if (target.planningView) {
    const labels: Record<NonNullable<NavTarget['planningView']>, string> = {
      relations: '关系图', arcs: '角色弧线', foreshadow: '伏笔台账', appearance: '登场统计', wall: '场景墙', pacing: '节奏图',
    };
    return `规划 · ${labels[target.planningView]}`;
  }
  if (target.entityId) return `${preset === 'novel' ? '人物' : '实体'} · ${project.entities.find((entity) => entity.id === target.entityId)?.name ?? '已删除实体'}`;
  if (target.eventId) return `时间线 · ${project.timelineEvents.find((event) => event.id === target.eventId)?.title ?? '已删除事件'}`;
  if (target.outlineRowId) {
    const row = project.outlineRows.find((candidate) => candidate.id === target.outlineRowId);
    return `大纲 · ${row?.title || row?.no || '已删除行'}`;
  }
  if (target.cardId) return `资料 · ${project.researchCards.find((card) => card.id === target.cardId)?.title ?? '已删除资料'}`;
  if (target.assetId) return `资源 · ${project.assets.find((asset) => asset.id === target.assetId)?.name ?? '已删除资源'}`;
  return workspaceTabLabel(preset, target.tab);
}

export interface SearchHit {
  key: string;
  module: string;      // 分组标题
  kind: string;        // 类型标注
  title: string;
  snippet: string;
  nav: NavTarget;
  /** 共享叙事单元的 id。同一 unitId 的多条命中(流程节点 + 文档块)
   * 在 UI 上会加⇄徽标,提示是同一份内容的镜像。 */
  unitId?: string;
}

function snippetOf(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 60);
  const start = Math.max(0, i - 20);
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 40);
}

function matches(q: string, ...fields: (string | undefined)[]): string | null {
  for (const f of fields) {
    if (f && f.toLowerCase().includes(q.toLowerCase())) return f;
  }
  return null;
}

export function searchProject(p: Project, query: string): SearchHit[] {
  const q = query.trim();
  if (q.length < 1) return [];
  const hits: SearchHit[] = [];
  const push = (h: Omit<SearchHit, 'key'>) => {
    if (hits.length < 60) hits.push({ ...h, key: `${h.nav.tab}-${hits.length}` });
  };

  for (const flow of p.flows) {
    const walk = (sub: SubFlow, path: string[], crumb: string) => {
      for (const n of sub.nodes) {
        const hit = matches(q, n.data.title, n.data.text);
        if (hit) {
          push({
            module: '流程', kind: FLOW_NODE_LABEL[n.type],
            title: n.data.title || FLOW_NODE_LABEL[n.type],
            snippet: `${crumb} · ${snippetOf(hit, q)}`,
            nav: { tab: 'flow', flowId: flow.id, path, nodeId: n.id },
            unitId: n.data.unitId,
          });
        }
        if (n.data.sub) walk(n.data.sub, [...path, n.id], `${crumb} ▸ ${n.data.title || '片段'}`);
      }
    };
    walk(flow, [], flow.name);
  }

  for (const e of p.entities) {
    const hit = matches(q, e.name, e.summary, e.notes, ...e.fields.flatMap((f) => [f.label, f.value]));
    if (hit) {
      push({
        module: '实体', kind: ENTITY_KIND_LABEL[e.kind], title: e.name,
        snippet: snippetOf(hit, q),
        nav: { tab: 'entities', entityId: e.id },
      });
    }
  }

  for (const c of p.researchCards) {
    const hit = matches(q, c.title, c.content, c.category, c.source, ...c.tags);
    if (hit) {
      push({
        module: '资料', kind: c.category, title: c.title,
        snippet: snippetOf(hit, q),
        nav: { tab: 'research', cardId: c.id },
      });
    }
  }

  for (const r of p.outlineRows) {
    const hit = matches(q, r.no, r.time, r.title, r.main, ...Object.values(r.cells));
    if (hit) {
      push({
        module: '大纲', kind: `第 ${r.no || '?'} 章`, title: r.title || '(未命名章节)',
        snippet: snippetOf(hit, q),
        nav: { tab: 'outline', outlineRowId: r.id },
      });
    }
  }

  for (const ev of p.timelineEvents) {
    const hit = matches(q, ev.title, ev.text);
    if (hit) {
      const pt = p.timelinePoints.find((x) => x.id === ev.pointId);
      push({
        module: '时间线', kind: pt?.label || '事件', title: ev.title,
        snippet: snippetOf(hit, q),
        nav: { tab: 'timeline', eventId: ev.id },
      });
    }
  }

  for (const n of p.brainstormNotes) {
    const hit = matches(q, n.text);
    if (hit) {
      push({
        module: '风暴', kind: '便签', title: snippetOf(n.text, q).slice(0, 24),
        snippet: snippetOf(hit, q),
        nav: { tab: 'brainstorm' },
      });
    }
  }

  for (const v of p.variables) {
    const hit = matches(q, v.name, v.description);
    if (hit) {
      push({
        module: '变量', kind: v.type, title: v.name,
        snippet: snippetOf(hit, q),
        nav: { tab: 'variables' },
      });
    }
  }

  for (const a of p.assets) {
    const hit = matches(q, a.name, a.notes, a.source, ...a.tags);
    if (hit) {
      push({
        module: '资源', kind: a.kind, title: a.name,
        snippet: snippetOf(hit, q),
        nav: { tab: 'assets', assetId: a.id },
      });
    }
  }

  for (const d of p.documents) {
    // 文档级命中(题名 / 备注)
    const docLevelHit = matches(q, d.name, d.notes);
    // 逐块命中:携带块 unitId 以便与流程命中做⇄配对
    const blockUnitIds: string[] = [];
    let blockHit: string | undefined;
    for (const b of d.blocks) {
      const h = matches(q, b.text, ...(b.items ?? []));
      if (h) { blockHit = blockHit ?? h; if (b.unitId) blockUnitIds.push(b.unitId); }
    }
    const hit = docLevelHit ?? blockHit;
    if (hit) {
      push({
        module: '文档', kind: d.category, title: d.name,
        snippet: snippetOf(hit, q),
        nav: { tab: 'documents', docId: d.id },
        // 单命中就明确关联那个单元;多命中不设 unitId,避免误配
        unitId: blockUnitIds.length === 1 ? blockUnitIds[0] : undefined,
      });
    }
  }

  for (const f of p.foreshadows ?? []) {
    const hit = matches(q, f.title, f.note);
    if (hit) {
      push({
        module: '规划', kind: '伏笔', title: f.title || '(未命名伏笔)',
        snippet: snippetOf(hit, q),
        nav: { tab: 'planning', planningView: 'foreshadow', foreshadowId: f.id },
      });
    }
  }

  for (const a of p.arcs ?? []) {
    const hit = matches(q, a.title, a.note);
    if (hit) {
      const owner = p.entities.find((e) => e.id === a.entityId);
      push({
        module: '规划', kind: `弧线 · ${owner?.name ?? '?'}`, title: a.title || '(未命名阶段)',
        snippet: snippetOf(hit, q),
        nav: { tab: 'planning', planningView: 'arcs', entityId: a.entityId },
      });
    }
  }

  return hits;
}

/** 实体反向引用:该实体在项目各处的出现位置 */
export function findEntityRefs(p: Project, entity: Entity): SearchHit[] {
  const hits: SearchHit[] = [];
  const name = entity.name.trim();
  const mention = (text?: string) => name.length >= 2 && !!text && text.includes(name);
  const push = (h: Omit<SearchHit, 'key'>) => {
    if (hits.length < 40) hits.push({ ...h, key: `ref-${hits.length}` });
  };

  for (const flow of p.flows) {
    const walk = (sub: SubFlow, path: string[], crumb: string) => {
      for (const n of sub.nodes as FlowNode[]) {
        if (n.data.speakerId === entity.id) {
          push({
            module: '流程', kind: '说话人',
            title: n.data.title || '对白',
            snippet: `${crumb} · ${(n.data.text || '').slice(0, 40)}`,
            nav: { tab: 'flow', flowId: flow.id, path, nodeId: n.id },
          });
        } else if (mention(n.data.text) || mention(n.data.title)) {
          push({
            module: '流程', kind: '提及',
            title: n.data.title || FLOW_NODE_LABEL[n.type],
            snippet: `${crumb} · ${snippetOf(n.data.text || n.data.title, name)}`,
            nav: { tab: 'flow', flowId: flow.id, path, nodeId: n.id },
          });
        }
        if (n.data.sub) walk(n.data.sub, [...path, n.id], `${crumb} ▸ ${n.data.title || '片段'}`);
      }
    };
    walk(flow, [], flow.name);
  }

  for (const ev of p.timelineEvents) {
    if (ev.entityIds.includes(entity.id)) {
      const pt = p.timelinePoints.find((x) => x.id === ev.pointId);
      push({
        module: '时间线', kind: pt?.label || '事件', title: ev.title,
        snippet: (ev.text || '').slice(0, 50),
        nav: { tab: 'timeline', eventId: ev.id },
      });
    }
  }

  for (const r of p.outlineRows) {
    const all = [r.title, r.main, ...Object.values(r.cells)];
    if (all.some(mention)) {
      push({
        module: '大纲', kind: `第 ${r.no || '?'} 章`, title: r.title || '(未命名章节)',
        snippet: snippetOf(all.find(mention) ?? '', name),
        nav: { tab: 'outline', outlineRowId: r.id },
      });
    }
  }

  for (const c of p.researchCards) {
    if (mention(c.title) || mention(c.content)) {
      push({
        module: '资料', kind: c.category, title: c.title,
        snippet: snippetOf(mention(c.title) ? c.title : c.content, name),
        nav: { tab: 'research', cardId: c.id },
      });
    }
  }

  for (const n of p.brainstormNotes) {
    if (mention(n.text)) {
      push({
        module: '风暴', kind: '便签', title: snippetOf(n.text, name).slice(0, 24),
        snippet: snippetOf(n.text, name),
        nav: { tab: 'brainstorm' },
      });
    }
  }

  for (const rel of p.relations ?? []) {
    if (rel.fromId === entity.id || rel.toId === entity.id) {
      const otherId = rel.fromId === entity.id ? rel.toId : rel.fromId;
      const other = p.entities.find((e) => e.id === otherId);
      push({
        module: '规划', kind: '关系', title: `${rel.label || '(未命名关系)'} · ${other?.name ?? '?'}`,
        snippet: rel.note ?? '',
        nav: { tab: 'planning', planningView: 'relations' },
      });
    }
  }

  for (const a of p.arcs ?? []) {
    if (a.entityId === entity.id) {
      push({
        module: '规划', kind: '弧线阶段', title: a.title || '(未命名阶段)',
        snippet: (a.note || '').slice(0, 50),
        nav: { tab: 'planning', planningView: 'arcs', entityId: entity.id },
      });
    }
  }

  // 实体字段的引用(id 精确匹配)
  for (const other of p.entities) {
    if (other.id === entity.id) continue;
    for (const f of other.fields) {
      const ids = f.type === 'entity' ? (f.value ? [f.value] : [])
        : f.type === 'entities' ? f.value.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      if (ids.includes(entity.id)) {
        push({
          module: '实体', kind: `${other.name} · ${f.label}`, title: other.name,
          snippet: `${ENTITY_KIND_LABEL[other.kind]}`,
          nav: { tab: 'entities', entityId: other.id },
        });
      }
    }
  }

  for (const map of p.maps) {
    for (const mk of map.markers) {
      if (mk.entityId === entity.id) {
        push({
          module: '地图', kind: map.name, title: mk.label || entity.name,
          snippet: '标记',
          nav: { tab: 'map', mapId: map.id, markerId: mk.id },
        });
      }
    }
    for (const r of map.regions) {
      if (r.entityId === entity.id) {
        push({
          module: '地图', kind: map.name, title: r.label || entity.name,
          snippet: `区域(${r.points.length} 顶点)`,
          nav: { tab: 'map', mapId: map.id },
        });
      }
    }
  }

  return hits;
}

export function findDocumentRefs(p: Project, document: Document): SearchHit[] {
  const hits: SearchHit[] = [];
  const push = (hit: Omit<SearchHit, 'key'>) => {
    if (hits.length < 40) hits.push({ ...hit, key: `doc-ref-${hits.length}` });
  };

  for (const flow of p.flows) {
    if (flow.documentId !== document.id) continue;
    push({
      module: '流程', kind: '关联流程', title: flow.name,
      snippet: '流程结构与该场景关联',
      nav: { tab: 'flow', flowId: flow.id },
    });
  }
  for (const row of p.outlineRows) {
    if (row.documentId !== document.id) continue;
    push({
      module: '大纲', kind: `第 ${row.no || '?'} 行`, title: row.title || '(未命名章节)',
      snippet: row.main.slice(0, 50),
      nav: { tab: 'outline', outlineRowId: row.id },
    });
  }
  for (const event of p.timelineEvents) {
    if (!event.documentIds?.includes(document.id)) continue;
    const point = p.timelinePoints.find((candidate) => candidate.id === event.pointId);
    push({
      module: '时间线', kind: point?.label || '事件', title: event.title,
      snippet: event.text.slice(0, 50),
      nav: { tab: 'timeline', eventId: event.id },
    });
  }
  for (const stage of p.arcs ?? []) {
    if (stage.docId !== document.id) continue;
    const entity = p.entities.find((candidate) => candidate.id === stage.entityId);
    push({
      module: '规划', kind: `弧线 · ${entity?.name ?? '?'}`, title: stage.title || '(未命名阶段)',
      snippet: stage.note.slice(0, 50),
      nav: { tab: 'planning', planningView: 'arcs', entityId: stage.entityId },
    });
  }
  for (const foreshadow of p.foreshadows ?? []) {
    const plants = foreshadow.plants.filter((ref) => ref.docId === document.id).length;
    const payoffs = foreshadow.payoffs.filter((ref) => ref.docId === document.id).length;
    if (plants + payoffs === 0) continue;
    push({
      module: '规划', kind: plants > 0 && payoffs > 0 ? '伏笔埋设与回收' : plants > 0 ? '伏笔埋设' : '伏笔回收',
      title: foreshadow.title,
      snippet: foreshadow.note.slice(0, 50),
      nav: { tab: 'planning', planningView: 'foreshadow', foreshadowId: foreshadow.id },
    });
  }

  return hits;
}

/** 资产反向引用:该资源被哪些对象挂为附件 */
export function findAssetRefs(p: Project, asset: Asset): SearchHit[] {
  const hits: SearchHit[] = [];
  const push = (h: Omit<SearchHit, 'key'>) => {
    if (hits.length < 40) hits.push({ ...h, key: `ref-${hits.length}` });
  };

  if (!p.attachments) return hits;

  // 建立 ownerId → 它是什么对象的反查表
  // 实体
  for (const e of p.entities) {
    if ((p.attachments[e.id] ?? []).includes(asset.id)) {
      push({
        module: '实体', kind: ENTITY_KIND_LABEL[e.kind], title: e.name,
        snippet: '附件',
        nav: { tab: 'entities', entityId: e.id },
      });
    }
  }
  // 资料卡
  for (const c of p.researchCards) {
    if ((p.attachments[c.id] ?? []).includes(asset.id)) {
      push({
        module: '资料', kind: c.category, title: c.title,
        snippet: '附件',
        nav: { tab: 'research', cardId: c.id },
      });
    }
  }
  // 文档块
  for (const d of p.documents) {
    for (const b of d.blocks) {
      if ((p.attachments[b.id] ?? []).includes(asset.id)) {
        push({
          module: '文档', kind: d.category, title: d.name,
          snippet: `块 · ${b.text.slice(0, 40) || b.type}`,
          nav: { tab: 'documents', docId: d.id, blockId: b.id },
        });
      }
    }
  }
  // 流程节点(任意深度)
  for (const flow of p.flows) {
    const walk = (sub: SubFlow, path: string[], crumb: string) => {
      for (const n of sub.nodes as FlowNode[]) {
        if ((p.attachments![n.id] ?? []).includes(asset.id)) {
          push({
            module: '流程', kind: FLOW_NODE_LABEL[n.type], title: n.data.title || FLOW_NODE_LABEL[n.type],
            snippet: `${crumb} · 附件`,
            nav: { tab: 'flow', flowId: flow.id, path, nodeId: n.id },
          });
        }
        if (n.data.sub) walk(n.data.sub, [...path, n.id], `${crumb} ▸ ${n.data.title || '片段'}`);
      }
    };
    walk(flow, [], flow.name);
  }
  // 大纲行
  for (const r of p.outlineRows) {
    if ((p.attachments[r.id] ?? []).includes(asset.id)) {
      push({
        module: '大纲', kind: `第 ${r.no || '?'} 章`, title: r.title || '(未命名章节)',
        snippet: '附件',
        nav: { tab: 'outline' },
      });
    }
  }
  // 时间线事件
  for (const ev of p.timelineEvents) {
    if ((p.attachments[ev.id] ?? []).includes(asset.id)) {
      const pt = p.timelinePoints.find((x) => x.id === ev.pointId);
      push({
        module: '时间线', kind: pt?.label || '事件', title: ev.title,
        snippet: '附件',
        nav: { tab: 'timeline', eventId: ev.id },
      });
    }
  }

  return hits;
}
