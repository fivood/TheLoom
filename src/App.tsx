import { useEffect, useRef, useState } from 'react';
import { exportProject, importProject, useLoom } from './store';
import {
  folderHasProject, isTauri, loadFromFolder, pickFolder, saveToFolder, setSavedFolder,
} from './storage';
import FlowEditor from './modules/flow/FlowEditor';
import EntityLibrary from './modules/entities/EntityLibrary';
import Brainstorm from './modules/brainstorm/Brainstorm';
import OutlineGrid from './modules/outline/OutlineGrid';
import Timeline from './modules/timeline/Timeline';
import ResearchCards from './modules/research/ResearchCards';
import Variables from './modules/variables/Variables';

type Tab = 'flow' | 'entities' | 'brainstorm' | 'outline' | 'timeline' | 'research' | 'variables';

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'flow', icon: '🧵', label: '流程' },
  { key: 'entities', icon: '👤', label: '实体' },
  { key: 'brainstorm', icon: '💡', label: '风暴' },
  { key: 'outline', icon: '📋', label: '大纲' },
  { key: 'timeline', icon: '⏳', label: '时间线' },
  { key: 'research', icon: '🗂️', label: '资料' },
  { key: 'variables', icon: '🔣', label: '变量' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('flow');
  const project = useLoom((s) => s.project);
  const update = useLoom((s) => s.update);
  const replaceProject = useLoom((s) => s.replaceProject);
  const resetProject = useLoom((s) => s.resetProject);
  const folder = useLoom((s) => s.folder);
  const syncError = useLoom((s) => s.syncError);
  const setFolder = useLoom((s) => s.setFolder);
  const fileRef = useRef<HTMLInputElement>(null);

  // Tauri 模式:启动时从上次的项目文件夹加载
  useEffect(() => {
    if (!isTauri || !folder) return;
    loadFromFolder(folder)
      .then((p) => useLoom.getState().replaceProject(p))
      .catch(() => {
        alert(`无法读取项目文件夹:\n${folder}\n\n已切换为浏览器本地存储。`);
        setSavedFolder(null);
        setFolder(null);
      });
    // 仅启动时执行一次
  }, []);

  const chooseFolder = async () => {
    const dir = await pickFolder();
    if (!dir) return;
    try {
      if (await folderHasProject(dir)) {
        if (!confirm(`该文件夹已有项目数据,加载它并替换当前打开的项目?\n\n${dir}`)) return;
        const p = await loadFromFolder(dir);
        useLoom.getState().replaceProject(p);
      } else {
        if (!confirm(`将当前项目「${project.name}」写入该文件夹?\n\n${dir}\n\n之后所有改动都会自动保存到这里。`)) return;
        await saveToFolder(dir, project);
      }
      setSavedFolder(dir);
      setFolder(dir);
    } catch (e) {
      alert(`操作失败:${e}`);
    }
  };

  const reloadFolder = async () => {
    if (!folder) return;
    try {
      const p = await loadFromFolder(folder);
      useLoom.getState().replaceProject(p);
    } catch (e) {
      alert(`重新加载失败:${e}`);
    }
  };

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
          {syncError ? (
            <span className="saved-hint" style={{ color: 'var(--danger)' }} title={syncError}>⚠ 同步失败</span>
          ) : (
            <span className="saved-hint" title={folder ?? undefined}>
              {folder ? `已同步 · ${folder.split(/[\\/]/).pop()}` : '已自动保存到本地'}
            </span>
          )}
          {isTauri && (
            <>
              <button onClick={chooseFolder} title={folder ?? '选择一个文件夹存放项目(放进 OneDrive / Google Drive 即可云同步,也可直接作为 Obsidian 库)'}>
                📁 {folder ? '更换文件夹' : '项目文件夹'}
              </button>
              {folder && <button onClick={reloadFolder} title="从磁盘重新加载(在 Obsidian 或其他设备上改动后用)">⟳ 重新加载</button>}
            </>
          )}
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
          {tab === 'timeline' && <Timeline />}
          {tab === 'research' && <ResearchCards />}
          {tab === 'variables' && <Variables />}
        </div>
      </div>
    </div>
  );
}
