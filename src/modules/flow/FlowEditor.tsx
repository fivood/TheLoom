import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow, MarkerType,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import { uid, useLoom } from '../../store';
import type { Flow, FlowNodeData, FlowNodeType } from '../../types';
import { FLOW_NODE_LABEL, PALETTE } from '../../types';
import { nodeTypes, TYPE_COLORS } from './nodes';

type LoomNode = Node<FlowNodeData>;

const EDGE_STYLE = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
} as const;

function toRfNodes(flow: Flow): LoomNode[] {
  return flow.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }));
}
function toRfEdges(flow: Flow): Edge[] {
  return flow.edges.map((e) => ({ ...e, ...EDGE_STYLE }));
}

function Canvas({ flow }: { flow: Flow }) {
  const updateFlow = useLoom((s) => s.updateFlow);
  const entities = useLoom((s) => s.project.entities);
  const [nodes, setNodes] = useState<LoomNode[]>(() => toRfNodes(flow));
  const [edges, setEdges] = useState<Edge[]>(() => toRfEdges(flow));
  const { screenToFlowPosition } = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);

  // 本地画布状态防抖回写 store
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      updateFlow(flow.id, (f) => {
        f.nodes = nodes.map((n) => ({
          id: n.id,
          type: (n.type ?? 'fragment') as FlowNodeType,
          position: { x: n.position.x, y: n.position.y },
          data: n.data,
        }));
        f.edges = edges.map((e) => ({
          id: e.id, source: e.source, target: e.target,
          sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
          label: typeof e.label === 'string' ? e.label : undefined,
        }));
      });
    }, 350);
    return () => clearTimeout(t);
  }, [nodes, edges]);

  const onNodesChange = useCallback((changes: NodeChange<LoomNode>[]) => {
    dirty.current = true;
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    dirty.current = true;
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);
  const onConnect = useCallback((conn: Connection) => {
    dirty.current = true;
    setEdges((es) => addEdge({ ...conn, id: uid(), ...EDGE_STYLE }, es));
  }, []);

  const addNode = (type: FlowNodeType) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const center = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 100, y: 100 };
    const node: LoomNode = {
      id: uid(),
      type,
      position: { x: center.x - 95 + Math.random() * 40, y: center.y - 40 + Math.random() * 40 },
      data: { title: '', text: '' },
      selected: true,
    };
    dirty.current = true;
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node]);
  };

  const selectedNode = nodes.find((n) => n.selected);
  const selectedEdge = edges.find((e) => e.selected);

  const patchSelectedNode = (patch: Partial<FlowNodeData>) => {
    if (!selectedNode) return;
    dirty.current = true;
    setNodes((ns) => ns.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };
  const patchSelectedEdgeLabel = (label: string) => {
    if (!selectedEdge) return;
    dirty.current = true;
    setEdges((es) => es.map((e) => (e.id === selectedEdge.id ? { ...e, label } : e)));
  };

  const characters = useMemo(() => entities.filter((e) => e.kind === 'character'), [entities]);

  return (
    <>
      <div className="pane-col">
        <div className="toolbar">
          {(Object.keys(FLOW_NODE_LABEL) as FlowNodeType[]).map((t) => (
            <button key={t} onClick={() => addNode(t)}>
              <span style={{ color: TYPE_COLORS[t] }}>●</span> {FLOW_NODE_LABEL[t]}
            </button>
          ))}
          <span className="hint">拖拽连接节点 · Delete 删除选中</span>
        </div>
        <div ref={wrapRef} style={{ flex: 1 }}>
          <ReactFlow
            className="rf-dark"
            colorMode="dark"
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            deleteKeyCode={['Delete', 'Backspace']}
            fitView
            minZoom={0.15}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </div>

      <aside className="inspector">
        {selectedNode ? (
          <>
            <h3>节点属性 · {FLOW_NODE_LABEL[(selectedNode.type ?? 'fragment') as FlowNodeType]}</h3>
            <div className="field">
              <label>标题</label>
              <input value={selectedNode.data.title} onChange={(e) => patchSelectedNode({ title: e.target.value })} />
            </div>
            {selectedNode.type === 'dialogue' && (
              <div className="field">
                <label>说话人(来自实体库的角色)</label>
                <select
                  value={selectedNode.data.speakerId ?? ''}
                  onChange={(e) => patchSelectedNode({ speakerId: e.target.value || undefined })}
                >
                  <option value="">(无)</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>
                {selectedNode.type === 'dialogue' ? '台词'
                  : selectedNode.type === 'condition' ? '条件表达式'
                  : selectedNode.type === 'instruction' ? '指令(如 took_book = true)'
                  : selectedNode.type === 'jump' ? '跳转目标说明'
                  : '内容'}
              </label>
              <textarea rows={5} value={selectedNode.data.text} onChange={(e) => patchSelectedNode({ text: e.target.value })} />
            </div>
            <div className="field">
              <label>标题栏颜色</label>
              <div className="color-row">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    className={`color-swatch ${selectedNode.data.color === c ? 'selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => patchSelectedNode({ color: selectedNode.data.color === c ? undefined : c })}
                  />
                ))}
              </div>
            </div>
          </>
        ) : selectedEdge ? (
          <>
            <h3>连线属性</h3>
            <div className="field">
              <label>连线标签(如选项文本、转场说明)</label>
              <input
                value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''}
                onChange={(e) => patchSelectedEdgeLabel(e.target.value)}
                placeholder="例如:选择相信他"
              />
            </div>
          </>
        ) : (
          <div className="empty-hint">
            选中一个节点或连线<br />即可在此编辑属性<br /><br />
            工具栏可添加六类节点:<br />对白 · 剧情片段 · 汇聚点<br />条件分支 · 指令 · 跳转
          </div>
        )}
      </aside>
    </>
  );
}

export default function FlowEditor() {
  const flows = useLoom((s) => s.project.flows);
  const update = useLoom((s) => s.update);
  const [activeId, setActiveId] = useState<string | null>(flows[0]?.id ?? null);

  const active = flows.find((f) => f.id === activeId) ?? flows[0] ?? null;

  const addFlow = () => {
    const id = uid();
    update((p) => { p.flows.push({ id, name: `新流程 ${p.flows.length + 1}`, nodes: [], edges: [] }); });
    setActiveId(id);
  };
  const renameFlow = (id: string, current: string) => {
    const name = prompt('流程名称', current);
    if (name) update((p) => { const f = p.flows.find((x) => x.id === id); if (f) f.name = name; });
  };
  const removeFlow = (id: string) => {
    if (!confirm('删除该流程及其全部节点?')) return;
    update((p) => { p.flows = p.flows.filter((x) => x.id !== id); });
    if (activeId === id) setActiveId(null);
  };

  return (
    <>
      <div className="side-list">
        <div className="side-head">
          <span>流程</span>
          <button className="ghost icon-btn" onClick={addFlow} title="新建流程">＋</button>
        </div>
        <div className="items">
          {flows.map((f) => (
            <div
              key={f.id}
              className={`side-item ${active?.id === f.id ? 'active' : ''}`}
              onClick={() => setActiveId(f.id)}
              onDoubleClick={() => renameFlow(f.id, f.name)}
              title="双击重命名"
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <button
                className="ghost icon-btn"
                onClick={(e) => { e.stopPropagation(); removeFlow(f.id); }}
                title="删除"
              >×</button>
            </div>
          ))}
        </div>
      </div>

      {active ? (
        <ReactFlowProvider key={active.id}>
          <Canvas flow={active} />
        </ReactFlowProvider>
      ) : (
        <div className="pane-col">
          <div className="empty-hint" style={{ marginTop: 80 }}>
            还没有流程<br />点击左上角「＋」新建一个
          </div>
        </div>
      )}
    </>
  );
}
