import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow, MarkerType,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import { uid, useLoom } from '../../store';
import { useNav } from '../../search';
import { confirmDialog, promptText } from '../../dialog';
import { countSubNodes, resolveSub, walkFlowNodes } from '../../util';
import { flowToDocument } from '../document/convert';
import Inspector from '../../components/Inspector';
import type { Flow, FlowNodeData, FlowNodeType, SubFlow } from '../../types';
import { FLOW_NODE_LABEL } from '../../types';
import ColorPicker from '../../components/ColorPicker';
import NavigatorTree from '../../components/NavigatorTree';
import { useLoom as useLoomStore } from '../../store';
import { nodeTypes, TYPE_COLORS } from './nodes';
import { getThemeMode, subscribeThemeMode } from '../../theme';
import Player from './Player';
import NodeTemplateModal from './NodeTemplateModal';
import { downloadMarkdown, flowToMarkdown, projectToMarkdown } from '../../export';
import Icon from '../../components/Icon';
import AttachmentEditor from '../../components/AttachmentEditor';
import TechNameField from '../../components/TechNameField';
import FieldListEditor from '../../components/FieldListEditor';
import ScriptInput from '../../components/ScriptInput';
import { RichTextInput } from '../../components/RichText';

type LoomNode = Node<FlowNodeData>;

const EDGE_STYLE = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
} as const;

interface EdgeData {
  label: string;
  condition: string;
  effect: string;
  once: boolean;
  fallback: boolean;
  /** 绑定的文档选项 id(hub 出边 ↔ 文档「选项」块) */
  choiceId?: string;
  [key: string]: unknown;
}

/** 画布上显示的边标签:文本 + 逻辑标记(◇条件 ⚡效果 ①一次性 ⤓兜底) */
function edgeDisplayLabel(d: EdgeData): string | undefined {
  const marks = `${d.condition ? ' ◇' : ''}${d.effect ? ' ⚡' : ''}${d.once ? ' ①' : ''}${d.fallback ? ' ⤓' : ''}`;
  const s = `${d.label}${marks}`.trim();
  return s || undefined;
}

interface Crumb {
  label: string;
  path: string[];
}

function Canvas({ flow, path, navigate, crumbs, focusNodeId }: {
  flow: Flow;
  path: string[];
  navigate: (path: string[]) => void;
  crumbs: Crumb[];
  focusNodeId?: string;
}) {
  const updateFlow = useLoom((s) => s.updateFlow);
  const entities = useLoom((s) => s.project.entities);
  const nodeTemplates = useLoom((s) => s.project.nodeTemplates);
  const documents = useLoom((s) => s.project.documents);
  // 被文档块共享的叙事单元 id:节点 inspector 显示双向同步提示
  const docUnitIds = useMemo(() => {
    const set = new Set<string>();
    for (const d of documents) for (const b of d.blocks) if (b.unitId) set.add(b.unitId);
    return set;
  }, [documents]);
  const [playing, setPlaying] = useState(false);
  const [editingTpl, setEditingTpl] = useState<FlowNodeType | null>(null);
  const sub = resolveSub(flow, path) ?? { nodes: [], edges: [] };
  const [nodes, setNodes] = useState<LoomNode[]>(() =>
    sub.nodes.map((n) => ({
      id: n.id, type: n.type, position: n.position, data: n.data,
      selected: n.id === focusNodeId,
      dragHandle: n.type === 'zone' ? '.zone-head' : undefined,
    })),
  );
  const [edges, setEdges] = useState<Edge[]>(() => sub.edges.map((e) => {
    const data: EdgeData = {
      label: e.label ?? '', condition: e.condition ?? '', effect: e.effect ?? '',
      once: e.once === true, fallback: e.fallback === true, choiceId: e.choiceId,
    };
    return {
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
      data, label: edgeDisplayLabel(data), ...EDGE_STYLE,
    };
  }));
  const { screenToFlowPosition } = useReactFlow();
  const themeMode = useSyncExternalStore(subscribeThemeMode, getThemeMode);
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
      target.edges = edges.map((e) => {
        const d = (e.data ?? {}) as Partial<EdgeData>;
        return {
          id: e.id, source: e.source, target: e.target,
          sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
          label: d.label || undefined,
          condition: d.condition || undefined,
          effect: d.effect || undefined,
          once: d.once || undefined,
          fallback: d.fallback || undefined,
          choiceId: d.choiceId || undefined,
        };
      });
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
    setEdges((es) => {
      const data: EdgeData = { label: '', condition: '', effect: '', once: false, fallback: false };
      // 从共享选项单元的汇聚点引出连线时,自动绑定第一个尚未连线的选项
      const source = latest.current.nodes.find((n) => n.id === conn.source);
      if (source?.type === 'hub' && typeof source.data.unitId === 'string' && !conn.sourceHandle) {
        const unit = (useLoom.getState().project.units ?? []).find((u) => u.id === source.data.unitId);
        const used = new Set(es.map((e) => (e.data as EdgeData | undefined)?.choiceId).filter(Boolean));
        const free = (unit?.choices ?? []).find((c) => !used.has(c.id));
        if (free) {
          data.choiceId = free.id;
          data.label = free.label;
        }
      }
      return addEdge({
        ...conn, id: uid(), ...EDGE_STYLE,
        data, label: edgeDisplayLabel(data),
      }, es);
    });
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
      data: type === 'zone' ? { title: '', text: '', w: 420, h: 300 } : { title: '', text: '' },
      selected: true,
      dragHandle: type === 'zone' ? '.zone-head' : undefined,
    };
    dirty.current = true;
    // 分区框插入到最底层,避免盖住其他节点
    setNodes((ns) => type === 'zone'
      ? [node, ...ns.map((n) => ({ ...n, selected: false }))]
      : [...ns.map((n) => ({ ...n, selected: false })), node]);
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
  const patchSelectedEdge = (patch: Partial<EdgeData>) => {
    if (!selectedEdge) return;
    dirty.current = true;
    setEdges((es) => es.map((e) => {
      if (e.id !== selectedEdge.id) return e;
      const data = { ...(e.data as EdgeData), ...patch };
      return { ...e, data, label: edgeDisplayLabel(data) };
    }));
  };
  const selEdgeData = (selectedEdge?.data ?? { label: '', condition: '', effect: '', once: false, fallback: false }) as EdgeData;

  const characters = useMemo(() => entities.filter((e) => e.kind === 'character'), [entities]);

  return (
    <>
      <div className="pane-col">
        <div className="toolbar">
          {(Object.keys(FLOW_NODE_LABEL) as FlowNodeType[])
            .filter((t) => t !== 'exit' || path.length > 0)
            .map((t) => (
              <button key={t} onClick={() => addNode(t)} title={t === 'exit' ? '出口会成为父层片段节点的命名引脚' : undefined}>
                <span style={{ color: TYPE_COLORS[t] }}>●</span> {FLOW_NODE_LABEL[t]}
              </button>
            ))}
          <button
            className="primary"
            title="从选中节点(或本层起点)开始播放流程"
            onClick={() => { writeBack(); setPlaying(true); }}
          ><Icon name="play" size={14} /> 演出</button>
          <button
            title="把当前流程导出为剧本式 Markdown(Shift+点击导出全部流程)"
            onClick={(e) => {
              writeBack();
              const p = useLoom.getState().project;
              if (e.shiftKey) {
                downloadMarkdown(`${p.name || '项目'}-剧本.md`, projectToMarkdown(p));
              } else {
                const f = p.flows.find((x) => x.id === flow.id) ?? flow;
                downloadMarkdown(`${f.name}-剧本.md`, flowToMarkdown(f, p.entities));
              }
            }}
          ><Icon name="script" size={14} /> 导出剧本</button>
          <button
            title="生成(或打开)与此流程共享叙事单元的剧本视图文档:文档里改内容,节点即时同步"
            onClick={() => {
              writeBack();
              const p = useLoom.getState().project;
              const f = p.flows.find((x) => x.id === flow.id) ?? flow;
              const unitIds = new Set<string>();
              walkFlowNodes(f.nodes, (n) => { if (typeof n.data.unitId === 'string') unitIds.add(n.data.unitId); });
              const existing = p.documents.find((d) => d.blocks.some((b) => b.unitId && unitIds.has(b.unitId)));
              if (existing) {
                useNav.getState().go({ tab: 'documents', docId: existing.id });
                return;
              }
              const doc = flowToDocument(f, p.units ?? []);
              useLoom.getState().update((p2) => {
                p2.documents.push(doc);
                if (doc.category && !p2.documentCategories.includes(doc.category)) p2.documentCategories.push(doc.category);
              });
              useNav.getState().go({ tab: 'documents', docId: doc.id });
            }}
          ><Icon name="doc" size={14} /> 查看为剧本</button>
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
            className="rf-light"
            colorMode={themeMode}
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
              return await confirmDialog({ message: `要删除的剧情片段里还有 ${total} 个子节点,将一并删除。继续?`, danger: true, confirmText: '删除' });
            }}
            onError={(code, msg) => console.warn('[RF]', code, msg)}
            zoomOnDoubleClick={false}
            deleteKeyCode={['Delete', 'Backspace']}
            fitView
            fitViewOptions={focusNodeId ? { nodes: [{ id: focusNodeId }], maxZoom: 1.1, padding: 2 } : undefined}
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

      {editingTpl && (
        <NodeTemplateModal initialType={editingTpl} onClose={() => setEditingTpl(null)} />
      )}

      <Inspector>
        {selectedNode ? (
          <>
            <h3>节点属性 · {FLOW_NODE_LABEL[(selectedNode.type ?? 'fragment') as FlowNodeType]}</h3>
            {typeof selectedNode.data.unitId === 'string' && docUnitIds.has(selectedNode.data.unitId) && (
              <div className="unit-linked-hint" title="该节点与文档块引用同一叙事单元">⇄ 已与文档共享内容,任一处修改会双向同步</div>
            )}
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
                    <option key={c.id} value={c.id}>{c.name}</option>
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
              {selectedNode.type === 'dialogue' || selectedNode.type === 'fragment' || selectedNode.type === 'jump' ? (
                <RichTextInput
                  value={selectedNode.data.text}
                  onChange={(v) => patchSelectedNode({ text: v })}
                  placeholder={selectedNode.type === 'dialogue' ? '台词内容(可用 **粗** *斜* ~~删~~)' : undefined}
                />
              ) : selectedNode.type === 'condition' || selectedNode.type === 'instruction' ? (
                <ScriptInput
                  mode={selectedNode.type}
                  value={selectedNode.data.text}
                  onChange={(v) => patchSelectedNode({ text: v })}
                  rows={3}
                />
              ) : (
                <textarea rows={5} value={selectedNode.data.text} onChange={(e) => patchSelectedNode({ text: e.target.value })} />
              )}
            </div>
            {selectedNode.type === 'check' && (
              <>
                <div className="field">
                  <label>技能表达式(可引用变量,如 logic + 2)</label>
                  <ScriptInput
                    mode="number"
                    value={selectedNode.data.checkExpr ?? ''}
                    onChange={(v) => patchSelectedNode({ checkExpr: v })}
                    rows={1}
                  />
                </div>
                <div className="kv-row">
                  <div className="field" style={{ flex: 1 }}>
                    <label>难度(2d6 + 技能 ≥ 此值)</label>
                    <input
                      type="number"
                      value={selectedNode.data.checkDc ?? 10}
                      onChange={(e) => patchSelectedNode({ checkDc: Number(e.target.value) })}
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>类型</label>
                    <select
                      value={selectedNode.data.checkRed ? 'red' : 'white'}
                      onChange={(e) => patchSelectedNode({ checkRed: e.target.value === 'red' })}
                    >
                      <option value="white">白检定(可重试)</option>
                      <option value="red">红检定(仅一次)</option>
                    </select>
                  </div>
                </div>
              </>
            )}
            {selectedNode.type === 'fragment' && (
              <button className="primary" onClick={() => enterSub(selectedNode.id)}>
                ▦ 进入子流程{countSubNodes(selectedNode.data.sub) > 0 ? `(${countSubNodes(selectedNode.data.sub)} 个节点)` : ''}
              </button>
            )}
            <div className="field">
              <label>标题栏颜色</label>
              <ColorPicker
                value={selectedNode.data.color}
                onChange={(c) => patchSelectedNode({ color: c })}
              />
            </div>
            <TechNameField
              value={selectedNode.data.technicalName}
              onChange={(v) => patchSelectedNode({ technicalName: v })}
              displayName={selectedNode.data.title || selectedNode.type || '节点'}
              onRenamed={(oldV, newV) => useLoomStore.getState().renameScriptSeenTarget(oldV, newV)}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <label style={{ margin: 0, flex: 1, fontSize: 12, color: 'var(--text-faint)' }}>自定义字段</label>
              <button
                className="ghost"
                style={{ fontSize: 11, padding: '2px 6px' }}
                title={`编辑「${FLOW_NODE_LABEL[(selectedNode.type ?? 'fragment') as FlowNodeType]}」类型的字段模板`}
                onClick={() => setEditingTpl((selectedNode.type ?? 'fragment') as FlowNodeType)}
              >⚙ 模板</button>
            </div>
            <FieldListEditor
              fields={selectedNode.data.fields ?? []}
              specs={nodeTemplates?.[(selectedNode.type ?? 'fragment') as FlowNodeType]}
              onChange={(fields) => patchSelectedNode({ fields })}
            />
            <AttachmentEditor ownerId={selectedNode.id} />
          </>
        ) : selectedEdge ? (
          <>
            <h3>连线属性(玩家选项)</h3>
            {selEdgeData.choiceId && (
              <div className="unit-linked-hint" title="该连线与文档「选项」块的选项双向绑定">⇄ 已绑定文档选项,标签修改会双向同步</div>
            )}
            <div className="field">
              <label>选项文本 / 标签</label>
              <input
                value={selEdgeData.label}
                onChange={(e) => patchSelectedEdge({ label: e.target.value })}
                placeholder="例如:选择相信他"
              />
            </div>
            <div className="field">
              <label>出现条件 ◇(空 = 始终出现)</label>
              <ScriptInput
                mode="condition"
                value={selEdgeData.condition}
                onChange={(v) => patchSelectedEdge({ condition: v })}
                rows={1}
                placeholder="例如:has_address == true"
              />
            </div>
            <div className="field">
              <label>选中效果 ⚡(指令,如 favor += 1)</label>
              <ScriptInput
                mode="instruction"
                value={selEdgeData.effect}
                onChange={(v) => patchSelectedEdge({ effect: v })}
                rows={1}
                placeholder="例如:took_book = true"
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selEdgeData.once}
                onChange={(e) => patchSelectedEdge({ once: e.target.checked })}
                style={{ width: 'auto' }}
              />
              一次性选项 ①(演出中选过即隐藏)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selEdgeData.fallback}
                onChange={(e) => patchSelectedEdge({ fallback: e.target.checked })}
                style={{ width: 'auto' }}
              />
              兜底分支 ⤓(其他出边都不可用时才走这条)
            </label>
          </>
        ) : (
          <div className="empty-hint">
            选中一个节点或连线<br />即可在此编辑属性<br /><br />
            剧情片段可以双击进入,<br />在内部继续搭建子流程,<br />层层嵌套、没有深度限制
          </div>
        )}
      </Inspector>
    </>
  );
}

export default function FlowEditor() {
  const flows = useLoom((s) => s.project.flows);
  const update = useLoom((s) => s.update);
  const [activeId, setActiveId] = useState<string | null>(flows[0]?.id ?? null);
  const [path, setPath] = useState<string[]>([]);
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>();

  // 消费搜索 / 反向引用的跳转目标
  const navSeq = useNav((s) => s.seq);
  useEffect(() => {
    const t = useNav.getState().target;
    if (t?.tab === 'flow' && t.flowId) {
      setActiveId(t.flowId);
      setPath(t.path ?? []);
      setFocusNodeId(t.nodeId);
      useNav.getState().clear();
    }
  }, [navSeq]);

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
  const renameFlow = async (id: string, current: string) => {
    const name = await promptText({ message: '流程名称', defaultValue: current });
    if (name) update((p) => { const f = p.flows.find((x) => x.id === id); if (f) f.name = name; });
  };
  const setFlowTechName = async (id: string, current: string | undefined) => {
    const tn = await promptText({
      message: '技术名(留空清除,只能含字母数字下划线)',
      defaultValue: current ?? '',
      placeholder: '如 act1_rain',
    });
    if (tn !== null) update((p) => { const f = p.flows.find((x) => x.id === id); if (f) f.technicalName = tn || undefined; });
  };
  const removeFlow = async (id: string) => {
    if (!await confirmDialog({ message: '删除该流程及其全部节点?', danger: true, confirmText: '删除' })) return;
    update((p) => { p.flows = p.flows.filter((x) => x.id !== id); });
    if (activeId === id) { setActiveId(null); setPath([]); }
  };

  return (
    <>
      <NavigatorTree
        module="flow"
        title="流程"
        items={flows}
        selectedId={activeId}
        getLabel={(flow) => flow.name}
        onSelect={selectFlow}
        onItemDoubleClick={(flow) => renameFlow(flow.id, flow.name)}
        onMove={(id, folderId) => update((p) => { const f = p.flows.find((x) => x.id === id); if (f) { f.folderId = folderId; delete f.order; } })}
        onMoveMany={(ids, folderId) => update((p) => {
          const set = new Set(ids);
          for (const f of p.flows) if (set.has(f.id)) { f.folderId = folderId; delete f.order; }
        })}
        onReorder={(_parentId, orderedIds) => update((p) => {
          const map = new Map(orderedIds.map((id, i) => [id, i]));
          for (const f of p.flows) if (map.has(f.id)) f.order = map.get(f.id);
        })}
        onCreate={addFlow}
        createLabel="新建流程"
        emptyLabel="还没有流程"
        renderItemMeta={(flow) => flow.technicalName ? (
          <code className="nav-tech-name" title={`技术名:${flow.technicalName}`}>{flow.technicalName}</code>
        ) : null}
        renderItemActions={(flow) => (
          <>
            <button
              className="ghost icon-btn"
              onClick={(e) => { e.stopPropagation(); setFlowTechName(flow.id, flow.technicalName); }}
              title="设置技术名"
            >#</button>
            <button
              className="ghost icon-btn"
              onClick={(e) => { e.stopPropagation(); removeFlow(flow.id); }}
              title="删除"
            >×</button>
          </>
        )}
      />

      {active ? (
        <ReactFlowProvider key={`${active.id}/${validPath.join('/')}/${focusNodeId ?? ''}`}>
          <Canvas flow={active} path={validPath} navigate={setPath} crumbs={crumbs} focusNodeId={focusNodeId} />
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
