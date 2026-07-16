import { useMemo, useState } from 'react';
import { useLoom } from '../store';
import { useNav } from '../search';
import Icon from './Icon';
import { findDocMatches, replaceInDocs, type ReplaceMatch } from '../revision';

const FIELD_LABEL: Record<ReplaceMatch['field'], string> = {
  text: '正文', item: '列表项', choice: '选项', condition: '条件', instruction: '指令',
};

export default function FindReplace({ onClose }: { onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const update = useLoom((s) => s.update);
  const go = useNav((s) => s.go);

  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searched, setSearched] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const matches = useMemo(
    () => (searched ? findDocMatches(project, searched, caseSensitive) : []),
    [project, searched, caseSensitive],
  );
  const totalOccurrences = matches.reduce((s, m) => s + m.count, 0);
  const selectedMatches = matches.filter((m) => !excluded.has(m.key));
  const selectedOccurrences = selectedMatches.reduce((s, m) => s + m.count, 0);

  const grouped = useMemo(() => {
    const map = new Map<string, ReplaceMatch[]>();
    for (const m of matches) map.set(m.docId, [...(map.get(m.docId) ?? []), m]);
    return [...map.entries()];
  }, [matches]);

  const runSearch = () => {
    setSearched(query);
    setExcluded(new Set());
    setDoneMsg(null);
  };

  const toggle = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const applyReplace = () => {
    if (!searched || selectedMatches.length === 0) return;
    const keys = new Set(selectedMatches.map((m) => m.key));
    let n = 0;
    update((p) => { n = replaceInDocs(p, searched, replacement, caseSensitive, keys); });
    setDoneMsg(`已替换 ${n} 处。改动是一步操作,可用 Ctrl+Z 撤销。`);
    setExcluded(new Set());
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel fr-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <span><Icon name="search" size={14} /> 全局查找替换(文档正文)</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="fr-row">
            <input
              autoFocus
              placeholder="查找…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
              style={{ flex: 1 }}
            />
            <button
              className={`ghost icon-btn ${caseSensitive ? 'fr-case-on' : ''}`}
              title="区分大小写"
              onClick={() => { setCaseSensitive((v) => !v); setSearched(null); }}
            >Aa</button>
            <button className="primary" onClick={runSearch} disabled={!query}>查找</button>
          </div>
          <div className="fr-row">
            <input
              placeholder="替换为…(留空 = 删除命中文本)"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="primary"
              disabled={!searched || selectedOccurrences === 0}
              onClick={applyReplace}
            >替换选中({selectedOccurrences} 处)</button>
          </div>
          {doneMsg && <div className="fr-done">{doneMsg}</div>}

          {searched !== null && (
            matches.length === 0 ? (
              <div className="empty-hint" style={{ padding: 20 }}>没有找到「{searched}」</div>
            ) : (
              <>
                <div className="hint" style={{ margin: '4px 0' }}>
                  {matches.length} 个位置 · {totalOccurrences} 处命中;取消勾选可跳过个别位置,点击文字跳转查看
                </div>
                <div className="fr-results">
                  {grouped.map(([docId, list]) => (
                    <div key={docId} className="fr-doc">
                      <div className="fr-doc-name">{list[0].docName}</div>
                      {list.map((m) => (
                        <div key={m.key} className="fr-match">
                          <input
                            type="checkbox"
                            checked={!excluded.has(m.key)}
                            onChange={() => toggle(m.key)}
                          />
                          <button
                            className="fr-preview"
                            title="跳转到该块"
                            onClick={() => { go({ tab: 'documents', docId: m.docId, blockId: m.blockId }); onClose(); }}
                          >
                            <span className="fr-field">{FIELD_LABEL[m.field]}{m.count > 1 ? ` ×${m.count}` : ''}</span>
                            {m.preview}
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
