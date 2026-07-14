import { uid } from '../../store';
import type { DocBlock, Document, Flow, FlowEdge, FlowNode, FlowNodeType } from '../../types';

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
    if (b.type === 'note') continue;

    let node: FlowNode | null = null;
    let branchHandles: HandleSpec[] = [{ id: null }];

    switch (b.type) {
      case 'heading':
        node = makeNode('fragment', { title: b.text }, x, y);
        break;
      case 'action':
        node = makeNode('dialogue', { text: b.text, title: '' }, x, y);
        break;
      case 'dialogue':
        node = makeNode('dialogue', { text: b.text, speakerId: b.speakerId, title: '' }, x, y);
        break;
      case 'condition':
        node = makeNode('condition', { text: b.condition ?? '' }, x, y);
        branchHandles = [
          { id: 'true', label: '✓ 真' },
          { id: 'false', label: '✗ 假' },
        ];
        break;
      case 'instruction':
        node = makeNode('instruction', { text: b.instruction ?? '' }, x, y);
        break;
      case 'choice': {
        node = makeNode('hub', { title: b.text || '选项点' }, x, y);
        // 选项点暂用默认出边串联;选项列表作为备注挂到 data 上,后续可生成命名引脚
        // 这里不强行制造多个 handle,留给用户在流程编辑器里继续画分支
        const labels = (b.choices ?? []).map((c) => c.label).filter(Boolean);
        if (labels.length) node.data.text = labels.map((l) => `• ${l}`).join('\n');
        break;
      }
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

  return { id: uid(), name: doc.name || '新流程', nodes, edges };
}
