import { memo, useMemo } from 'react';
import { useLoom } from '../../store';
import { RichText } from '../../components/RichText';
import type { DocBlock, Document, Entity } from '../../types';
import { DOC_STATUS_LABEL } from '../../types';
import { documentWordCount, folderPath } from '../../util';
import BlocksEditor from './BlocksEditor';

function StaticBlock({ b, entities }: { b: DocBlock; entities: Entity[] }) {
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
          <RichText text={b.text} />
        </p>
      );
    }
    case 'action':
      return <p className="ms-action"><RichText text={b.text} /></p>;
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
      return <div className="ms-meta-block">◇ {b.condition}</div>;
    case 'instruction':
      return <div className="ms-meta-block">⚡ {b.instruction}</div>;
    case 'note':
      return <div className="ms-note">✎ {b.text}</div>;
    default:
      return null;
  }
}

/**
 * 非活动场景的轻量静态渲染:纯只读 DOM,点击整块激活编辑。
 * commit 会整体替换 project(引用全变),这里按 id + updatedAt 记忆化,
 * 30 万字 150 场时其他场景不随每次按键重渲染。
 */
const StaticScene = memo(
  function StaticScene({ doc, entities }: { doc: Document; entities: Entity[]; namesKey: string }) {
    return (
      <div className="ms-static">
        {doc.blocks.map((b) => <StaticBlock key={b.id} b={b} entities={entities} />)}
      </div>
    );
  },
  (prev, next) =>
    prev.doc.id === next.doc.id &&
    prev.doc.updatedAt === next.doc.updatedAt &&
    prev.namesKey === next.namesKey,
);

/**
 * 连续稿模式:按卷 / 章 / 场景树顺序把所有文档连成一篇稿子。
 * 只有激活场景挂载块编辑器,其余场景是轻量静态 DOM + content-visibility,
 * 30 万字项目也能流畅滚动与连续编辑。
 */
export default function Manuscript({ docs, selectedId, onSelect }: {
  docs: Document[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const entities = useLoom((s) => s.project.entities);
  const folders = useLoom((s) => s.project.folders);
  const docFolders = useMemo(() => folders.filter((f) => f.module === 'document'), [folders]);

  // 实体名的稳定比较键:改名才变化,commit 引起的引用更替不打破 StaticScene 记忆化
  const namesKey = useMemo(() => entities.map((e) => `${e.id}:${e.name}`).join('|'), [entities]);

  const totalWords = useMemo(() => docs.reduce((s, d) => s + documentWordCount(d), 0), [docs]);

  return (
    <div className="manuscript">
      <div className="ms-total">
        全稿 {docs.length} 场 · {totalWords} 字
      </div>
      {docs.map((d) => {
        const active = d.id === selectedId;
        const words = documentWordCount(d);
        const path = folderPath(d.folderId, docFolders);
        return (
          <section
            key={d.id}
            className={`ms-scene${active ? ' active' : ''}`}
            onClick={active ? undefined : () => onSelect(d.id)}
            title={active ? undefined : '点击进入编辑'}
          >
            <header className="ms-scene-head">
              <span className="ms-scene-path">{path && `${path} · `}{d.name}</span>
              {d.status && <span className={`ms-status ms-status-${d.status}`}>{DOC_STATUS_LABEL[d.status]}</span>}
              {d.timeLabel && <span className="ms-scene-tag">🕓 {d.timeLabel}</span>}
              {d.povId && <span className="ms-scene-tag">POV {entities.find((e) => e.id === d.povId)?.name ?? '?'}</span>}
              <span className="ms-scene-words">
                {words}{typeof d.wordTarget === 'number' && d.wordTarget > 0 ? ` / ${d.wordTarget}` : ''} 字
              </span>
            </header>
            {active ? <BlocksEditor doc={d} /> : <StaticScene doc={d} entities={entities} namesKey={namesKey} />}
          </section>
        );
      })}
      {docs.length === 0 && (
        <div className="empty-hint" style={{ margin: '48px auto' }}>
          当前筛选下没有场景。<br />在左侧建立卷 / 章文件夹与场景文档,即可在此连续写作。
        </div>
      )}
    </div>
  );
}
