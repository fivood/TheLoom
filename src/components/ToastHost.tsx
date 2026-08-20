import { dismissToast, useToasts } from '../toast';

export default function ToastHost() {
  const items = useToasts();
  if (items.length === 0) return null;
  return (
    <div className="toast-host">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-msg">{t.message}</span>
          {t.onAction && (
            <button
              className="toast-action"
              onClick={() => { t.onAction!(); dismissToast(t.id); }}
            >{t.actionLabel ?? '撤销'}</button>
          )}
          <button className="toast-close" aria-label="关闭" onClick={() => dismissToast(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
