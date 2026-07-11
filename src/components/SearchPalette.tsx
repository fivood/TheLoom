import { useEffect, useMemo, useRef, useState } from 'react';
import { useLoom } from '../store';
import { searchProject, useNav, type SearchHit } from '../search';

export default function SearchPalette({ onClose }: { onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const go = useNav((s) => s.go);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const hits = useMemo(() => searchProject(project, query), [project, query]);
  const grouped = useMemo(() => {
    const g = new Map<string, SearchHit[]>();
    for (const h of hits) {
      if (!g.has(h.module)) g.set(h.module, []);
      g.get(h.module)!.push(h);
    }
    return [...g.entries()];
  }, [hits]);

  const open = (h: SearchHit) => {
    go(h.nav);
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter' && hits[cursor]) open(hits[cursor]);
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="全局搜索:节点、实体、大纲、时间线、资料、变量…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={onKey}
        />
        <div className="palette-results">
          {query && hits.length === 0 && <div className="empty-hint">没有找到「{query}」</div>}
          {grouped.map(([module, items]) => (
            <div key={module}>
              <div className="palette-group">{module}</div>
              {items.map((h) => {
                const idx = hits.indexOf(h);
                return (
                  <div
                    key={h.key}
                    className={`palette-item ${idx === cursor ? 'cursor' : ''}`}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => open(h)}
                  >
                    <span className="palette-kind">{h.kind}</span>
                    <span className="palette-title">{h.title}</span>
                    <span className="palette-snippet">{h.snippet}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {!query && (
            <div className="empty-hint">
              输入关键词,横跨全部模块搜索<br />↑↓ 选择 · Enter 跳转 · Esc 关闭
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
