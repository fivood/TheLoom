import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDialog } from '../dialog';

export default function DialogHost() {
  const current = useDialog((s) => s.current);
  const close = useDialog((s) => s.close);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef('');
  valueRef.current = value;

  useEffect(() => {
    if (!current) { setValue(''); return; }
    setValue(current.options.defaultValue ?? '');
    if (current.kind === 'prompt' && !current.options.multiline) {
      const t = window.setTimeout(() => {
        const el = inputRef.current;
        if (el) { el.focus(); el.select(); }
      }, 0);
      return () => window.clearTimeout(t);
    }
    if (current.kind === 'prompt' && current.options.multiline) {
      const t = window.setTimeout(() => textareaRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    if (current.kind === 'alert' || current.kind === 'confirm') {
      const t = window.setTimeout(() => {
        const btn = document.querySelector<HTMLButtonElement>('.dialog-actions .primary, .dialog-actions .danger');
        btn?.focus();
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (current.kind === 'prompt') close(null);
        else if (current.kind === 'confirm') close(false);
        else close(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, close]);

  useLayoutEffect(() => {
    document.body.style.overflow = current ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [current]);

  if (!current) return null;
  const { kind, options } = current;

  const submit = () => {
    if (kind === 'prompt') close(valueRef.current);
    else close(true);
  };
  const cancel = () => {
    if (kind === 'prompt') close(null);
    else if (kind === 'confirm') close(false);
    else close(true);
  };

  const onBackdrop = () => {
    if (kind === 'alert') return;
    cancel();
  };

  const confirmLabel = options.confirmText ?? (kind === 'alert' ? '知道了' : '确定');
  const cancelLabel = options.cancelText ?? '取消';

  return (
    <div className="palette-backdrop dialog-backdrop" onClick={onBackdrop}>
      <form
        className="palette dialog-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        {options.title && <div className="dialog-title">{options.title}</div>}
        <p className="dialog-message">{options.message}</p>
        {kind === 'prompt' && (
          options.multiline ? (
            <textarea
              ref={textareaRef}
              className="dialog-textarea"
              value={value}
              placeholder={options.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
              }}
              rows={5}
            />
          ) : (
            <input
              ref={inputRef}
              className="dialog-input"
              value={value}
              placeholder={options.placeholder}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
            />
          )
        )}
        <div className="dialog-actions">
          {kind !== 'alert' && (
            <button type="button" className="ghost" onClick={cancel}>{cancelLabel}</button>
          )}
          <button type="submit" className={options.danger ? 'danger' : 'primary'}>{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
