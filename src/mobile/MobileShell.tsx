import { useState } from 'react';
import { useLoom } from '../store';
import Icon, { type IconName } from '../components/Icon';
import ThemeToggle from '../components/ThemeToggle';
import MobileWrite from './MobileWrite';
import MobileNote from './MobileNote';
import MobileRef from './MobileRef';
import MobileMe from './MobileMe';

type MTab = 'write' | 'note' | 'ref' | 'me';

const TABS: { key: MTab; label: string; icon: IconName }[] = [
  { key: 'write', label: '写作', icon: 'doc' },
  { key: 'note', label: '快记', icon: 'bulb' },
  { key: 'ref', label: '设定', icon: 'book' },
  { key: 'me', label: '我的', icon: 'user' },
];

/** 移动端专用壳:4 个底部 tab,聚焦碎片时间写作与快记 */
export default function MobileShell() {
  const project = useLoom((s) => s.project);
  const [tab, setTab] = useState<MTab>('write');

  return (
    <>
      <div className="m-shell-head">
        <span className="m-shell-title">{project.name || '未命名项目'}</span>
        <ThemeToggle />
      </div>
      <div className="m-view">
        {tab === 'write' && <MobileWrite />}
        {tab === 'note' && <MobileNote />}
        {tab === 'ref' && <MobileRef />}
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
