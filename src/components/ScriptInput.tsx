import { useMemo, useRef, useState } from 'react';
import { useLoom } from '../store';
import { buildScriptScope } from '../script';
import { lex } from '../script/lexer';
import { checkCondition, checkInstructions, checkNumberExpr, type ScriptScope } from '../script/check';
import type { Diagnostic } from '../script/ast';

export type ScriptMode = 'condition' | 'number' | 'instruction';

const MODE_PLACEHOLDER: Record<ScriptMode, string> = {
  condition: '如 trust >= 5 && seen("n1")',
  number: '如 trust + 2',
  instruction: '如 trust += 1; sem.好感 = 5(分号或换行分隔)',
};

const KEYWORDS = ['true', 'false', 'seen', 'unseen'];

function useScriptScope(): ScriptScope {
  const variables = useLoom((s) => s.project.variables);
  const entities = useLoom((s) => s.project.entities);
  const flows = useLoom((s) => s.project.flows);
  return useMemo(
    () => buildScriptScope({ variables, entities, flows } as Parameters<typeof buildScriptScope>[0]),
    [variables, entities, flows],
  );
}

function classify(tokenValue: string, kind: string, scope: ScriptScope, prevDot: boolean): string {
  if (kind === 'string') return 'sh-str';
  if (kind === 'number') return 'sh-num';
  if (kind === 'op' || kind === 'punct') return 'sh-op';
  if (kind === 'error') return 'sh-bad';
  if (prevDot) return 'sh-field';
  if (KEYWORDS.includes(tokenValue)) return 'sh-kw';
  if (scope.entities.has(tokenValue)) return 'sh-entity';
  if (scope.vars.has(tokenValue)) return 'sh-var';
  return 'sh-unknown';
}

interface Segment { text: string; cls: string }

/** 按 token + 诊断区间给每个字符归类,再合并相邻同类段 */
function highlight(src: string, scope: ScriptScope, diags: Diagnostic[]): Segment[] {
  const base: string[] = new Array(src.length).fill('');
  const tokens = lex(src);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'newline') continue;
    const prev = tokens[i - 1];
    const cls = classify(t.value, t.kind, scope, !!prev && prev.kind === 'punct' && prev.value === '.');
    for (let j = t.start; j < t.end && j < src.length; j++) base[j] = cls;
  }
  for (const d of diags) {
    const mark = d.severity === 'error' ? ' sh-err' : ' sh-warn';
    for (let j = d.start; j < Math.min(d.end, src.length); j++) base[j] += mark;
  }
  const segs: Segment[] = [];
  for (let i = 0; i < src.length; i++) {
    const last = segs[segs.length - 1];
    if (last && last.cls === base[i]) last.text += src[i];
    else segs.push({ text: src[i], cls: base[i] });
  }
  return segs;
}

interface Suggestion { label: string; detail?: string; insert: string }

function suggestionsAt(src: string, caret: number, scope: ScriptScope): { items: Suggestion[]; from: number } | null {
  const before = src.slice(0, caret);
  const m = /([\p{L}_][\p{L}\p{N}_]*)?$/u.exec(before);
  const prefix = m?.[1] ?? '';
  const from = caret - prefix.length;
  const beforePrefix = before.slice(0, from);

  const dotMatch = /([\p{L}_][\p{L}\p{N}_]*)\.\s*$/u.exec(beforePrefix);
  if (dotMatch) {
    const fields = scope.entities.get(dotMatch[1]);
    if (!fields) return null;
    const items = [...fields.keys()]
      .filter((f) => f.startsWith(prefix) && f !== prefix)
      .map((f) => ({ label: f, detail: '字段', insert: f }));
    return items.length > 0 ? { items, from } : null;
  }

  if (!prefix) return null;
  const items: Suggestion[] = [];
  for (const [name] of scope.vars) {
    if (name.startsWith(prefix) && name !== prefix) items.push({ label: name, detail: '变量', insert: name });
  }
  for (const [tech] of scope.entities) {
    if (tech.startsWith(prefix) && tech !== prefix) items.push({ label: tech, detail: '实体', insert: `${tech}.` });
  }
  for (const kw of KEYWORDS) {
    if (kw.startsWith(prefix) && kw !== prefix) {
      items.push(kw === 'seen' || kw === 'unseen'
        ? { label: `${kw}("…")`, detail: '函数', insert: `${kw}("")` }
        : { label: kw, insert: kw });
    }
  }
  return items.length > 0 ? { items: items.slice(0, 8), from } : null;
}

/**
 * R6 脚本输入框:语法高亮(叠层)+ 类型诊断(波浪线 + 列表)+ 自动补全。
 * 条件 / 检定数字 / 指令三种模式,共享同一作用域(变量 + 实体字段 + 节点技术名)。
 */
export default function ScriptInput({ value, onChange, mode, rows = 2, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  mode: ScriptMode;
  rows?: number;
  placeholder?: string;
}) {
  const scope = useScriptScope();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [menu, setMenu] = useState<{ items: Suggestion[]; from: number; active: number } | null>(null);

  const diagnostics = useMemo(() => {
    if (!value.trim()) return [];
    if (mode === 'condition') return checkCondition(value, scope);
    if (mode === 'number') return checkNumberExpr(value, scope);
    return checkInstructions(value, scope);
  }, [value, mode, scope]);

  const segments = useMemo(() => highlight(value, scope, diagnostics), [value, scope, diagnostics]);

  const refreshMenu = (src: string, caret: number) => {
    const s = suggestionsAt(src, caret, scope);
    setMenu(s ? { ...s, active: 0 } : null);
  };

  const accept = (s: Suggestion) => {
    if (!menu || !taRef.current) return;
    const ta = taRef.current;
    const caret = ta.selectionStart;
    const next = value.slice(0, menu.from) + s.insert + value.slice(caret);
    const newCaret = menu.from + s.insert.length - (s.insert.endsWith('")') ? 2 : 0);
    onChange(next);
    setMenu(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCaret, newCaret);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menu) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMenu({ ...menu, active: (menu.active + 1) % menu.items.length });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMenu({ ...menu, active: (menu.active - 1 + menu.items.length) % menu.items.length });
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      accept(menu.items[menu.active]);
    } else if (e.key === 'Escape') {
      setMenu(null);
    }
  };

  return (
    <div className="script-input">
      <div className="script-input-box">
        <pre ref={preRef} className="script-input-hl" aria-hidden>
          {segments.map((s, i) => (s.cls ? <span key={i} className={s.cls}>{s.text}</span> : s.text))}
          {'\n'}
        </pre>
        <textarea
          ref={taRef}
          rows={rows}
          value={value}
          placeholder={placeholder ?? MODE_PLACEHOLDER[mode]}
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value);
            refreshMenu(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onClick={() => setMenu(null)}
          onBlur={() => window.setTimeout(() => setMenu(null), 150)}
          onScroll={(e) => {
            if (preRef.current) {
              preRef.current.scrollTop = e.currentTarget.scrollTop;
              preRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
        />
        {menu && (
          <div className="script-menu">
            {menu.items.map((s, i) => (
              <button
                key={s.label}
                className={i === menu.active ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); accept(s); }}
              >
                <span>{s.label}</span>
                {s.detail && <span className="script-menu-detail">{s.detail}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {diagnostics.length > 0 && (
        <div className="script-diags">
          {diagnostics.slice(0, 4).map((d, i) => (
            <div key={i} className={d.severity === 'error' ? 'script-diag-err' : 'script-diag-warn'}>
              {d.severity === 'error' ? '✕' : '⚠'} 第 {d.start + 1}–{d.end} 字符:{d.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
