import { RichText } from '../../components/RichText';
import type { DocBlock, Entity } from '../../types';

/** 只读的文章式块渲染:文档正文全篇视图与连续稿共用 */
export default function StaticBlock({ b, entities }: { b: DocBlock; entities: Entity[] }) {
  switch (b.type) {
    case 'heading':
      return <h3 className="ms-heading">{b.text || '(未命名场景)'}</h3>;
    case 'subheading':
      return b.level === 2 ? <h4 className="ms-sub2">{b.text}</h4> : <h5 className="ms-sub3">{b.text}</h5>;
    case 'dialogue': {
      const name = b.speakerId ? entities.find((e) => e.id === b.speakerId)?.name : null;
      return (
        <p className="ms-dialogue">
          {name && <b className="ms-speaker">{name}:</b>}
          {b.text ? <RichText text={b.text} /> : <span className="doc-flow-empty">(空对白 · 点击编辑)</span>}
        </p>
      );
    }
    case 'action':
      return b.text
        ? <p className="ms-action"><RichText text={b.text} /></p>
        : <p className="ms-action doc-flow-empty">(空段落 · 点击编辑)</p>;
    case 'quote':
      return <blockquote className="ms-quote">{b.text}</blockquote>;
    case 'list':
      return b.ordered
        ? <ol className="ms-list">{(b.items ?? []).map((it, i) => <li key={i}>{it}</li>)}</ol>
        : <ul className="ms-list">{(b.items ?? []).map((it, i) => <li key={i}>{it}</li>)}</ul>;
    case 'choice':
      return (
        <div className="ms-meta-block">
          ▸ {b.text || '选项'}{(b.choices ?? []).filter((c) => c.label).map((c) => ` / ${c.label}`).join('')}
        </div>
      );
    case 'condition':
      return <div className="ms-meta-block">◇ {b.condition || '(空条件)'}</div>;
    case 'instruction':
      return <div className="ms-meta-block">⚡ {b.instruction || '(空指令)'}</div>;
    case 'note':
      return <div className="ms-note">✎ {b.text}</div>;
    default:
      return null;
  }
}
