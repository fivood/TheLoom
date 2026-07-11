import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow, MarkerType,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import { uid, useLoom } from '../../store';
import { countSubNodes, resolveSub } from '../../util';
import type { Flow, FlowNodeData, FlowNodeType, SubFlow } from '../../types';
import { FLOW_NODE_LABEL, PALETTE } from '../../types';
import { nodeTypes, TYPE_COLORS } from './nodes';
import Player from './Player';

type LoomNode = Node<FlowNodeData>;

const EDGE_STYLE = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
} as const;

interface Crumb {
  label: string;
  path: string[];
}

function Canvas({ flow, path, navigate, crumbs }: {
  flow: Flow;
  path: string[];
  navigate: (path: string[]) => void;
  crumbs: Crumb[];
}) {
  const updateFlow = useLoom((s) => s.updateFlow);
  const entities = useLoom((s) => s.project.entities);
  const [playing, setPlaying] = useState(false);
  const sub = resolveSub(flow, path) ?? { nodes: [], edges: [] };
  const [nodes, setNodes] = useState<LoomNode[]>(() =>
    sub.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
  );
  const [edges, setEdges] = useState<Edge[]>(() => sub.edges.map((e) => ({ ...e, ...EDGE_STYLE })));
  const { screenToFlowPosition } = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);

  // 本地画布状态防抖回写 store;卸载(切流程 / 进出子流程)时立即冲刷
  const dirty = useRef(false);
  const latest = useRef({ nodes, edges });
  latest.current = { nodes, edges };
  // 撤销/重做会整体替换项目并重挂画布,此时本地状态已过期,禁止回写
  const mountRevision = useRef(useLoom.getState().revision);

  const writeBack = useCallback(() => {
    if (!dirty.current) return;
    if (useLoom.getState().revision !== mountRevision.current) { dirty.current = false; return; }
    dirty.current = false;
    const { nodes, edges } = latest.current;
    updateFlow(flow.id, (f) => {
      const target = resolveSub(f, path, true);
      if (!target) return;
      target.nodes = nodes.map((n) => ({
        id: n.id,
        type: (n.type ?? 'fragment') as FlowNodeType,
        position: { x: n.position.x, y: n.position.y },
        data: n.data,
      }));
      target.edges = edges.map((e) => ({
        id: e.id, source: e.source, target: e.target,
        sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
        label: typeof e.label === 'string' ? e.label : undefined,
      }));
    });
  }, [flow.id, path.join('/')]);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(writeBack, 350);
    return () => clearTimeout(t);
  }, [nodes, edges, writeBack]);

  useEffect(() => () => writeBack(), [writeBack]);

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

  const enterSub = (nodeId: string) => {
    writeBack();
    navigate([...path, nodeId]);
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
          <button
            className="primary"
            title="从选中节点(或本层起点)开始播放流程"
            onClick={() => { writeBack(); setPlaying(true); }}
          >▶ 演出</button>
          <span className="hint">双击剧情片段进入子流程 · Delete 删除选中</span>
        </div>
        {crumbs.length > 1 && (
          <div className="breadcrumbs">
            {crumbs.map((c, i) => (
              <span key={i} className="crumb-wrap">
                {i > 0 && <span className="crumb-sep">▸</span>}
                {i === crumbs.length - 1 ? (
                  <span className="crumb current">{c.label}</span>
                ) : (
                  <button className="ghost crumb" onClick={() => { writeBack(); navigate(c.path); }}>{c.label}</button>
                )}
              </span>
            ))}
            <span className="hint">正在编辑子流程,面包屑可返回上层</span>
          </div>
        )}
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
            onNodeDoubleClick={(_, node) => { if (node.type === 'fragment') enterSub(node.id); }}
            onBeforeDelete={async ({ nodes: delNodes }) => {
              const withSub = delNodes.filter((n) => countSubNodes((n.data as FlowNodeData).sub) > 0);
              if (withSub.length === 0) return true;
              const total = withSub.reduce((s, n) => s + countSubNodes((n.data as FlowNodeData).sub), 0);
              return confirm(`要删除的剧情片段里还有 ${total} 个子节点,将一并删除。继续?`);
            }}
            zoomOnDoubleClick={false}
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

      {playing && (
        <Player
          flow={useLoom.getState().project.flows.find((f) => f.id === flow.id) ?? flow}
          path={path}
          startNodeId={selectedNode?.id}
          onClose={() => setPlaying(false)}
        />
      )}

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
            {selectedNode.type === 'fragment' && (
              <button className="primary" onClick={() => enterSub(selectedNode.id)}>
                ▦ 进入子流程{countSubNodes(selectedNode.data.sub) > 0 ? `(${countSubNodes(selectedNode.data.sub)} 个节点)` : ''}
              </button>
            )}
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
            剧情片段可以双击进入,<br />在内部继续搭建子流程,<br />层层嵌套、没有深度限制
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
  const [path, setPath] = useState<string[]>([]);

  const active = flows.find((f) => f.id === activeId) ?? flows[0] ?? null;

  // 路径失效(节点被删 / 数据重载)时裁剪到最近的有效层级
  const validPath = useMemo(() => {
    if (!active) return [];
    const ok: string[] = [];
    let cur: SubFlow = active;
    for (const id of path) {
      const n = cur.nodes.find((x) => x.id === id);
      if (!n || n.type !== 'fragment') break;
      ok.push(id);
      cur = n.data.sub ?? { nodes: [], edges: [] };
    }
    return ok;
  }, [active, path]);

  useEffect(() => {
    if (validPath.length !== path.length) setPath(validPath);
  }, [validPath, path]);

  const crumbs = useMemo<Crumb[]>(() => {
    if (!active) return [];
    const out: Crumb[] = [{ label: active.name, path: [] }];
    let cur: SubFlow = active;
    const acc: string[] = [];
    for (const id of validPath) {
      const n = cur.nodes.find((x) => x.id === id);
      if (!n) break;
      acc.push(id);
      out.push({ label: n.data.title || '剧情片段', path: [...acc] });
      cur = n.data.sub ?? { nodes: [], edges: [] };
    }
    return out;
  }, [active, validPath]);

  const selectFlow = (id: string) => {
    setActiveId(id);
    setPath([]);
  };

  const addFlow = () => {
    const id = uid();
    update((p) => { p.flows.push({ id, name: `新流程 ${p.flows.length + 1}`, nodes: [], edges: [] }); });
    selectFlow(id);
  };
  const renameFlow = (id: string, current: string) => {
    const name = prompt('流程名称', current);
    if (name) update((p) => { const f = p.flows.find((x) => x.id === id); if (f) f.name = name; });
  };
  const removeFlow = (id: string) => {
    if (!confirm('删除该流程及其全部节点?')) return;
    update((p) => { p.flows = p.flows.filter((x) => x.id !== id); });
    if (activeId === id) { setActiveId(null); setPath([]); }
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
              onClick={() => selectFlow(f.id)}
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
        <ReactFlowProvider key={`${active.id}/${validPath.join('/')}`}>
          <Canvas flow={active} path={validPath} navigate={setPath} crumbs={crumbs} />
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
