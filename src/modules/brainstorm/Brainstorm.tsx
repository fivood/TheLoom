import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow, MarkerType,
  Handle, Position,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type NodeProps,
} from '@xyflow/react';
import { uid, useLoom } from '../../store';
import { getThemeMode, readableInk, subscribeThemeMode } from '../../theme';

interface StickyData {
  text: string;
  color: string;
  [key: string]: unknown;
}
type StickyNode = Node<StickyData>;

const NOTE_COLORS = ['#ffffff', '#f2f1ee', '#e6e4df', '#d8d6d0', '#c9c7c1', '#bab8b1'];

function Sticky({ id, data, selected }: NodeProps<StickyNode>) {
  const { updateNodeData } = useReactFlow();
  const ref = useRef<HTMLTextAreaElement>(null);

  const autoSize = () => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  };
  useEffect(autoSize, [data.text]);

  return (
    <div className={`sticky-note ${selected ? 'selected' : ''}`} style={{ background: data.color, color: readableInk(data.color) }}>
      <Handle type="target" position={Position.Left} />
      <textarea
        ref={ref}
        className="nodrag nowheel"
        value={data.text}
        rows={1}
        placeholder="写下想法…"
        onChange={(e) => { updateNodeData(id, { text: e.target.value }); autoSize(); }}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const stickyTypes = { sticky: Sticky };

function Canvas() {
  const notes = useLoom((s) => s.project.brainstormNotes);
  const storedEdges = useLoom((s) => s.project.brainstormEdges);
  const setBrainstorm = useLoom((s) => s.setBrainstorm);
  const { screenToFlowPosition } = useReactFlow();
  const themeMode = useSyncExternalStore(subscribeThemeMode, getThemeMode);

  const [nodes, setNodes] = useState<StickyNode[]>(() =>
    notes.map((n) => ({ id: n.id, type: 'sticky', position: n.position, data: { text: n.text, color: n.color } })),
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    storedEdges.map((e) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed } })),
  );

  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      setBrainstorm(
        nodes.map((n) => ({ id: n.id, text: n.data.text, color: n.data.color, position: { x: n.position.x, y: n.position.y } })),
        edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: typeof e.label === 'string' ? e.label : undefined })),
      );
    }, 350);
    return () => clearTimeout(t);
  }, [nodes, edges]);

  const onNodesChange = useCallback((changes: NodeChange<StickyNode>[]) => {
    dirty.current = true;
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    dirty.current = true;
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);
  const onConnect = useCallback((conn: Connection) => {
    dirty.current = true;
    setEdges((es) => addEdge({ ...conn, id: uid(), markerEnd: { type: MarkerType.ArrowClosed } }, es));
  }, []);

  const addNote = (position?: { x: number; y: number }) => {
    const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    dirty.current = true;
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      {
        id: uid(), type: 'sticky' as const,
        position: position ?? { x: 80 + Math.random() * 120, y: 80 + Math.random() * 120 },
        data: { text: '', color },
        selected: true,
      },
    ]);
  };

  const recolorSelected = (color: string) => {
    dirty.current = true;
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, color } } : n)));
  };

  const hasSelection = nodes.some((n) => n.selected);

  return (
    <div className="pane-col">
      <div className="toolbar">
        <button className="primary" onClick={() => addNote()}>＋ 新便签</button>
        {hasSelection && (
          <div className="color-row" style={{ alignItems: 'center' }}>
            {NOTE_COLORS.map((c) => (
              <button key={c} className="color-swatch" style={{ background: c }} onClick={() => recolorSelected(c)} />
            ))}
          </div>
        )}
        <span className="hint">双击空白处新建便签 · 拖动边缘连线 · Delete 删除</span>
      </div>
      <div style={{ flex: 1 }}>
        <ReactFlow
          className="rf-light"
          colorMode={themeMode}
          nodes={nodes}
          edges={edges}
          nodeTypes={stickyTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onPaneClick={(e) => {
            if (e.detail === 2) addNote(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          }}
          zoomOnDoubleClick={false}
          deleteKeyCode={['Delete']}
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
  );
}

export default function Brainstorm() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
