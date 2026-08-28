import { useEffect, useRef, useState } from 'react';
import { useLoom } from '../store';
import Icon, { type IconName } from '../components/Icon';
import ThemeToggle from '../components/ThemeToggle';
import MobileWrite from './MobileWrite';
import MobileNote from './MobileNote';
import MobileRef from './MobileRef';
import MobileBrowse from './MobileBrowse';
import MobileMe from './MobileMe';
import { useKeyboardInset } from './useKeyboardInset';

type MTab = 'write' | 'note' | 'ref' | 'browse' | 'me';

const TABS: { key: MTab; label: string; icon: IconName }[] = [
  { key: 'write', label: '写作', icon: 'doc' },
  { key: 'note', label: '快记', icon: 'bulb' },
  { key: 'ref', label: '设定', icon: 'book' },
  { key: 'browse', label: '查阅', icon: 'grid' },
  { key: 'me', label: '我的', icon: 'user' },
];

export default function MobileShell() {
  const [tab, setTab] = useState<MTab>('write');
  useKeyboardInset();

  /**
   * tab 栏把自己的高度报给 CSS(`--m-tabbar-h`)。
   *
   * 弹层是 fixed 定位、按 `--vvh` 算高度的,不减掉 tab 栏就会有一截压在它底下 ——
   * 同步面板的操作按钮正好落在那一截里,滚到底也看不见。
   * 不写死数值:键盘弹起时 tab 栏整个隐藏(高度 0),那时弹层理应用满剩余高度。
   */
  const tabbarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = tabbarRef.current;
    if (!el) return;
    const write = () => {
      document.documentElement.style.setProperty('--m-tabbar-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    };
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--m-tabbar-h');
    };
  }, []);

  return (
    <>
      <div className="m-view">
        {tab === 'write' && <MobileWrite />}
        {tab === 'note' && <MobileNote onOpenWrite={() => setTab('write')} />}
        {tab === 'ref' && <MobileRef />}
        {tab === 'browse' && <MobileBrowse onOpenWrite={() => setTab('write')} />}
        {tab === 'me' && <MobileMe />}
      </div>
      <nav className="m-tabbar" ref={tabbarRef}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={20} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
