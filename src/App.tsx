import { useRef, useState } from 'react';
import { exportProject, importProject, useLoom } from './store';
import FlowEditor from './modules/flow/FlowEditor';
import EntityLibrary from './modules/entities/EntityLibrary';
import Brainstorm from './modules/brainstorm/Brainstorm';
import OutlineGrid from './modules/outline/OutlineGrid';
import ResearchCards from './modules/research/ResearchCards';
import Variables from './modules/variables/Variables';

type Tab = 'flow' | 'entities' | 'brainstorm' | 'outline' | 'research' | 'variables';

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'flow', icon: '🧵', label: '流程' },
  { key: 'entities', icon: '👤', label: '实体' },
  { key: 'brainstorm', icon: '💡', label: '风暴' },
  { key: 'outline', icon: '📋', label: '大纲' },
  { key: 'research', icon: '🗂️', label: '资料' },
  { key: 'variables', icon: '🔣', label: '变量' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('flow');
  const project = useLoom((s) => s.project);
  const update = useLoom((s) => s.update);
  const replaceProject = useLoom((s) => s.replaceProject);
  const resetProject = useLoom((s) => s.resetProject);
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File) => {
    try {
      const p = await importProject(file);
      if (confirm(`导入「${p.name}」将覆盖当前项目,确定吗?`)) replaceProject(p);
    } catch {
      alert('导入失败:文件不是有效的 TheLoom 项目文件');
    }
  };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="logo" title="叙事织机 TheLoom">🪡</div>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`nav-btn ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
            title={t.label}
          >
            <span className="nav-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <div className="main">
        <header className="topbar">
          <input
            className="project-name"
            value={project.name}
            onChange={(e) => update((p) => { p.name = e.target.value; })}
            placeholder="项目名称"
          />
          <span className="spacer" />
          <span className="saved-hint">已自动保存到本地</span>
          <button onClick={() => exportProject(project)}>导出项目</button>
          <button onClick={() => fileRef.current?.click()}>导入项目</button>
          <button
            className="ghost"
            onClick={() => { if (confirm('清空当前项目并恢复为示例项目?此操作不可撤销。')) resetProject(); }}
          >
            重置
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </header>

        <div className="content">
          {tab === 'flow' && <FlowEditor />}
          {tab === 'entities' && <EntityLibrary />}
          {tab === 'brainstorm' && <Brainstorm />}
          {tab === 'outline' && <OutlineGrid />}
          {tab === 'research' && <ResearchCards />}
          {tab === 'variables' && <Variables />}
        </div>
      </div>
    </div>
  );
}
