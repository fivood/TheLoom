import { useMemo, useRef, useState } from 'react';
import { useLoom } from '../store';
import { tokenize } from '../lang/parser';
import { checkScript, describeSpan, type ScriptMode } from '../lang/check';
import { buildScriptEnv } from '../lang/env';
import type { ScriptIssue, Token } from '../lang/ast';

interface Piece {
  text: string;
  cls: string;
}

/** 按 token 切片上色;无法词法分析时整段原样 */
function highlightPieces(src: string, tokens: Token[] | null, env: ReturnType<typeof buildScriptEnv>, errSpan: { start: number; end: number } | null): Piece[] {
  if (!tokens) return [{ text: src, cls: '' }];
  const pieces: Piece[] = [];
  let cursor = 0;
  const clsOf = (t: Token, prev: Token | undefined): string => {
    switch (t.type) {
      case 'number': return 'sc-num';
      case 'string': return 'sc-str';
      case 'boolean': return 'sc-bool';
      case 'op': return 'sc-op';
      case 'ident': {
        if (prev?.type === 'op' && prev.text === '.') return 'sc-prop';
        if (t.text === 'seen' || t.text === 'unseen') return 'sc-fn';
        if (t.text in env.entities) return 'sc-entity';
        if (t.text in env.vars) return 'sc-var';
        return 'sc-unknown';
      }
      default: return '';
    }
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'eof') break;
    if (t.span.start > cursor) pieces.push({ text: src.slice(cursor, t.span.start), cls: '' });
    pieces.push({ text: src.slice(t.span.start, t.span.end), cls: clsOf(t, tokens[i - 1]) });
    cursor = t.span.end;
  }
  if (cursor < src.length) pieces.push({ text: src.slice(cursor), cls: '' });
  if (errSpan && errSpan.end > errSpan.start) {
    // 把错误区间重新切一遍,叠加波浪下划线
    const out: Piece[] = [];
    let pos = 0;
    for (const piece of pieces) {
      const start = pos;
      const end = pos + piece.text.length;
      pos = end;
      if (end <= errSpan.start || start >= errSpan.end) {
        out.push(piece);
        continue;
      }
      const a = Math.max(start, errSpan.start);
      const b = Math.min(end, errSpan.end);
      if (a > start) out.push({ text: piece.text.slice(0, a - start), cls: piece.cls });
      out.push({ text: piece.text.slice(a - start, b - start), cls: `${piece.cls} sc-err` });
      if (b < end) out.push({ text: piece.text.slice(b - start), cls: piece.cls });
    }
    return out;
  }
  return pieces;
}

/** 光标处待补全的前缀;member = 「实体.」后的字段补全 */
function completionContext(src: string, caret: number): { prefix: string; start: number; entity?: string } | null {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_一-鿿㐀-䶿぀-ヿÀ-ɏ]/.test(src[start - 1])) start--;
  const prefix = src.slice(start, caret);
  let before = start - 1;
  while (before >= 0 && src[before] === ' ') before--;
  if (before >= 0 && src[before] === '.') {
    let objEnd = before;
    while (objEnd > 0 && src[objEnd - 1] === ' ') objEnd--;
    let objStart = objEnd;
    while (objStart > 0 && /[A-Za-z0-9_一-鿿㐀-䶿぀-ヿÀ-ɏ]/.test(src[objStart - 1])) objStart--;
    const entity = src.slice(objStart, objEnd);
    if (entity) return { prefix, start, entity };
  }
  if (!prefix) return null;
  return { prefix, start };
}

/**
 * 脚本输入框(R6):语法高亮 + 静态检查(错误精确到列)+ 自动补全。
 * 补全候选:变量 / 实体技术名 / seen / unseen;「实体.」后补字段名。
 */
export default function ScriptInput({ value, onChange, mode, placeholder, rows = 1 }: {
  value: string;
  onChange: (v: string) => void;
  mode: ScriptMode;
  placeholder?: string;
  rows?: number;
}) {
  const variables = useLoom((s) => s.project.variables);
  const entities = useLoom((s) => s.project.entities);
  const env = useMemo(
    () => buildScriptEnv({ variables, entities } as Parameters<typeof buildScriptEnv>[0]),
    [variables, entities],
  );
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [comboIndex, setComboIndex] = useState(0);
  const [comboDismissed, setComboDismissed] = useState(false);

  const issues: ScriptIssue[] = useMemo(() => checkScript(value, mode, env), [value, mode, env]);
  const firstError = issues.find((i) => i.severity === 'error') ?? null;

  const tokens = useMemo(() => {
    try {
      return tokenize(value);
    } catch {
      return null;
    }
  }, [value]);
  const pieces = useMemo(
    () => highlightPieces(value, tokens, env, firstError?.span ?? null),
    [value, tokens, env, firstError],
  );

  const combo = useMemo(() => {
    if (!focused || comboDismissed) return null;
    const c = completionContext(value, caret);
    if (!c) return null;
    let candidates: { name: string; hint: string }[];
    if (c.entity) {
      const props = env.entities[c.entity];
      if (!props) return null;
      candidates = Object.keys(props).map((k) => ({ name: k, hint: `${props[k]} 字段` }));
    } else {
      candidates = [
        ...Object.keys(env.vars).map((k) => ({ name: k, hint: `${env.vars[k]} 变量` })),
        ...Object.keys(env.entities).map((k) => ({ name: k, hint: '实体' })),
        { name: 'seen', hint: '函数 · 走过节点' },
        { name: 'unseen', hint: '函数 · 未走过' },
        { name: 'true', hint: '布尔' },
        { name: 'false', hint: '布尔' },
      ];
    }
    const filtered = candidates.filter((x) => x.name.startsWith(c.prefix) && x.name !== c.prefix);
    if (filtered.length === 0) return null;
    return { ...c, items: filtered.slice(0, 8) };
  }, [focused, comboDismissed, value, caret, env]);

  const syncCaret = () => {
    const ta = taRef.current;
    if (ta) setCaret(ta.selectionStart ?? 0);
    setComboDismissed(false);
  };

  const accept = (name: string) => {
    if (!combo) return;
    const before = value.slice(0, combo.start);
    const after = value.slice(caret);
    const insert = name + (name === 'seen' || name === 'unseen' ? '("")' : '');
    onChange(before + insert + after);
    const pos = combo.start + name.length + (name === 'seen' || name === 'unseen' ? 2 : 0);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(pos, pos);
        setCaret(pos);
      }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!combo) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setComboIndex((i) => (i + 1) % combo.items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setComboIndex((i) => (i - 1 + combo.items.length) % combo.items.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      accept(combo.items[Math.min(comboIndex, combo.items.length - 1)].name);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setComboDismissed(true);
    }
  };

  return (
    <div className="script-input">
      <div className="script-input-box">
        <pre ref={preRef} className="script-input-hl" aria-hidden>
          {pieces.map((piece, i) => (piece.cls
            ? <span key={i} className={piece.cls}>{piece.text}</span>
            : piece.text))}
          {'\n'}
        </pre>
        <textarea
          ref={taRef}
          rows={rows}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value);
            setComboIndex(0);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setComboDismissed(false);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={syncCaret}
          onSelect={syncCaret}
          onClick={syncCaret}
          onFocus={() => { setFocused(true); syncCaret(); }}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onScroll={() => {
            const ta = taRef.current;
            const pre = preRef.current;
            if (ta && pre) {
              pre.scrollTop = ta.scrollTop;
              pre.scrollLeft = ta.scrollLeft;
            }
          }}
        />
        {combo && (
          <div className="script-combo">
            {combo.items.map((item, i) => (
              <button
                key={item.name}
                className={`script-combo-item ${i === Math.min(comboIndex, combo.items.length - 1) ? 'active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); accept(item.name); }}
              >
                <span className="script-combo-name">{item.name}</span>
                <span className="script-combo-hint">{item.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {issues.slice(0, 3).map((issue, i) => (
        <div key={i} className={issue.severity === 'error' ? 'script-issue-err' : 'script-issue-warn'}>
          {describeSpan(value, issue.span)}:{issue.message}
        </div>
      ))}
    </div>
  );
}
