import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  MarkerType, Handle, Position,
  BaseEdge, EdgeLabelRenderer, getStraightPath, useInternalNode,
  type Node, type Edge, type NodeChange, type Connection, type NodeProps,
  type EdgeProps, type InternalNode,
} from '@xyflow/react';
import { uid, useLoom } from '../../store';
import { promptText, confirmDialog } from '../../dialog';
import { useNav } from '../../search';
import type { Entity, EntityKind } from '../../types';
import { ENTITY_KIND_LABEL, PALETTE } from '../../types';
import { getThemeMode, subscribeThemeMode } from '../../theme';

interface RelNodeData {
  name: string;
  emoji: string;
  avatar?: string;
  color: string;
  kind: EntityKind;
  [key: string]: unknown;
}
type RelNode = Node<RelNodeData>;

function EntityNode({ data, selected }: NodeProps<RelNode>) {
  return (
    <div className={`rel-entity ${selected ? 'selected' : ''}`} style={{ borderColor: data.color }}>
      <Handle type="target" position={Position.Left} />
      <div className="rel-entity-face">
        {data.avatar ? <img src={data.avatar} alt="" /> : <span>{data.emoji || '●'}</span>}
      </div>
      <div className="rel-entity-name">{data.name}</div>
      <div className="rel-entity-kind">{ENTITY_KIND_LABEL[data.kind]}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { relEntity: EntityNode };

/** 节点中心 */
function centerOf(node: InternalNode): { x: number; y: number } {
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? 96) / 2,
    y: node.internals.positionAbsolute.y + (node.measured.height ?? 100) / 2,
  };
}

/** 从节点中心朝 toward 方向与节点矩形边框的交点 */
function borderPoint(node: InternalNode, toward: { x: number; y: number }): { x: number; y: number } {
  const c = centerOf(node);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = (node.measured.width ?? 96) / 2 + 2;
  const hh = (node.measured.height ?? 100) / 2 + 2;
  const s = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** 浮动边:忽略固定把手,始终沿两节点边框最短方向连线;同对节点的多条边做垂直位移分开 */
function FloatingEdge({ id, source, target, markerEnd, style, label, selected, data }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const cs = centerOf(sourceNode);
  const ct = centerOf(targetNode);
  const p1 = borderPoint(sourceNode, ct);
  const p2 = borderPoint(targetNode, cs);
  const siblingIndex = (data as { siblingIndex?: number } | undefined)?.siblingIndex ?? 0;
  const siblingCount = (data as { siblingCount?: number } | undefined)?.siblingCount ?? 1;
  const spacing = 22;
  const offset = (siblingIndex - (siblingCount - 1) / 2) * spacing;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  // 垂直单位向量(逆时针 90°)
  const nx = -dy / len;
  const ny = dx / len;
  const sx = p1.x + nx * offset;
  const sy = p1.y + ny * offset;
  const tx = p2.x + nx * offset;
  const ty = p2.y + ny * offset;
  const [path, labelX, labelY] = getStraightPath({
    sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd as string | undefined} style={style} />
      {label != null && label !== '' && (
        <EdgeLabelRenderer>
          <div
            className={`rel-edge-label ${selected ? 'selected' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >{label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { floating: FloatingEdge };

const DEFAULT_KINDS: Record<EntityKind, boolean> = {
  character: true, faction: true, location: false, item: false, concept: false,
};

function defaultPosition(index: number, count: number): { x: number; y: number } {
  const radius = 160 + count * 14;
  const angle = (index / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
  return { x: 340 + radius * Math.cos(angle), y: 300 + radius * Math.sin(angle) };
}

function Canvas() {
  const project = useLoom((s) => s.project);
  const { addRelation, updateRelation, removeRelation, setRelationLayout } = useLoom();
  const go = useNav((s) => s.go);
  const [kinds, setKinds] = useState(DEFAULT_KINDS);
  const [selectedRelId, setSelectedRelId] = useState<string | null>(null);

  const relations = project.relations ?? [];
  const relatedIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of relations) { set.add(r.fromId); set.add(r.toId); }
    return set;
  }, [relations]);

  const visible = useMemo(
    () => project.entities.filter((e) => kinds[e.kind] || relatedIds.has(e.id)),
    [project.entities, kinds, relatedIds],
  );

  // 拖拽产生的临时位置(store 未 commit 前的中间态,避免每一帧都写 store)
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>({});

  const nodes: RelNode[] = useMemo(() => visible.map((e, i) => {
    const position = dragPos[e.id]
      ?? project.relationLayout?.[e.id]
      ?? defaultPosition(i, visible.length);
    return {
      id: e.id,
      type: 'relEntity' as const,
      position,
      data: { name: e.name, emoji: e.emoji, avatar: e.avatar, color: e.color, kind: e.kind },
    };
  }), [visible, project.relationLayout, dragPos]);

  const visibleIds = useMemo(() => new Set(visible.map((e) => e.id)), [visible]);
  const edges: Edge[] = useMemo(() => {
    const filtered = relations.filter((r) => visibleIds.has(r.fromId) && visibleIds.has(r.toId));
    const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
    const groupMembers = new Map<string, string[]>();
    for (const r of filtered) {
      const k = pairKey(r.fromId, r.toId);
      const arr = groupMembers.get(k) ?? [];
      arr.push(r.id);
      groupMembers.set(k, arr);
    }
    return filtered.map((r) => {
      const k = pairKey(r.fromId, r.toId);
      const members = groupMembers.get(k) ?? [r.id];
      const siblingIndex = members.indexOf(r.id);
      return {
        id: r.id,
        type: 'floating' as const,
        source: r.fromId,
        target: r.toId,
        label: r.label || '(未命名)',
        selected: r.id === selectedRelId,
        markerEnd: r.bidirectional ? undefined : { type: MarkerType.ArrowClosed, color: r.color || '#72716b' },
        style: { stroke: r.color || 'var(--edge)', strokeWidth: r.id === selectedRelId ? 2.5 : 1.5 },
        data: { siblingIndex, siblingCount: members.length },
      };
    });
  }, [relations, visibleIds, selectedRelId]);

  const themeMode = useSyncExternalStore(subscribeThemeMode, getThemeMode);

  const onNodesChange = useCallback((changes: NodeChange<RelNode>[]) => {
    // 只处理位置变化,累积到 dragPos;其他 change 交给 React Flow 内部
    setDragPos((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          next[c.id] = { x: c.position.x, y: c.position.y };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const onNodeDragStop = useCallback((_e: unknown, _node: RelNode, dragged: RelNode[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of dragged) positions[n.id] = { x: n.position.x, y: n.position.y };
    if (Object.keys(positions).length > 0) {
      setRelationLayout(positions);
      // commit 到 store 后清掉临时态,让 nodes 从 project.relationLayout 读
      setDragPos((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(positions)) delete next[id];
        return next;
      });
    }
  }, [setRelationLayout]);

  const onConnect = useCallback(async (conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return;
    const label = await promptText({ message: '这段关系叫什么?', placeholder: '如:兄妹 / 暗恋 / 宿敌', confirmText: '添加' });
    if (label === null) return;
    const id = uid();
    addRelation({ id, fromId: conn.source, toId: conn.target, label: label.trim() });
    setSelectedRelId(id);
  }, [addRelation]);

  const selectedRel = relations.find((r) => r.id === selectedRelId) ?? null;
  const nameOf = (id: string) => project.entities.find((e) => e.id === id)?.name ?? '?';

  return (
    <div className="planning-body">
      <div style={{ flex: 1, position: 'relative' }}>
        <div className="rel-kind-bar">
          {(Object.keys(ENTITY_KIND_LABEL) as EntityKind[]).map((k) => (
            <button
              key={k}
              className={`rel-kind-chip ${kinds[k] ? 'on' : ''}`}
              title={`显示 / 隐藏${ENTITY_KIND_LABEL[k]}(已有关系的实体始终显示)`}
              onClick={() => setKinds((s) => ({ ...s, [k]: !s[k] }))}
            >{ENTITY_KIND_LABEL[k]}</button>
          ))}
        </div>
        <ReactFlow
          className="rf-light"
          colorMode={themeMode}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onEdgeClick={(_e, edge) => setSelectedRelId(edge.id)}
          onPaneClick={() => setSelectedRelId(null)}
          nodesConnectable
          deleteKeyCode={null}
          fitView
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
        {project.entities.length === 0 && (
          <div className="empty-hint rel-empty">
            先在「实体」模块创建角色,再回来梳理关系
            <div style={{ marginTop: 8 }}>
              <button className="primary" onClick={() => go({ tab: 'entities' })}>去创建角色 →</button>
            </div>
          </div>
        )}
      </div>

      <aside className="planning-inspector">
        {selectedRel ? (
          <>
            <div className="field">
              <label>关系</label>
              <div className="rel-endpoints">
                {nameOf(selectedRel.fromId)} {selectedRel.bidirectional ? '⟷' : '→'} {nameOf(selectedRel.toId)}
              </div>
            </div>
            <div className="field">
              <label>关系名</label>
              <input
                value={selectedRel.label}
                placeholder="如:兄妹 / 暗恋 / 宿敌"
                onChange={(e) => updateRelation(selectedRel.id, { label: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={!!selectedRel.bidirectional}
                  onChange={(e) => updateRelation(selectedRel.id, { bidirectional: e.target.checked || undefined })}
                /> 双向关系(不画箭头)
              </label>
            </div>
            <div className="field">
              <label>颜色</label>
              <div className="color-row">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    className={`color-swatch ${selectedRel.color === c ? 'selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => updateRelation(selectedRel.id, { color: c })}
                  />
                ))}
                <button className="ghost" style={{ fontSize: 11 }} onClick={() => updateRelation(selectedRel.id, { color: undefined })}>默认</button>
              </div>
            </div>
            <div className="field">
              <label>备注</label>
              <textarea
                rows={4}
                value={selectedRel.note ?? ''}
                placeholder="这段关系的由来、现状、走向…"
                onChange={(e) => updateRelation(selectedRel.id, { note: e.target.value || undefined })}
              />
            </div>
            <button
              className="danger"
              onClick={async () => {
                if (await confirmDialog({ message: `删除关系「${selectedRel.label || '(未命名)'}」?`, danger: true, confirmText: '删除' })) {
                  setSelectedRelId(null);
                  removeRelation(selectedRel.id);
                }
              }}
            >删除这条关系</button>
          </>
        ) : (
          <div className="empty-hint" style={{ padding: '12px 0' }}>
            从实体节点右侧拖出连线到另一个实体即可建立关系;点击连线编辑
          </div>
        )}

        <div className="field" style={{ marginTop: 12 }}>
          <label>全部关系({relations.length})</label>
          <div className="rel-list">
            {relations.map((r) => (
              <button
                key={r.id}
                className={`rel-list-item ${r.id === selectedRelId ? 'active' : ''}`}
                onClick={() => setSelectedRelId(r.id)}
              >
                <span className="rel-list-label">{r.label || '(未命名)'}</span>
                <span className="rel-list-ends">{nameOf(r.fromId)} {r.bidirectional ? '⟷' : '→'} {nameOf(r.toId)}</span>
              </button>
            ))}
            {relations.length === 0 && <div className="empty-hint">还没有关系</div>}
          </div>
        </div>
        {selectedRel && (
          <button
            className="ghost"
            style={{ marginTop: 8 }}
            onClick={() => go({ tab: 'entities', entityId: selectedRel.fromId })}
          >在实体库中查看 {nameOf(selectedRel.fromId)} →</button>
        )}
      </aside>
    </div>
  );
}

export default function RelationGraph() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
