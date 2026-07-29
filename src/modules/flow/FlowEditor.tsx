import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow, MarkerType,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import { uid, useLoom } from '../../store';
import { useNav } from '../../search';
import { alertDialog, confirmDialog, promptText } from '../../dialog';
import { countSubNodes, resolveSub, sanitizeTechnicalName, walkFlowNodes } from '../../util';
import { flowToDocument } from '../document/convert';
import Inspector from '../../components/Inspector';
import PathTestPanel from '../../components/PathTestPanel';
import { loadBreakpoints, toggleBreakpoint } from '../../playSaves';
import type { EventWait, ExternalEvent, Flow, FlowEntry, FlowNodeData, FlowNodeType, FlowParam, SubFlow } from '../../types';
import { ANNOTATION_TYPES, EVENT_WAIT_LABEL, FLOW_NODE_LABEL } from '../../types';
import ColorPicker from '../../components/ColorPicker';
import NavigatorTree from '../../components/NavigatorTree';
import { useLoom as useLoomStore } from '../../store';
import { nodeTypes, TYPE_COLORS } from './nodes';
import { getThemeMode, subscribeThemeMode } from '../../theme';
import { defaultNodeTemplate, specsForNode } from '../../templates';
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

/** 稳定的空数组:避免 selector 每次返回新引用触发无限重渲染 */
const NO_EVENTS: ExternalEvent[] = [];

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
  const projectForSpecs = useLoom((s) => s.project);
  /** R19-2:跨流程节点的目标下拉需要全部流程 */
  const allFlows = useLoom((s) => s.project.flows);
  /**
   * R19-3:外部事件节点的事件下拉。
   * 注意不要在 selector 里写 `?? []` —— 每次都返回新数组引用会让 zustand
   * 判定状态变化,导致无限重渲染(CLAUDE.md 记过这个坑)。
   */
  const externalEventsRaw = useLoom((s) => s.project.externalEvents);
  const externalEvents = externalEventsRaw ?? NO_EVENTS;
  const documents = useLoom((s) => s.project.documents);
  // 被文档块共享的叙事单元 id:节点 inspector 显示双向同步提示
  const docUnitIds = useMemo(() => {
    const set = new Set<string>();
    for (const d of documents) for (const b of d.blocks) if (b.unitId) set.add(b.unitId);
    return set;
  }, [documents]);
  const [playing, setPlaying] = useState(false);
  const [pathTesting, setPathTesting] = useState(false);
  const [editingEntries, setEditingEntries] = useState(false);
  const [editingTpl, setEditingTpl] = useState<FlowNodeType | null>(null);
  const slotId = useLoom((s) => s.currentSlotId);
  const [bp, setBp] = useState<Set<string>>(() => loadBreakpoints(slotId, flow.id));
  useEffect(() => { setBp(loadBreakpoints(slotId, flow.id)); }, [slotId, flow.id]);
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
    const defaultTpl = defaultNodeTemplate(useLoom.getState().project, type);
    const node: LoomNode = {
      id: uid(),
      type,
      position: { x: center.x - 95 + Math.random() * 40, y: center.y - 40 + Math.random() * 40 },
      data: type === 'zone'
        ? { title: '', text: '', w: 420, h: 300 }
        : { title: '', text: '', ...(defaultTpl ? { templateId: defaultTpl.id } : {}) },
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
              <button key={t} onClick={() => addNode(t)} title={t === 'exit' ? '出口会成为父层片段节点的命名引脚' : `点击在画布中央添加「${FLOW_NODE_LABEL[t]}」节点`}>
                <span style={{ color: TYPE_COLORS[t] }}>●</span> {FLOW_NODE_LABEL[t]}
              </button>
            ))}
          {path.length === 0 && (
            <button
              title="管理本流程的命名入口:其他流程的跳转 / 调用与宿主引擎按 key 稳定寻址"
              onClick={() => { writeBack(); setEditingEntries(true); }}
            >⌗ 入口{(flow.entries?.length ?? 0) > 0 ? `(${flow.entries!.length})` : ''}</button>
          )}
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
              const existing = p.documents.find((d) =>
                d.id === f.documentId || d.linkedFlowId === f.id || d.blocks.some((b) => b.unitId && unitIds.has(b.unitId)));
              if (existing) {
                if (existing.linkedFlowId !== f.id || f.documentId !== existing.id) {
                  useLoom.getState().update((p2) => {
                    const linkedDoc = p2.documents.find((d) => d.id === existing.id);
                    const linkedFlow = p2.flows.find((x) => x.id === f.id);
                    if (linkedDoc) linkedDoc.linkedFlowId = f.id;
                    if (linkedFlow) linkedFlow.documentId = existing.id;
                  });
                }
                useNav.getState().go({ tab: 'documents', docId: existing.id });
                return;
              }
              const doc = flowToDocument(f, p.units ?? []);
              doc.linkedFlowId = f.id;
              useLoom.getState().update((p2) => {
                p2.documents.push(doc);
                const linkedFlow = p2.flows.find((x) => x.id === f.id);
                if (linkedFlow) linkedFlow.documentId = doc.id;
                if (doc.category && !p2.documentCategories.includes(doc.category)) p2.documentCategories.push(doc.category);
              });
              useNav.getState().go({ tab: 'documents', docId: doc.id });
            }}
          ><Icon name="doc" size={14} /> 查看为剧本</button>
          <button
            title="批量遍历所有分支:节点覆盖率、不可达分支、死循环、无出口卡死;结果可复现"
            onClick={() => { writeBack(); setPathTesting(true); }}
          ><Icon name="check" size={14} /> 路径测试</button>
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

      {editingEntries && (
        <FlowEntriesModal
          flow={useLoom.getState().project.flows.find((f) => f.id === flow.id) ?? flow}
          onClose={() => setEditingEntries(false)}
        />
      )}

      {editingTpl && (
        <NodeTemplateModal initialType={editingTpl} onClose={() => setEditingTpl(null)} />
      )}

      {pathTesting && (
        <PathTestPanel
          flow={useLoom.getState().project.flows.find((f) => f.id === flow.id) ?? flow}
          onClose={() => setPathTesting(false)}
        />
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
                  : selectedNode.type === 'jump' ? '跳转说明'
                  : selectedNode.type === 'call' ? '调用说明'
                  : selectedNode.type === 'return' ? '返回说明'
                  : selectedNode.type === 'event' ? '事件说明'
                  : '内容'}
              </label>
              {selectedNode.type === 'dialogue' || selectedNode.type === 'fragment' || selectedNode.type === 'jump'
                || selectedNode.type === 'call' || selectedNode.type === 'return' || selectedNode.type === 'event' ? (
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
            {(selectedNode.type === 'jump' || selectedNode.type === 'call') && (
              <CrossFlowFields
                data={selectedNode.data}
                isCall={selectedNode.type === 'call'}
                flows={allFlows}
                onPatch={patchSelectedNode}
              />
            )}
            {selectedNode.type === 'event' && (
              <ExternalEventFields
                data={selectedNode.data}
                events={externalEvents}
                onPatch={patchSelectedNode}
              />
            )}
            {selectedNode.type === 'return' && (
              <div className="field">
                <label>返回值表达式(可选,写入调用方指定的变量)</label>
                <ScriptInput
                  mode="number"
                  value={selectedNode.data.returnExpr ?? ''}
                  onChange={(v) => patchSelectedNode({ returnExpr: v })}
                  rows={1}
                />
                <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
                  留空 = 只返回不带值。调用栈为空时,返回节点即演出结束。
                </div>
              </div>
            )}
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
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={bp.has(selectedNode.id)}
                  onChange={() => setBp(new Set(toggleBreakpoint(slotId, flow.id, selectedNode.id)))}
                />
                ⛔ 断点(演出自动前进在此暂停;只存本机)
              </label>
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
              specs={specsForNode(projectForSpecs, selectedNode.data)}
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
  useEffect(() => {
    if (!active) return;
    const target = path.length > 0
      ? { tab: 'flow' as const, flowId: active.id, path }
      : { tab: 'flow' as const, flowId: active.id };
    useNav.getState().visit(target, `流程 · ${active.name}`);
  }, [active?.id, active?.name, path.join('/')]);

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
    update((p) => {
      p.flows = p.flows.filter((x) => x.id !== id);
      for (const d of p.documents) if (d.linkedFlowId === id) d.linkedFlowId = undefined;
    });
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

/**
 * R19-2 跨流程节点(jump / call)的目标与实参编辑。
 * 目标按技术名保存(没有技术名才退回 id),这样重命名流程不会断链。
 */
function CrossFlowFields({ data, isCall, flows, onPatch }: {
  data: FlowNodeData;
  isCall: boolean;
  flows: Flow[];
  onPatch: (patch: Partial<FlowNodeData>) => void;
}) {
  const targetRef = (data.targetFlow ?? '').trim();
  const target = flows.find((f) => f.id === targetRef || f.technicalName === targetRef);
  const entries = target?.entries ?? [];
  const entryKey = (data.targetEntry ?? '').trim();
  const entry = entries.find((e) => e.key === entryKey);
  const params = entry?.params ?? [];
  const args = data.args ?? [];

  const setArg = (name: string, expr: string) => {
    const next = args.filter((a) => a.name !== name);
    if (expr.trim()) next.push({ name, expr });
    onPatch({ args: next.length > 0 ? next : undefined });
  };

  return (
    <>
      <div className="field">
        <label>目标流程</label>
        <select
          value={targetRef}
          onChange={(e) => {
            const v = e.target.value;
            const f = flows.find((x) => x.id === v);
            // 优先存技术名:重命名流程不断链
            onPatch({ targetFlow: f ? (f.technicalName || f.id) : undefined, targetEntry: undefined, args: undefined });
          }}
        >
          <option value="">(不跨流程 · 仅作说明节点)</option>
          {flows.map((f) => (
            <option key={f.id} value={f.id}>{f.name}{f.technicalName ? ` · ${f.technicalName}` : ''}</option>
          ))}
        </select>
        {targetRef && !target && (
          <div className="hint" style={{ fontSize: 11, marginTop: 4, color: 'var(--danger)' }}>
            找不到目标流程「{targetRef}」,演出时会降级为说明节点
          </div>
        )}
      </div>
      {target && (
        <div className="field">
          <label>目标入口</label>
          <select
            value={entryKey}
            onChange={(e) => onPatch({ targetEntry: e.target.value || undefined, args: undefined })}
          >
            <option value="">(默认起点)</option>
            {entries.map((en) => (
              <option key={en.key} value={en.key}>{en.label ? `${en.label} · ${en.key}` : en.key}</option>
            ))}
          </select>
          {entries.length === 0 && (
            <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
              「{target.name}」还没有命名入口。可在该流程的工具栏「入口」里添加。
            </div>
          )}
          {entryKey && !entry && (
            <div className="hint" style={{ fontSize: 11, marginTop: 4, color: 'var(--danger)' }}>
              入口「{entryKey}」已不存在,演出时会降级为说明节点
            </div>
          )}
        </div>
      )}
      {params.length > 0 && (
        <div className="field">
          <label>实参(按入口声明的参数)</label>
          {params.map((p) => (
            <div key={p.name} className="kv-row" style={{ alignItems: 'center', gap: 6 }}>
              <span style={{ minWidth: 90, fontSize: 12 }}>{p.name}<span style={{ color: 'var(--text-faint)' }}> · {p.type}</span></span>
              <input
                style={{ flex: 1 }}
                value={args.find((a) => a.name === p.name)?.expr ?? ''}
                placeholder={p.type === 'string' ? '直接写文本' : '表达式,如 courage + 1'}
                onChange={(e) => setArg(p.name, e.target.value)}
              />
            </div>
          ))}
          <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
            文本参数按字面量取值;布尔与数值走表达式求值。留空则用入口声明的默认值。
          </div>
        </div>
      )}
      {isCall && (
        <div className="field">
          <label>接收返回值的变量(可选)</label>
          <input
            value={data.returnVar ?? ''}
            placeholder="留空 = 不接收返回值"
            onChange={(e) => onPatch({ returnVar: e.target.value.trim() || undefined })}
          />
        </div>
      )}
      <div className="hint" style={{ fontSize: 11 }}>
        {isCall
          ? '调用会记住返回点:被调流程结束(走到无出边处或返回节点)后回到本节点继续走出边。'
          : '跳转不返回:控制权交给目标流程,本节点之后的出边不会再走到。'}
      </div>
    </>
  );
}

/**
 * R19-2 流程命名入口管理。
 * 入口 = 稳定 key + 顶层节点 + 可选参数声明,供其他流程的 jump / call
 * 与宿主引擎寻址;key 不随节点改名或重排变化。
 */
function FlowEntriesModal({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const updateFlow = useLoom((s) => s.updateFlow);
  const entries = flow.entries ?? [];
  // 只有顶层叙事节点能作入口(子流程内部节点不能被外部直接进入)
  const candidates = flow.nodes.filter((n) => !ANNOTATION_TYPES.has(n.type));

  const patch = (fn: (list: FlowEntry[]) => FlowEntry[]) => {
    updateFlow(flow.id, (f) => {
      const next = fn([...(f.entries ?? [])]);
      if (next.length > 0) f.entries = next;
      else delete f.entries;
    });
  };

  const add = async () => {
    if (candidates.length === 0) {
      await alertDialog('本流程还没有可作入口的节点,请先在画布上添加节点。');
      return;
    }
    const key = await promptText({
      message: '入口 key(技术名格式,流程内唯一)',
      placeholder: '如 after_rain / boss_fight',
      confirmText: '添加',
    });
    if (key === null) return;
    const clean = sanitizeTechnicalName(key);
    if (!clean) { await alertDialog('key 不能为空,且只能用字母、数字与下划线。'); return; }
    if (entries.some((e) => e.key === clean)) { await alertDialog(`入口「${clean}」已存在。`); return; }
    patch((list) => [...list, { key: clean, nodeId: candidates[0].id }]);
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
        <div className="sync-head">
          <span>⌗ 命名入口 · {flow.name}</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="sync-body">
          <div className="hint" style={{ fontSize: 12 }}>
            入口让别的流程用稳定 key 跳转 / 调用进来,也让宿主引擎能直接从中途启动。
            改节点标题或调整画布顺序都不会影响 key。
          </div>
          {entries.length === 0 && (
            <div className="empty-hint" style={{ padding: '16px 0' }}>
              还没有命名入口。没有入口时,外部只能从「默认起点」(唯一无入边节点)进入。
            </div>
          )}
          {entries.map((entry) => (
            <div key={entry.key} className="field" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div className="kv-row" style={{ alignItems: 'center', gap: 6 }}>
                <b style={{ minWidth: 110 }}>{entry.key}</b>
                <input
                  style={{ flex: 1 }}
                  value={entry.label ?? ''}
                  placeholder="显示名(可选)"
                  onChange={(e) => patch((list) => list.map((x) =>
                    x.key === entry.key ? { ...x, label: e.target.value.trim() || undefined } : x))}
                />
                <select
                  style={{ flex: 1 }}
                  value={entry.nodeId}
                  onChange={(e) => patch((list) => list.map((x) =>
                    x.key === entry.key ? { ...x, nodeId: e.target.value } : x))}
                >
                  {candidates.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.data.title || FLOW_NODE_LABEL[n.type]}({FLOW_NODE_LABEL[n.type]})
                    </option>
                  ))}
                </select>
                <button
                  className="ghost icon-btn"
                  aria-label={`删除入口 ${entry.key}`}
                  onClick={() => patch((list) => list.filter((x) => x.key !== entry.key))}
                >×</button>
              </div>
              <div style={{ marginTop: 6, paddingLeft: 110 }}>
                {(entry.params ?? []).map((p, i) => (
                  <div key={i} className="kv-row" style={{ alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <input
                      style={{ flex: 1 }}
                      value={p.name}
                      placeholder="参数名"
                      onChange={(e) => patch((list) => list.map((x) => x.key === entry.key
                        ? { ...x, params: (x.params ?? []).map((q, j) => j === i ? { ...q, name: e.target.value } : q) }
                        : x))}
                    />
                    <select
                      value={p.type}
                      onChange={(e) => patch((list) => list.map((x) => x.key === entry.key
                        ? { ...x, params: (x.params ?? []).map((q, j) => j === i ? { ...q, type: e.target.value as FlowParam['type'] } : q) }
                        : x))}
                    >
                      <option value="string">文本</option>
                      <option value="number">数值</option>
                      <option value="boolean">布尔</option>
                    </select>
                    <input
                      style={{ flex: 1 }}
                      value={p.default ?? ''}
                      placeholder="默认值(可选)"
                      onChange={(e) => patch((list) => list.map((x) => x.key === entry.key
                        ? { ...x, params: (x.params ?? []).map((q, j) => j === i ? { ...q, default: e.target.value || undefined } : q) }
                        : x))}
                    />
                    <button
                      className="ghost icon-btn"
                      aria-label="删除参数"
                      onClick={() => patch((list) => list.map((x) => x.key === entry.key
                        ? { ...x, params: (x.params ?? []).filter((_, j) => j !== i) }
                        : x))}
                    >×</button>
                  </div>
                ))}
                <button
                  className="ghost"
                  style={{ fontSize: 11 }}
                  onClick={() => patch((list) => list.map((x) => x.key === entry.key
                    ? { ...x, params: [...(x.params ?? []), { name: '', type: 'string' as const }] }
                    : x))}
                >＋ 参数</button>
              </div>
            </div>
          ))}
          <div className="sync-actions">
            <button onClick={add}>＋ 新增入口</button>
            <button className="primary" onClick={onClose}>完成</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * R19-3 外部事件节点的编辑面板。
 * 事件本身在「变量 → 外部事件」里声明,这里只做引用 + 传参 + 等待模式。
 */
function ExternalEventFields({ data, events, onPatch }: {
  data: FlowNodeData;
  events: ExternalEvent[];
  onPatch: (patch: Partial<FlowNodeData>) => void;
}) {
  const name = (data.eventName ?? '').trim();
  const ev = events.find((e) => e.name === name);
  const params = ev?.params ?? [];
  const args = data.eventArgs ?? [];
  const wait: EventWait = data.eventWait ?? 'continue';

  const setArg = (argName: string, expr: string) => {
    const next = args.filter((a) => a.name !== argName);
    if (expr.trim()) next.push({ name: argName, expr });
    onPatch({ eventArgs: next.length > 0 ? next : undefined });
  };

  return (
    <>
      <div className="field">
        <label>事件</label>
        <select
          value={name}
          onChange={(e) => onPatch({ eventName: e.target.value || undefined, eventArgs: undefined })}
        >
          <option value="">(未选择)</option>
          {events.map((e) => (
            <option key={e.id} value={e.name}>{e.label ? `${e.label} · ${e.name}` : e.name}</option>
          ))}
        </select>
        {events.length === 0 && (
          <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
            还没有声明外部事件。请到「变量」模块的「⚡ 外部事件」里先加一个。
          </div>
        )}
        {name && !ev && (
          <div className="hint" style={{ fontSize: 11, marginTop: 4, color: 'var(--danger)' }}>
            事件「{name}」已不存在,演出时会跳过并给出提示
          </div>
        )}
        {ev?.description && (
          <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>{ev.description}</div>
        )}
      </div>
      {params.length > 0 && (
        <div className="field">
          <label>实参(按事件声明的参数)</label>
          {params.map((prm) => (
            <div key={prm.name} className="kv-row" style={{ alignItems: 'center', gap: 6 }}>
              <span style={{ minWidth: 90, fontSize: 12 }}>
                {prm.name}<span style={{ color: 'var(--text-faint)' }}> · {prm.type}</span>
              </span>
              <input
                style={{ flex: 1 }}
                value={args.find((a) => a.name === prm.name)?.expr ?? ''}
                placeholder={prm.type === 'string' ? '直接写文本' : '表达式,如 courage + 1'}
                onChange={(e) => setArg(prm.name, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
      <div className="field">
        <label>等待模式</label>
        <select value={wait} onChange={(e) => onPatch({ eventWait: e.target.value as EventWait })}>
          {(Object.keys(EVENT_WAIT_LABEL) as EventWait[]).map((w) => (
            <option key={w} value={w}>{EVENT_WAIT_LABEL[w]}</option>
          ))}
        </select>
        <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
          {wait === 'continue' && '发出事件后立刻沿出边继续,不等引擎。'}
          {wait === 'ack' && '演出会停下,直到宿主引擎报告事件完成(如动画播完)。'}
          {wait === 'value' && '演出会停下,直到宿主引擎回一个值(如谜题结果)。'}
        </div>
      </div>
      {wait === 'value' && (
        <>
          <div className="field">
            <label>接收返回值的变量</label>
            <input
              value={data.eventResultVar ?? ''}
              placeholder="留空 = 丢弃返回值"
              onChange={(e) => onPatch({ eventResultVar: e.target.value.trim() || undefined })}
            />
          </div>
          <div className="field">
            <label>模拟返回值(仅本机试跑)</label>
            <input
              value={data.eventSimValue ?? ''}
              placeholder={ev?.returnType === 'boolean' ? 'true / false' : '演出时预填这个值'}
              onChange={(e) => onPatch({ eventSimValue: e.target.value || undefined })}
            />
            <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
              只影响编辑器里的演出,不会写进引擎包 —— 实际运行时由宿主提供。
            </div>
          </div>
        </>
      )}
    </>
  );
}
