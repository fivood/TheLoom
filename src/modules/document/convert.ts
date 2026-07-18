import { uid } from '../../util';
import type {
  DocBlock, Document, Flow, FlowEdge, FlowNode, FlowNodeType, NarrativeUnit,
} from '../../types';
import { ANNOTATION_TYPES, DOC_WRITING_TYPES } from '../../types';

const SPACING_X = 280;

interface HandleSpec {
  /** 引脚 id;null = 默认出边 */
  id: string | null;
  label?: string;
}

function makeNode(type: FlowNodeType, data: Partial<FlowNode['data']>, x: number, y: number): FlowNode {
  return {
    id: uid(),
    type,
    position: { x, y },
    data: { title: '', text: '', ...data },
  };
}

/**
 * 文档 → 流程:线性串联,分支节点(choice / condition)的「首个引脚」承接下一段,
 * 其余引脚留给用户补全。注释块(note)跳过不进入流程。
 *
 * 输出可直接 push 到 project.flows。
 */
export function documentToFlow(doc: Document): Flow {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let x = 80;
  let y = 80;
  /** 上一个未消化的分支引脚(若有),下一段从该引脚引出 */
  let pendingHandle: { fromNodeId: string; handleId: string | null; label?: string } | null = null;
  /** 上一个普通节点的 id(无分支时直接连) */
  let prevId: string | null = null;

  const linkTo = (targetId: string) => {
    if (pendingHandle) {
      edges.push({
        id: uid(),
        source: pendingHandle.fromNodeId,
        sourceHandle: pendingHandle.handleId,
        target: targetId,
        label: pendingHandle.label,
      });
      pendingHandle = null;
    } else if (prevId) {
      edges.push({ id: uid(), source: prevId, target: targetId });
    }
  };

  for (const b of doc.blocks) {
    if (b.flowRole === 'none') continue;
    if (DOC_WRITING_TYPES.has(b.type) && !(b.type === 'paragraph' && (b.flowRole === 'beat' || b.flowRole === 'node'))) continue;

    let node: FlowNode | null = null;
    let branchHandles: HandleSpec[] = [{ id: null }];

    switch (b.type) {
      case 'paragraph':
        node = makeNode('dialogue', { text: b.text, title: '', unitId: b.unitId }, x, y);
        break;
      case 'heading':
        node = makeNode('fragment', { title: b.text, unitId: b.unitId }, x, y);
        break;
      case 'action':
        node = makeNode('dialogue', { text: b.text, title: '', unitId: b.unitId }, x, y);
        break;
      case 'dialogue':
        node = makeNode('dialogue', { text: b.text, speakerId: b.speakerId, title: '', unitId: b.unitId }, x, y);
        break;
      case 'condition':
        node = makeNode('condition', { text: b.condition ?? '', unitId: b.unitId }, x, y);
        branchHandles = [
          { id: 'true', label: '✓ 真' },
          { id: 'false', label: '✗ 假' },
        ];
        break;
      case 'instruction':
        node = makeNode('instruction', { text: b.instruction ?? '', unitId: b.unitId }, x, y);
        break;
      case 'choice':
        // 选项列表存在共享单元上,汇聚点节点直接展示;从节点引出连线时自动绑定选项
        node = makeNode('hub', { title: b.text || '选项点', unitId: b.unitId }, x, y);
        break;
    }

    if (!node) continue;
    nodes.push(node);
    linkTo(node.id);

    prevId = node.id;
    // 分支节点:把首个引脚暂存,下一段从该引脚引出;其余引脚留给用户后续补画
    if (branchHandles.length > 1) {
      pendingHandle = {
        fromNodeId: node.id,
        handleId: branchHandles[0].id,
        label: branchHandles[0].label,
      };
    }
    x += SPACING_X;
  }

  return { id: uid(), name: doc.name || '新流程', documentId: doc.id, nodes, edges };
}

interface FlowContainer {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * 流程 → 剧本视图文档:生成的块引用与节点相同的叙事单元,
 * 之后在任一侧编辑内容都会双向同步(结构编辑互不影响)。
 *
 * 线性化:从没有入边的节点出发,沿出边深度优先、每个节点只访问一次;
 * 剧情片段先输出场景块,再展开其子流程;跳转 / 检定降级为注释块;
 * 画布注释与分区跳过。
 */
export function flowToDocument(flow: Flow, units: NarrativeUnit[]): Document {
  const unitById = new Map(units.map((u) => [u.id, u]));
  const blocks: DocBlock[] = [];

  const emitContainer = (container: FlowContainer) => {
    const narrative = container.nodes.filter((n) => !ANNOTATION_TYPES.has(n.type));
    const hasIncoming = new Set(container.edges.map((e) => e.target));
    const visited = new Set<string>();

    const emitNode = (n: FlowNode) => {
      if (visited.has(n.id)) return;
      visited.add(n.id);
      const unitId = typeof n.data.unitId === 'string' ? n.data.unitId : undefined;
      switch (n.type) {
        case 'fragment':
          blocks.push({ id: uid(), type: 'heading', text: n.data.title, unitId });
          if (n.data.sub) emitContainer(n.data.sub);
          break;
        case 'dialogue':
          if (n.data.speakerId) {
            blocks.push({ id: uid(), type: 'dialogue', text: n.data.text, speakerId: n.data.speakerId, unitId });
          } else {
            blocks.push({ id: uid(), type: 'action', text: n.data.text, unitId });
          }
          break;
        case 'hub': {
          const unit = unitId ? unitById.get(unitId) : undefined;
          blocks.push({
            id: uid(),
            type: 'choice',
            text: n.data.title,
            choices: structuredClone(unit?.choices ?? []),
            unitId,
          });
          break;
        }
        case 'condition':
          blocks.push({ id: uid(), type: 'condition', text: '', condition: n.data.text, unitId });
          break;
        case 'instruction':
          blocks.push({ id: uid(), type: 'instruction', text: '', instruction: n.data.text, unitId });
          break;
        case 'jump':
          blocks.push({ id: uid(), type: 'note', text: `→ 跳转:${n.data.title || n.data.text || ''}`.trim() });
          break;
        case 'check':
          blocks.push({
            id: uid(),
            type: 'note',
            text: `检定:${n.data.checkExpr ?? ''} vs ${n.data.checkDc ?? 10}${n.data.checkRed ? '(红)' : ''}`,
          });
          break;
      }
      for (const e of container.edges) {
        if (e.source !== n.id) continue;
        const next = narrative.find((x) => x.id === e.target);
        if (next) emitNode(next);
      }
    };

    for (const n of narrative) {
      if (!hasIncoming.has(n.id)) emitNode(n);
    }
    for (const n of narrative) emitNode(n);
  };

  emitContainer(flow);

  return {
    id: uid(),
    name: `${flow.name || '流程'} · 剧本视图`,
    linkedFlowId: flow.id,
    category: '剧本草稿',
    blocks: blocks.length ? blocks : [{ id: uid(), type: 'note', text: '(此流程没有可展示的叙事节点)' }],
    notes: `由流程「${flow.name}」生成的剧本视图;正文与流程节点共享叙事单元,双向同步。`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
