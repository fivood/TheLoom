import { useRef } from 'react';
import type { ReactNode } from 'react';

/** 行内 Markdown 渲染:**bold** / *italic* / ~~strike~~。
 * React 默认转义字符串,无 XSS 风险。可嵌套(如 **粗 *粗斜* 粗**)。 */
export function RichText({ text }: { text: string }) {
  return <>{parseInline(text)}</>;
}

interface Rule { start: string; end: string; render: (kids: ReactNode, key: any) => ReactNode }
const RULES: Rule[] = [
  { start: '**', end: '**', render: (k, key) => <strong key={key}>{k}</strong> },
  { start: '*', end: '*', render: (k, key) => <em key={key}>{k}</em> },
  { start: '~~', end: '~~', render: (k, key) => <s key={key}>{k}</s> },
];

function parseInline(text: string, keyPrefix = ''): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let buf = '';
  let idx = 0;
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };
  while (i < text.length) {
    let matched = false;
    for (const r of RULES) {
      if (text.startsWith(r.start, i)) {
        const end = text.indexOf(r.end, i + r.start.length);
        if (end > 0) {
          flush();
          const inner = text.slice(i + r.start.length, end);
          out.push(r.render(parseInline(inner, `${keyPrefix}${idx}-`), `${keyPrefix}${idx}`));
          idx++;
          i = end + r.end.length;
          matched = true;
          break;
        }
      }
    }
    if (!matched) { buf += text[i]; i++; }
  }
  flush();
  return out;
}

/** 带格式工具栏的 textarea:点 B/I/S 在选区两侧包夹标记 */
export function RichTextInput({ value, onChange, rows = 5, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (marker: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const selected = value.slice(a, b);
    const next = value.slice(0, a) + marker + selected + marker + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = a + marker.length;
      el.selectionEnd = b + marker.length;
    });
  };
  return (
    <div className="rich-input">
      <div className="rich-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <button type="button" onClick={() => wrap('**')} title="粗体 **"><b>B</b></button>
        <button type="button" onClick={() => wrap('*')} title="斜体 *"><i>I</i></button>
        <button type="button" onClick={() => wrap('~~')} title="删除线 ~~"><s>S</s></button>
        <span className="hint" style={{ fontSize: 11 }}>行内标记 **粗** *斜* ~~删~~</span>
      </div>
      <textarea ref={ref} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
