import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { FlowNodeData, FlowNodeType } from '../../types';
import { FLOW_NODE_LABEL } from '../../types';
import { useLoom } from '../../store';
import { countSubNodes } from '../../util';

export const TYPE_COLORS: Record<FlowNodeType, string> = {
  dialogue: '#5b8dee',
  fragment: '#3dbfb0',
  hub: '#6b7488',
  condition: '#e8a23d',
  instruction: '#9d6ae8',
  jump: '#e85d9b',
};

type LoomNode = Node<FlowNodeData>;

function headStyle(type: FlowNodeType, custom?: string) {
  return { background: custom || TYPE_COLORS[type] };
}

function BaseNode({ id, type, data, selected, children }: NodeProps<LoomNode> & { children?: React.ReactNode }) {
  const t = type as FlowNodeType;
  return (
    <div className={`flow-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-head" style={headStyle(t, data.color)}>
        <span>{data.title || FLOW_NODE_LABEL[t]}</span>
        <span className="node-type">{FLOW_NODE_LABEL[t]}</span>
      </div>
      {children}
      {t !== 'condition' && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

export function DialogueNode(props: NodeProps<LoomNode>) {
  const entities = useLoom((s) => s.project.entities);
  const speaker = entities.find((e) => e.id === props.data.speakerId);
  return (
    <BaseNode {...props}>
      <div className="node-body">
        {speaker && (
          <div className="node-speaker" style={{ color: speaker.color }}>
            {speaker.emoji} {speaker.name}
          </div>
        )}
        {props.data.text || <span style={{ opacity: 0.5 }}>(空对白)</span>}
      </div>
    </BaseNode>
  );
}

export function FragmentNode(props: NodeProps<LoomNode>) {
  const count = countSubNodes(props.data.sub);
  return (
    <BaseNode {...props}>
      {(props.data.text || count > 0) && (
        <div className="node-body">
          {props.data.text}
          {count > 0 && (
            <div className="sub-badge" title="双击进入子流程">▦ 子流程 · {count} 个节点</div>
          )}
        </div>
      )}
    </BaseNode>
  );
}

export function ConditionNode(props: NodeProps<LoomNode>) {
  return (
    <BaseNode {...props}>
      {props.data.text && <div className="node-body" style={{ fontFamily: 'Consolas, monospace' }}>{props.data.text}</div>}
      <div className="cond-handles">
        <span>✓ 真</span>
        <span>✗ 假</span>
      </div>
      <Handle id="true" type="source" position={Position.Right} style={{ top: 'auto', bottom: 26 }} />
      <Handle id="false" type="source" position={Position.Right} style={{ top: 'auto', bottom: 8 }} />
    </BaseNode>
  );
}

export function InstructionNode(props: NodeProps<LoomNode>) {
  return (
    <BaseNode {...props}>
      {props.data.text && <div className="node-body" style={{ fontFamily: 'Consolas, monospace' }}>{props.data.text}</div>}
    </BaseNode>
  );
}

export function JumpNode(props: NodeProps<LoomNode>) {
  return (
    <BaseNode {...props}>
      <div className="node-body">↪ {props.data.text || '(未指定跳转目标)'}</div>
    </BaseNode>
  );
}

export function HubNode({ data, selected }: NodeProps<LoomNode>) {
  return (
    <div className={`flow-node hub-node ${selected ? 'selected' : ''}`} style={{ background: data.color || 'var(--bg-raised)' }}>
      <Handle type="target" position={Position.Left} />
      <span>{data.title || '◈'}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const nodeTypes = {
  dialogue: DialogueNode,
  fragment: FragmentNode,
  condition: ConditionNode,
  instruction: InstructionNode,
  jump: JumpNode,
  hub: HubNode,
};
