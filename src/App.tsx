import { useEffect, useRef, useState } from 'react';
import { exportProject, importProject, useLoom } from './store';
import {
  folderHasProject, isTauri, loadFromFolder, pickFolder, saveToFolder, setSavedFolder,
} from './storage';
import { useNav } from './search';
import { checkForUpdates } from './updater';
import SearchPalette from './components/SearchPalette';
import SyncPanel from './components/SyncPanel';
import Icon, { type IconName } from './components/Icon';
import FlowEditor from './modules/flow/FlowEditor';
import EntityLibrary from './modules/entities/EntityLibrary';
import Brainstorm from './modules/brainstorm/Brainstorm';
import OutlineGrid from './modules/outline/OutlineGrid';
import Timeline from './modules/timeline/Timeline';
import ResearchCards from './modules/research/ResearchCards';
import Variables from './modules/variables/Variables';

type Tab = 'flow' | 'entities' | 'brainstorm' | 'outline' | 'timeline' | 'research' | 'variables';

const TABS: { key: Tab; icon: IconName; label: string }[] = [
  { key: 'flow', icon: 'flow', label: '流程' },
  { key: 'entities', icon: 'entity', label: '实体' },
  { key: 'brainstorm', icon: 'bulb', label: '风暴' },
  { key: 'outline', icon: 'grid', label: '大纲' },
  { key: 'timeline', icon: 'clock', label: '时间线' },
  { key: 'research', icon: 'archive', label: '资料' },
  { key: 'variables', icon: 'braces', label: '变量' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('flow');
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const navTarget = useNav((s) => s.target);
  const navSeq = useNav((s) => s.seq);

  // 搜索/反向引用跳转:切到目标模块,细节由模块自行消费
  useEffect(() => {
    if (navTarget) setTab(navTarget.tab);
  }, [navSeq]);
  const project = useLoom((s) => s.project);
  const update = useLoom((s) => s.update);
  const replaceProject = useLoom((s) => s.replaceProject);
  const resetProject = useLoom((s) => s.resetProject);
  const folder = useLoom((s) => s.folder);
  const syncError = useLoom((s) => s.syncError);
  const setFolder = useLoom((s) => s.setFolder);
  const revision = useLoom((s) => s.revision);
  const canUndo = useLoom((s) => s.canUndo);
  const canRedo = useLoom((s) => s.canRedo);
  const fileRef = useRef<HTMLInputElement>(null);

  // 全局撤销/重做快捷键;焦点在输入框时交给浏览器原生文本撤销
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); setSearching(true); return; }
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); useLoom.getState().undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); useLoom.getState().redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 桌面版:启动后静默检查更新
  useEffect(() => {
    if (isTauri) setTimeout(() => checkForUpdates(true), 3000);
  }, []);

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
        <div className="logo" title="叙事织机 TheLoom"><img src="/logo.svg" alt="TheLoom" width={26} height={26} /></div>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`nav-btn ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
            title={t.label}
          >
            <Icon name={t.icon} size={18} />
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
          <button className="ghost" title="全局搜索 (Ctrl+K)" onClick={() => setSearching(true)}><Icon name="search" /> 搜索</button>
          <button className="ghost icon-btn" disabled={!canUndo} title="撤销 (Ctrl+Z)" onClick={() => useLoom.getState().undo()}><Icon name="undo" /></button>
          <button className="ghost icon-btn" disabled={!canRedo} title="重做 (Ctrl+Y)" onClick={() => useLoom.getState().redo()}><Icon name="redo" /></button>
          <span className="spacer" />
          {syncError ? (
            <span className="saved-hint" style={{ color: 'var(--danger)' }} title={syncError}>⚠ 同步失败</span>
          ) : (
            <span className="saved-hint" title={folder ?? undefined}>
              {folder ? `已同步 · ${folder.split(/[\\/]/).pop()}` : '已自动保存到本地'}
            </span>
          )}
          <button
            className="ghost saved-hint"
            style={{ padding: '2px 6px' }}
            title={isTauri ? '点击检查更新' : '网页版随部署自动更新'}
            onClick={() => { if (isTauri) checkForUpdates(false); }}
          >
            v{__APP_VERSION__}
          </button>
          {isTauri && (
            <>
              <button onClick={chooseFolder} title={folder ?? '选择一个文件夹存放项目(放进 OneDrive / Google Drive 即可云同步,也可直接作为 Obsidian 库)'}>
                <Icon name="folder" /> {folder ? '更换文件夹' : '项目文件夹'}
              </button>
              {folder && <button onClick={reloadFolder} title="从磁盘重新加载(在 Obsidian 或其他设备上改动后用)"><Icon name="refresh" /> 重新加载</button>}
            </>
          )}
          <button onClick={() => setSyncing(true)} title="多人协作:云端房间推送 / 拉取(端到端加密)">
            <Icon name="cloud" /> 协作
          </button>
          <button onClick={() => exportProject(project)}><Icon name="download" /> 导出项目</button>
          <button onClick={() => fileRef.current?.click()}><Icon name="upload" /> 导入项目</button>
          <button
            className="ghost"
            title="载入内置示例项目(旧书店与叙事织机的故事)"
            onClick={() => { if (confirm('载入内置示例项目,替换当前内容?')) useLoom.getState().loadSampleProject(); }}
          >
            <Icon name="book" /> 示例
          </button>
          <button
            className="ghost"
            onClick={() => { if (confirm('清空当前项目,从空白开始?此操作不可撤销。')) resetProject(); }}
          >
            <Icon name="reset" /> 清空
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

        <div className="content" key={revision}>
          {tab === 'flow' && <FlowEditor />}
          {tab === 'entities' && <EntityLibrary />}
          {tab === 'brainstorm' && <Brainstorm />}
          {tab === 'outline' && <OutlineGrid />}
          {tab === 'timeline' && <Timeline />}
          {tab === 'research' && <ResearchCards />}
          {tab === 'variables' && <Variables />}
        </div>
      </div>

      {searching && <SearchPalette onClose={() => setSearching(false)} />}
      {syncing && <SyncPanel onClose={() => setSyncing(false)} />}
    </div>
  );
}
