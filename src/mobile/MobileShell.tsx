import { useState } from 'react';
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

  return (
    <>
      <div className="m-view">
        {tab === 'write' && <MobileWrite />}
        {tab === 'note' && <MobileNote onOpenWrite={() => setTab('write')} />}
        {tab === 'ref' && <MobileRef />}
        {tab === 'browse' && <MobileBrowse onOpenWrite={() => setTab('write')} />}
        {tab === 'me' && <MobileMe />}
      </div>
      <nav className="m-tabbar">
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
