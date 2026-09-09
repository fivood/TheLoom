import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow, MarkerType,
  ConnectionMode, Handle, Position,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type NodeProps,
} from '@xyflow/react';
import { uid, useLoom } from '../../store';
import { activePaletteColors } from '../../util';
import { PALETTE } from '../../types';
import type { BrainNoteUse } from '../../types';
import { mindmapLayout, nextNotePosition } from '../../brainstormLayout';
import { floatingEdgeTypes } from '../../components/FloatingEdge';
import { sanitizeCurve } from '../../edgeCurve';
import { promptText } from '../../dialog';
import { getThemeMode, readableInk, subscribeThemeMode } from '../../theme';
import { useNav } from '../../search';
import { loadInbox, markUsed, saveInbox, visibleIdeas } from '../../inbox';
import Q from '../../components/Q';

interface StickyData {
  text: string;
  color: string;
  usedIn?: BrainNoteUse[];
  [key: string]: unknown;
}
type StickyNode = Node<StickyData>;

const NOTE_COLORS = ['#ffffff', '#f2f1ee', '#e6e4df', '#d8d6d0', '#c9c7c1', '#bab8b1'];

/**
 * 四面都能连。原来只有左 target / 右 source,连线被迫按左→右走,
 * 摆卡片就得先想好顺序 —— 而头脑风暴恰恰是顺序还没有的时候做的事。
 * 配合 ConnectionMode.Loose,任一把手既可拉出也可接入 —— 该模式下 React Flow
 * 找目标锚点时会把 source 把手也算进去,所以四个 source 把手就够,不必再叠一套 target。
 */
const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

const USE_LABEL: Record<BrainNoteUse['kind'], string> = {
  document: '转为场景', outlineRow: '转为大纲行', research: '转为资料卡', entity: '转为实体', manual: '手动标记',
};

/**
 * 新建便签后要聚焦的那一张。
 *
 * 风暴板是「还没想法,先把它记下来」这一步的主场 —— 建出来不聚焦的话,
 * 一个念头要点按钮、把鼠标移过去、点进去、再打字,四个动作。
 * 正文(setFocusBlockId)与设定集(setPendingNameFocus)早就是即刻可打字的。
 * 放模块级是因为要跨 Canvas 与 Sticky 两个组件传一次性信号,和下面的剪贴板同惯例。
 */
let pendingNoteFocus: string | null = null;

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
  useEffect(() => {
    if (pendingNoteFocus !== id) return;
    pendingNoteFocus = null;
    ref.current?.focus();
  }, [id]);

  const used = data.usedIn ?? [];
  const toggleManual = () => {
    // 已经转出去过的不给取消 —— 它确实用过了;手动标记可以反悔
    const manual = used.some((u) => u.kind === 'manual');
    updateNodeData(id, {
      usedIn: manual
        ? used.filter((u) => u.kind !== 'manual')
        : [...used, { kind: 'manual' as const, at: Date.now() }],
    });
  };

  return (
    <div className={`sticky-note ${selected ? 'selected' : ''} ${used.length ? 'used' : ''}`} style={{ background: data.color, color: readableInk(data.color) }}>
      {SIDES.map((p) => <Handle key={p} id={p} type="source" position={p} />)}
      <textarea
        ref={ref}
        className="nodrag nowheel"
        value={data.text}
        rows={1}
        placeholder="写下想法…"
        onChange={(e) => { updateNodeData(id, { text: e.target.value }); autoSize(); }}
      />
      <button
        className={`sticky-used-mark nodrag ${used.length ? 'on' : ''}`}
        title={used.length ? `已用过:${used.map((u) => USE_LABEL[u.kind]).join('、')}(点击取消手动标记)` : '标记为「已用到」'}
        onClick={toggleManual}
      >✓</button>
    </div>
  );
}

const stickyTypes = { sticky: Sticky };

let stickyClipboard: { nodes: StickyNode[]; edges: Edge[] } | null = null;


function Canvas() {
  const notes = useLoom((s) => s.project.brainstormNotes);
  const storedEdges = useLoom((s) => s.project.brainstormEdges);
  const setBrainstorm = useLoom((s) => s.setBrainstorm);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const paneRef = useRef<HTMLDivElement>(null);

  /**
   * 当前视口左上角的画布坐标,新便签从这里开始找空位 —— 落在看得见的地方。
   * 拿不到容器(理论上不会)就回落到画布原点。
   */
  const viewOrigin = () => {
    const r = paneRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return undefined;
    return screenToFlowPosition({ x: r.left + 40, y: r.top + 40 });
  };
  const themeMode = useSyncExternalStore(subscribeThemeMode, getThemeMode);

  const [nodes, setNodes] = useState<StickyNode[]>(() =>
    notes.map((n) => ({ id: n.id, type: 'sticky', position: n.position, data: { text: n.text, color: n.color, usedIn: n.usedIn } })),
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    storedEdges.map((e) => ({
      id: e.id, source: e.source, target: e.target, label: e.label,
      type: 'floating', markerEnd: { type: MarkerType.ArrowClosed },
      data: { curve: e.curve, bendable: true },
    })),
  );

  const latest = useRef({ nodes, edges });
  useEffect(() => { latest.current = { nodes, edges }; }, [nodes, edges]);

  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      setBrainstorm(
        nodes.map((n) => ({
          id: n.id, text: n.data.text, color: n.data.color,
          position: { x: n.position.x, y: n.position.y },
          ...(n.data.usedIn?.length ? { usedIn: n.data.usedIn } : {}),
        })),
        edges.map((e) => ({
          id: e.id, source: e.source, target: e.target,
          label: typeof e.label === 'string' ? e.label : undefined,
          // 手柄拖动经 updateEdgeData 写进 data,再由这里落盘
          ...(sanitizeCurve((e.data as { curve?: unknown } | undefined)?.curve)
            ? { curve: sanitizeCurve((e.data as { curve?: unknown }).curve) } : {}),
        })),
      );
    }, 350);
    return () => clearTimeout(t);
  }, [nodes, edges]);

  const copySelection = () => {
    const picked = latest.current.nodes.filter((n) => n.selected);
    if (picked.length === 0) return 0;
    const ids = new Set(picked.map((n) => n.id));
    stickyClipboard = {
      nodes: structuredClone(picked),
      edges: structuredClone(latest.current.edges.filter((e) => ids.has(e.source) && ids.has(e.target))),
    };
    return picked.length;
  };

  const pasteClipboard = (offset = 30) => {
    if (!stickyClipboard || stickyClipboard.nodes.length === 0) return 0;
    const idMap = new Map<string, string>();
    for (const n of stickyClipboard.nodes) idMap.set(n.id, uid());
    const newNodes: StickyNode[] = stickyClipboard.nodes.map((n) => ({
      ...structuredClone(n),
      id: idMap.get(n.id)!,
      position: { x: n.position.x + offset, y: n.position.y + offset },
      selected: true,
    }));
    const newEdges: Edge[] = stickyClipboard.edges.map((e) => ({
      ...structuredClone(e),
      id: uid(),
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      type: 'floating',
      markerEnd: { type: MarkerType.ArrowClosed },
    }));
    dirty.current = true;
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...newNodes]);
    setEdges((es) => [...es, ...newEdges]);
    return newNodes.length;
  };

  const duplicateSelection = () => {
    const keep = stickyClipboard;
    const n = copySelection();
    if (n > 0) pasteClipboard(30);
    stickyClipboard = keep ?? stickyClipboard;
    return n;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      const key = e.key.toLowerCase();
      if (key === 'c') {
        if (copySelection() > 0) e.preventDefault();
      } else if (key === 'v') {
        if (pasteClipboard() > 0) e.preventDefault();
      } else if (key === 'd') {
        if (duplicateSelection() > 0) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 只有内容真的变了才标脏。select / dimensions 也算脏的话,点一下便签、
  // 甚至挂载时的尺寸测量都会写一次全项目 —— 撤销栈里堆满按 Ctrl+Z 毫无反应的空步。
  // 流程编辑器在 v0.54.2 修过同样的问题(C2),这里当时没跟上。
  const onNodesChange = useCallback((changes: NodeChange<StickyNode>[]) => {
    if (changes.some((c) => c.type === 'position' || c.type === 'remove' || c.type === 'add' || c.type === 'replace')) {
      dirty.current = true;
    }
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some((c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace')) dirty.current = true;
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);
  const onConnect = useCallback((conn: Connection) => {
    dirty.current = true;
    setEdges((es) => addEdge({ ...conn, id: uid(), type: 'floating', markerEnd: { type: MarkerType.ArrowClosed }, data: { bendable: true } }, es));
  }, []);

  const addNote = (position?: { x: number; y: number }) => {
    // 按张数轮转而不是随机 —— 颜色在风暴板上是拿来当分类用的(待查 / 已证实 / 诡计 / 动机),
    // 随机色等于先替用户洗一遍牌,每张新便签都得重新指定一次。资料卡与实体都是这么轮的
    const color = NOTE_COLORS[nodes.length % NOTE_COLORS.length];
    const id = uid();
    pendingNoteFocus = id;
    dirty.current = true;
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      {
        id, type: 'sticky' as const,
        position: position ?? nextNotePosition(ns, viewOrigin()),
        data: { text: '', color },
        selected: true,
      },
    ]);
  };

  /**
   * 放射整理:以选中的便签为中心把整块板摊成思维导图。没选就取连线最多的那张。
   * 只改位置,不动内容与连线。
   */
  const tidy = () => {
    const { nodes: ns, edges: es } = latest.current;
    if (ns.length === 0) return;
    const root = ns.find((n) => n.selected)?.id;
    const pos = mindmapLayout(ns.map((n) => ({ id: n.id, position: n.position })), es, root);
    dirty.current = true;
    setNodes((cur) => cur.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
    window.setTimeout(() => fitView({ duration: 300, padding: 0.15 }), 60);
  };

  /** 连线上写一句「为什么连」—— 联想的理由往往比连线本身重要 */
  const labelEdge = async (edgeId: string, current: unknown) => {
    const next = await promptText({
      message: '这条联想是什么关系?',
      defaultValue: typeof current === 'string' ? current : '',
      placeholder: '留空则去掉标注',
    });
    if (next === null) return;
    dirty.current = true;
    setEdges((es) => es.map((e) => (e.id === edgeId ? { ...e, label: next.trim() || undefined } : e)));
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
  const [dimUsed, setDimUsed] = useState(false);
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
        position: nextNotePosition(ns, viewOrigin()),
        data: { text, color: NOTE_COLORS[0] },
        selected: true,
      },
    ]);
    const next = markUsed(inbox, id, slotId, projectName || '未命名项目');
    setInbox(next);
    saveInbox(next);
  };

  const hasSelection = nodes.some((n) => n.selected);
  const selectedNotes = () => nodes.filter((n) => n.selected)
    .map((n) => ({ id: n.id, text: String(n.data.text ?? '').trim() }))
    .filter((n) => n.text);

  /**
   * 记一笔「这条灵感用掉了」。只增不减、不去重 —— 同一条灵感转成场景之后
   * 再拿去写成资料卡是常事,台账要回答的是「哪些还没用过」。
   */
  const markNotesUsed = (ids: string[], kind: BrainNoteUse['kind']) => {
    const at = Date.now();
    const set = new Set(ids);
    /*
     * 直接写 store,不能只改画布的本地状态 —— 转换完会立刻跳到目标模块,画布随之卸载,
     * 而画布落盘是 350ms 防抖的,卸载时的 clearTimeout 正好把这笔记录清掉。
     * 本地状态同步更新是为了分屏下画布不卸载时角标能立刻出现,
     * 也避免之后那次防抖落盘拿旧数据把 store 里的记录覆盖回去。
     */
    useLoom.getState().update((p) => {
      for (const note of p.brainstormNotes) {
        if (set.has(note.id)) note.usedIn = [...(note.usedIn ?? []), { kind, at }];
      }
    });
    setNodes((ns) => ns.map((n) => (set.has(n.id)
      ? { ...n, data: { ...n.data, usedIn: [...(n.data.usedIn ?? []), { kind, at }] } }
      : n)));
  };

  const unusedCount = nodes.filter((n) => !(n.data.usedIn?.length)).length;

  /**
   * 便签原本是死胡同 —— 想不到别处去,只能手工复制粘贴。
   * 从 0 开篇的顺序常是「先撒便签 → 挑几张变成场景 / 章节」,
   * 这两个动作把那一步接上;便签本身保留,不是移动。
   */
  const toScenes = () => {
    const picked = selectedNotes();
    if (picked.length === 0) return;
    const texts = picked.map((n) => n.text);
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
    markNotesUsed(picked.map((n) => n.id), 'document');
    useNav.getState().go({ tab: 'documents' });
  };

  /**
   * 转为资料卡:风暴板上写下的「待查」条目,直接落成一张待调查的考据卡。
   * 转为实体:「主角是谁?」这类卡片,直接落成一个待设计的对象。
   *
   * 这两个出口比场景 / 大纲行更靠前 —— 推理写作的顺序是先查证、先立人物,
   * 才轮到写场景。缺了它们,这两步只能靠手工复制粘贴。
   * 实体一律建成「设定」类,由用户在设定集里改成角色 / 地点 / 物品 ——
   * 便签文字看不出该是哪一类,与其弹窗问,不如先落地再改。
   */
  const toResearchCards = () => {
    const picked = selectedNotes();
    if (picked.length === 0) return;
    const texts = picked.map((n) => n.text);
    const project = useLoom.getState().project;
    const category = project.researchCategories[0] ?? '未分类';
    const cols = activePaletteColors(project);
    useLoom.getState().update((p) => {
      for (const text of texts) {
        p.researchCards.push({
          id: uid(),
          title: firstLine(text) || '新资料卡片',
          content: text,
          category,
          tags: [],
          color: cols[p.researchCards.length % cols.length] ?? PALETTE[0],
          source: '', pinned: false, createdAt: Date.now(),
        });
      }
    });
    markNotesUsed(picked.map((n) => n.id), 'research');
    useNav.getState().go({ tab: 'research' });
  };

  const toEntities = () => {
    const picked = selectedNotes();
    if (picked.length === 0) return;
    const texts = picked.map((n) => n.text);
    const cols = activePaletteColors(useLoom.getState().project);
    useLoom.getState().update((p) => {
      for (const text of texts) {
        p.entities.push({
          id: uid(),
          kind: 'concept',
          name: firstLine(text) || '新设定',
          color: cols[p.entities.length % cols.length] ?? PALETTE[0],
          // 原文进备注,简介留空 —— 便签文字是「想到的东西」,一句话简介是
          // 想清楚之后才写得出来的,不该拿同一段话把两个字段都填满
          emoji: '', summary: '',
          fields: [],
          notes: text,
          createdAt: Date.now(),
        });
      }
    });
    markNotesUsed(picked.map((n) => n.id), 'entity');
    useNav.getState().go({ tab: 'entities' });
  };

  const toOutlineRows = () => {
    const picked = selectedNotes();
    if (picked.length === 0) return;
    const texts = picked.map((n) => n.text);
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
    markNotesUsed(picked.map((n) => n.id), 'outlineRow');
    useNav.getState().go({ tab: 'outline' });
  };

  return (
    <div className="pane-col">
      <div className="toolbar">
        <button className="primary" onClick={() => addNote()}>＋ 新便签</button>
        <button title="以选中便签为中心放射摊开(没选就取连线最多的那张);只改位置" onClick={tidy}>放射整理</button>
        <button
          className={dimUsed ? 'primary' : ''}
          title="淡化已经用掉的便签,让还没用过的显出来。转成场景 / 大纲行 / 资料卡 / 实体会自动记一笔,也可以点便签上的 ✓ 手动标"
          onClick={() => setDimUsed((v) => !v)}
        >未用过 {unusedCount}</button>
        <button
          className={inboxOpen ? 'primary' : ''}
          title="跨项目灵感库:手机快记写进这里,取用后卡片仍留在库中"
          onClick={() => { setInbox(loadInbox()); setInboxOpen((v) => !v); }}
        >灵感库 {visibleIdeas(inbox).length}</button>
        {hasSelection && (
          <>
            <span className="tool-sep" aria-hidden="true" />
            <button title="把选中便签各建一张资料卡(便签保留),并跳到资料 —— 写着「待查」的卡片走这里" onClick={toResearchCards}>转为资料卡</button>
            <button title="把选中便签各建一个实体(便签保留),先落成「设定」类,到设定集里改成角色 / 地点 / 物品" onClick={toEntities}>转为实体</button>
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
        <span className="hint">双击空白处新建便签 · 从便签四边任意方向拉出连线 · 双击连线写关系 · Ctrl+C/V 复制 · Delete 删除</span>
      </div>
      {inboxOpen && (
        <div className="inbox-strip">
          {visibleIdeas(inbox).length === 0 && (
            <span className="hint">灵感库是空的。手机端<Q>快记</Q>记下的点子会出现在这里。</span>
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
      <div style={{ flex: 1 }} ref={paneRef}>
        <ReactFlow
          className={`rf-light${dimUsed ? ' dim-used' : ''}`}
          colorMode={themeMode}
          nodes={nodes}
          edges={edges}
          nodeTypes={stickyTypes}
          edgeTypes={floatingEdgeTypes}
          connectionMode={ConnectionMode.Loose}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeDoubleClick={(_, edge) => { void labelEdge(edge.id, edge.label); }}
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
