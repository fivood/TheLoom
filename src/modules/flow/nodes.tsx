import { Handle, NodeResizer, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import type { FlowNodeData, FlowNodeType } from '../../types';
import { FLOW_NODE_LABEL } from '../../types';
import { useLoom } from '../../store';
import { countSubNodes } from '../../util';
import Icon, { KIND_ICON } from '../../components/Icon';

export const TYPE_COLORS: Record<FlowNodeType, string> = {
  dialogue: '#1b1b19',
  fragment: '#565550',
  hub: '#8e8d86',
  condition: '#3a3936',
  instruction: '#72716b',
  jump: '#4a4946',
  exit: '#aaa9a1',
  note: '#c6c5bd',
  zone: '#e0dfd8',
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
          <div className="node-speaker">
            {speaker.avatar
              ? <img className="speaker-avatar" src={speaker.avatar} alt="" />
              : <Icon name={KIND_ICON[speaker.kind]} size={13} />}
            {speaker.name}
          </div>
        )}
        {props.data.text || <span style={{ opacity: 0.5 }}>(空对白)</span>}
      </div>
    </BaseNode>
  );
}

export function FragmentNode(props: NodeProps<LoomNode>) {
  const count = countSubNodes(props.data.sub);
  const exits = (props.data.sub?.nodes ?? []).filter((n) => n.type === 'exit');
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
      {exits.length > 0 && (
        <div className="exit-rows">
          {exits.map((x) => (
            <div key={x.id} className="exit-row">
              <span>{x.data.title || '出口'}</span>
              <Handle id={`exit:${x.id}`} type="source" position={Position.Right} />
            </div>
          ))}
        </div>
      )}
    </BaseNode>
  );
}

/** 出口节点:子流程通向父层命名引脚的锚点 */
export function ExitNode({ data, selected }: NodeProps<LoomNode>) {
  return (
    <div className={`flow-node exit-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <span>⇥ {data.title || '出口'}</span>
    </div>
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

/** 画布注释:不参与叙事,仅作备忘 */
export function NoteNode({ data, selected }: NodeProps<LoomNode>) {
  return (
    <div className={`flow-note ${selected ? 'selected' : ''}`}>
      {data.title && <div className="flow-note-title">{data.title}</div>}
      <div className="flow-note-text">{data.text || '(空注释,选中后在右侧编辑)'}</div>
    </div>
  );
}

/** 分区框:可缩放的背景区块,用于给画布分幕/分场 */
export function ZoneNode({ id, data, selected }: NodeProps<LoomNode>) {
  const { updateNodeData } = useReactFlow();
  return (
    <div className={`flow-zone ${selected ? 'selected' : ''}`} style={{ width: data.w ?? 420, height: data.h ?? 300 }}>
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={100}
        onResizeEnd={(_, p) => updateNodeData(id, { w: Math.round(p.width), h: Math.round(p.height) })}
      />
      <div className="zone-head">{data.title || '分区'}</div>
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
  exit: ExitNode,
  note: NoteNode,
  zone: ZoneNode,
};
