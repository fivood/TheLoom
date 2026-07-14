import { create } from 'zustand';
import type { Entity, FlowNode, Project, SubFlow } from './types';
import { ENTITY_KIND_LABEL, FLOW_NODE_LABEL } from './types';

export type NavTab = 'flow' | 'entities' | 'brainstorm' | 'outline' | 'timeline' | 'map' | 'research' | 'variables';

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
}

interface NavState {
  target: NavTarget | null;
  seq: number;
  go: (t: NavTarget) => void;
  clear: () => void;
}

/** 跨模块跳转:搜索结果 / 反向引用点击后,由目标模块消费 */
export const useNav = create<NavState>((set) => ({
  target: null,
  seq: 0,
  go: (t) => set((s) => ({ target: t, seq: s.seq + 1 })),
  clear: () => set({ target: null }),
}));

export interface SearchHit {
  key: string;
  module: string;      // 分组标题
  kind: string;        // 类型标注
  title: string;
  snippet: string;
  nav: NavTarget;
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
        nav: { tab: 'outline' },
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
        nav: { tab: 'outline' },
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
