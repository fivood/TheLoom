import { useEffect, useState } from 'react';
import Icon, { type IconName } from './Icon';
import { applyPref, loadPref, resolveMode, savePref, THEME_PREF_LABEL, type ThemePref } from '../theme';

const ICON: Record<ThemePref, IconName> = { light: 'sun', dark: 'moon', system: 'monitor' };

/** 顶栏主题切换器:浅色 / 深色 / 跟随系统 三态,按钮显示当前生效模式的图标 */
export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() => loadPref());
  const [open, setOpen] = useState(false);
  const mode = resolveMode(pref);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // 点其他地方关闭菜单
    const id = window.setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    return () => { window.clearTimeout(id); document.removeEventListener('click', close); };
  }, [open]);

  const pick = (next: ThemePref) => {
    setPref(next);
    savePref(next);
    applyPref(next);
    setOpen(false);
  };

  return (
    <div className="theme-wrap">
      <button
        className="ghost icon-btn theme-toggle"
        title={`当前主题:${THEME_PREF_LABEL[pref]}${pref === 'system' ? `(${mode === 'dark' ? '深色' : '浅色'})` : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <Icon name={ICON[pref]} />
      </button>
      {open && (
        <div className="theme-menu" onClick={(e) => e.stopPropagation()}>
          {(Object.keys(THEME_PREF_LABEL) as ThemePref[]).map((p) => (
            <button
              key={p}
              className={p === pref ? 'active' : ''}
              onClick={() => pick(p)}
            >
              <Icon name={ICON[p]} size={14} /> {THEME_PREF_LABEL[p]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
