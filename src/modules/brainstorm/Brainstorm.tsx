import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow, MarkerType,
  Handle, Position,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type NodeProps,
} from '@xyflow/react';
import { uid, useLoom } from '../../store';
import { nextNotePosition } from '../../brainstormLayout';
import { getThemeMode, readableInk, subscribeThemeMode } from '../../theme';
import { useNav } from '../../search';
import { loadInbox, markUsed, saveInbox, visibleIdeas } from '../../inbox';

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
        position: position ?? nextNotePosition(ns),
        data: { text: '', color },
        selected: true,
      },
    ]);
  };

  const recolorSelected = (color: string) => {
    dirty.current = true;
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, color } } : n)));
  };

  /** 便签首行当标题;整段仍进正文 / 主线剧情 */
  const firstLine = (t: string) => t.split('\n')[0].trim().slice(0, 24);

  /**
   * 从跨项目灵感库取用:未用过的点子落成便签,进入本项目的空间梳理。
   * 卡片留在库里只记去向 —— 同一个点子可能还要用在别的作品上。
   */
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inbox, setInbox] = useState(loadInbox);
  const projectName = useLoom((s) => s.project.name);
  const slotId = useLoom((s) => s.currentSlotId);

  const takeIdea = (id: string, text: string) => {
    dirty.current = true;
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      {
        id: uid(), type: 'sticky' as const,
        position: nextNotePosition(ns),
        data: { text, color: NOTE_COLORS[0] },
        selected: true,
      },
    ]);
    const next = markUsed(inbox, id, slotId, projectName || '未命名项目');
    setInbox(next);
    saveInbox(next);
  };

  const hasSelection = nodes.some((n) => n.selected);
  const selectedTexts = () => nodes.filter((n) => n.selected)
    .map((n) => String(n.data.text ?? '').trim()).filter(Boolean);

  /**
   * 便签原本是死胡同 —— 想不到别处去,只能手工复制粘贴。
   * 从 0 开篇的顺序常是「先撒便签 → 挑几张变成场景 / 章节」,
   * 这两个动作把那一步接上;便签本身保留,不是移动。
   */
  const toScenes = () => {
    const texts = selectedTexts();
    if (texts.length === 0) return;
    const first = useLoom.getState().project.documentCategories[0] ?? '未分类';
    useLoom.getState().update((p) => {
      for (const text of texts) {
        p.documents.push({
          id: uid(),
          name: firstLine(text) || '新场景',
          category: first,
          blocks: [{ id: uid(), type: 'paragraph', text, flowRole: 'none' }],
          notes: '', status: 'outline',
          createdAt: Date.now(), updatedAt: Date.now(),
        });
      }
    });
    useNav.getState().go({ tab: 'documents' });
  };

  const toOutlineRows = () => {
    const texts = selectedTexts();
    if (texts.length === 0) return;
    useLoom.getState().update((p) => {
      for (const text of texts) {
        p.outlineRows.push({
          id: uid(),
          no: String(p.outlineRows.length + 1),
          time: '',
          title: firstLine(text),
          main: text,
          cells: {},
        });
      }
    });
    useNav.getState().go({ tab: 'outline' });
  };

  return (
    <div className="pane-col">
      <div className="toolbar">
        <button className="primary" onClick={() => addNote()}>＋ 新便签</button>
        <button
          className={inboxOpen ? 'primary' : ''}
          title="跨项目灵感库:手机快记写进这里,取用后卡片仍留在库中"
          onClick={() => { setInbox(loadInbox()); setInboxOpen((v) => !v); }}
        >灵感库 {visibleIdeas(inbox).length}</button>
        {hasSelection && (
          <>
            <span className="tool-sep" aria-hidden="true" />
            <button title="把选中便签各建一个场景(便签保留),并跳到正文" onClick={toScenes}>转为场景</button>
            <button title="把选中便签各建一行大纲(便签保留),并跳到大纲" onClick={toOutlineRows}>转为大纲行</button>
          </>
        )}
        {hasSelection && (
          <div className="color-row" style={{ alignItems: 'center' }}>
            {NOTE_COLORS.map((c) => (
              <button key={c} className="color-swatch" style={{ background: c }} onClick={() => recolorSelected(c)} />
            ))}
          </div>
        )}
        <span className="hint">双击空白处新建便签 · 拖动边缘连线 · Delete 删除</span>
      </div>
      {inboxOpen && (
        <div className="inbox-strip">
          {visibleIdeas(inbox).length === 0 && (
            <span className="hint">灵感库是空的。手机端「快记」记下的点子会出现在这里。</span>
          )}
          {visibleIdeas(inbox).map((c) => (
            <button
              key={c.id}
              className="inbox-card"
              title={c.usedIn?.length ? `已用于 ${c.usedIn.map((u) => u.projectName).join('、')}` : '点击取用为便签'}
              onClick={() => takeIdea(c.id, c.text)}
            >
              <span>{c.text}</span>
              {c.usedIn?.length ? <em>已用 {c.usedIn.length}</em> : null}
            </button>
          ))}
        </div>
      )}
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
