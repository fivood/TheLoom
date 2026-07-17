import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { exportProject, useLoom } from './store';
import { assetsToCsv, downloadCsv, entitiesToCsv, outlineToCsv } from './export';
import {
  folderHasProject, isTauri, loadFromFolder, pickFolder, saveToFolder, setSavedFolder,
} from './storage';
import { exportBlobsToFolder } from './assetFiles';
import { useNav } from './search';
import { confirmDialog, alertDialog } from './dialog';
import { findAvailableUpdate, shouldAutoPromptUpdate } from './updater';
import { LOCAL_STORAGE_WARNING_BYTES } from './diagnostics';
import SearchPalette from './components/SearchPalette';
import SyncPanel from './components/SyncPanel';
import AuditPanel from './components/AuditPanel';
import VersionHistory from './components/VersionHistory';
import PaletteManager from './components/PaletteManager';
import { initPaneWidths } from './components/PaneHandle';
import ThemeToggle from './components/ThemeToggle';
import { AiExtractModal, AiSettingsModal } from './components/AiPanel';
import ProjectImportWizard from './components/ProjectImportWizard';
import ProjectMenu from './components/ProjectMenu';
import UpdateDialog, { type UpdateDialogState } from './components/UpdateDialog';
import RecoveryPanel from './components/RecoveryPanel';
import DialogHost from './components/Dialog';
import ImportPreview from './components/ImportPreview';
import FindReplace from './components/FindReplace';
import EngineExportModal from './components/EngineExportModal';
import QueryPanel from './components/QueryPanel';
import Icon, { type IconName } from './components/Icon';
import { projectToXlsx } from './interop/projectXlsx';
import { paragraphsToFdx, documentToParagraphs, flowToParagraphs } from './interop/fdx';

// 模块懒加载:首屏只加载默认 tab(流程),其他 9 个模块切换时才下载对应 chunk
const FlowEditor = lazy(() => import('./modules/flow/FlowEditor'));
const EntityLibrary = lazy(() => import('./modules/entities/EntityLibrary'));
const Assets = lazy(() => import('./modules/assets/Assets'));
const DocumentView = lazy(() => import('./modules/document/DocumentView'));
const Brainstorm = lazy(() => import('./modules/brainstorm/Brainstorm'));
const OutlineGrid = lazy(() => import('./modules/outline/OutlineGrid'));
const Timeline = lazy(() => import('./modules/timeline/Timeline'));
const MapEditor = lazy(() => import('./modules/map/MapEditor'));
const ResearchCards = lazy(() => import('./modules/research/ResearchCards'));
const Variables = lazy(() => import('./modules/variables/Variables'));
const Planning = lazy(() => import('./modules/planning/Planning'));
const AiAssistantPanel = lazy(() => import('./components/AiAssistantPanel'));

type Tab = 'flow' | 'entities' | 'assets' | 'documents' | 'brainstorm' | 'outline' | 'timeline' | 'map' | 'research' | 'variables' | 'planning';
type TabGroup = 'build' | 'library' | 'plan' | 'logic';

const GROUP_LABEL: Record<TabGroup, string> = {
  build: '构建', library: '素材', plan: '规划', logic: '逻辑',
};

const TABS: { key: Tab; icon: IconName; label: string; group: TabGroup }[] = [
  { key: 'flow', icon: 'flow', label: '流程', group: 'build' },
  { key: 'documents', icon: 'doc', label: '文档', group: 'build' },
  { key: 'entities', icon: 'entity', label: '实体', group: 'library' },
  { key: 'assets', icon: 'image', label: '资源', group: 'library' },
  { key: 'research', icon: 'archive', label: '资料', group: 'library' },
  { key: 'planning', icon: 'flag', label: '规划', group: 'plan' },
  { key: 'outline', icon: 'grid', label: '大纲', group: 'plan' },
  { key: 'timeline', icon: 'clock', label: '时间线', group: 'plan' },
  { key: 'map', icon: 'mappin', label: '地图', group: 'plan' },
  { key: 'brainstorm', icon: 'bulb', label: '风暴', group: 'plan' },
  { key: 'variables', icon: 'braces', label: '变量', group: 'logic' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('flow');
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [history, setHistory] = useState(false);
  const [palettes, setPalettes] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [aiAssistant, setAiAssistant] = useState(false);
  const [findReplace, setFindReplace] = useState(false);
  const [engineExport, setEngineExport] = useState(false);
  const [aiExtract, setAiExtract] = useState(false);
  const [projectImport, setProjectImport] = useState(false);
  const [importFile, setImportFile] = useState<{ mode: 'xlsx' | 'fdx'; file: File } | null>(null);
  const importXlsxRef = useRef<HTMLInputElement>(null);
  const importFdxRef = useRef<HTMLInputElement>(null);
  const [recovering, setRecovering] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateDialog, setUpdateDialog] = useState<UpdateDialogState | null>(null);
  const checkingUpdateRef = useRef(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const navTarget = useNav((s) => s.target);
  const navSeq = useNav((s) => s.seq);

  // 搜索/反向引用跳转:切到目标模块,细节由模块自行消费
  useEffect(() => {
    if (navTarget) setTab(navTarget.tab);
  }, [navSeq]);

  // 恢复本机保存的分栏宽度(启动时一次)
  useEffect(() => { initPaneWidths(); }, []);
  const project = useLoom((s) => s.project);
  const folder = useLoom((s) => s.folder);
  const syncError = useLoom((s) => s.syncError);
  const saveStatus = useLoom((s) => s.saveStatus);
  const saveError = useLoom((s) => s.saveError);
  const recoveryNotice = useLoom((s) => s.recoveryNotice);
  const storageUsage = useLoom((s) => s.storageUsage);
  const setFolder = useLoom((s) => s.setFolder);
  const revision = useLoom((s) => s.revision);
  const canUndo = useLoom((s) => s.canUndo);
  const canRedo = useLoom((s) => s.canRedo);

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

  const runUpdateCheck = async (silent: boolean) => {
    if (!isTauri || checkingUpdateRef.current) return;
    checkingUpdateRef.current = true;
    setCheckingUpdate(true);
    try {
      const update = await findAvailableUpdate();
      if (!update) {
        if (!silent) setUpdateDialog({ kind: 'latest' });
        return;
      }
      if (!silent || shouldAutoPromptUpdate(update.version)) {
        setUpdateDialog({ kind: 'available', update });
      } else {
        await update.close().catch(() => undefined);
      }
    } catch (e) {
      console.warn('检查更新失败', e);
      if (!silent) setUpdateDialog({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      checkingUpdateRef.current = false;
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (!isTauri) return;
    const timer = window.setTimeout(() => { runUpdateCheck(true); }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  // Tauri 模式:启动时从上次的项目文件夹加载
  useEffect(() => {
    if (!isTauri || !folder) return;
    loadFromFolder(folder)
      .then((loaded) => {
        useLoom.getState().replaceProject(loaded.project);
        useLoom.getState().setRecoveryNotice(loaded.recoveredFromBackup
          ? '项目文件夹中的 project.json 无法读取，已从 project.json.bak 恢复。'
          : null);
      })
      .catch(async () => {
        await alertDialog(`无法读取项目文件夹:\n${folder}\n\n已切换为浏览器本地存储。`);
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
        if (!await confirmDialog({ message: `该文件夹已有项目数据,加载它并替换当前打开的项目?\n\n${dir}` })) return;
        const loaded = await loadFromFolder(dir);
        useLoom.getState().replaceProject(loaded.project);
        useLoom.getState().setRecoveryNotice(loaded.recoveredFromBackup
          ? '项目文件夹中的 project.json 无法读取，已从 project.json.bak 恢复。'
          : null);
      } else {
        if (!await confirmDialog({ message: `将当前项目「${project.name}」写入该文件夹?\n\n${dir}\n\n之后所有改动都会自动保存到这里。` })) return;
        await saveToFolder(dir, project);
        // 把浏览器 IndexedDB 里的资源原文件迁移落盘到 assets/,形成随文件夹走的闭环
        const moved = await exportBlobsToFolder(project, dir);
        if (moved.missing > 0) {
          await alertDialog(`已落盘 ${moved.written} 个资源原文件;${moved.missing} 个在浏览器存储中缺失,可稍后在资源模块「重新定位」。`);
        }
      }
      setSavedFolder(dir);
      setFolder(dir);
    } catch (e) {
      await alertDialog(`操作失败:${e}`);
    }
  };

  const reloadFolder = async () => {
    if (!folder) return;
    try {
      const loaded = await loadFromFolder(folder);
      useLoom.getState().replaceProject(loaded.project);
      useLoom.getState().setRecoveryNotice(loaded.recoveredFromBackup
        ? '项目文件夹中的 project.json 无法读取，已从 project.json.bak 恢复。'
        : null);
    } catch (e) {
      await alertDialog(`重新加载失败:${e}`);
    }
  };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="logo" title="叙事织机 TheLoom"><img src="/logo.svg" alt="TheLoom" width={26} height={26} /></div>
        {TABS.map((t, i) => {
          const prev = i > 0 ? TABS[i - 1].group : null;
          const showSep = prev !== null && prev !== t.group;
          return (
            <div key={t.key} style={{ display: 'contents' }}>
              {showSep && <div className="nav-sep" title={GROUP_LABEL[t.group]}><span>{GROUP_LABEL[t.group]}</span></div>}
              <button
                className={`nav-btn ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
                title={t.label}
              >
                <Icon name={t.icon} size={18} />
                <span>{t.label}</span>
              </button>
            </div>
          );
        })}
      </nav>

      <div className="main">
        <header className="topbar">
          <ProjectMenu />
          <button className="ghost" title="全局搜索 (Ctrl+K)" onClick={() => setSearching(true)}><Icon name="search" /> 搜索</button>
          <button
            className={`ghost ${aiAssistant ? 'active' : ''}`}
            title="打开只读 AI 助手"
            onClick={() => setAiAssistant((open) => !open)}
          >
            <Icon name="bulb" size={14} /> 助手
          </button>
          <button className="ghost icon-btn" disabled={!canUndo} title="撤销 (Ctrl+Z)" onClick={() => useLoom.getState().undo()}><Icon name="undo" /></button>
          <button className="ghost icon-btn" disabled={!canRedo} title="重做 (Ctrl+Y)" onClick={() => useLoom.getState().redo()}><Icon name="redo" /></button>
          <span className="spacer" />
          {recoveryNotice ? (
            <button className="ghost saved-hint recovery-status" onClick={() => setRecovering(true)} title={recoveryNotice}>⚠ 恢复提醒</button>
          ) : saveStatus === 'error' ? (
            <button className="ghost saved-hint" style={{ color: 'var(--danger)' }} onClick={() => setRecovering(true)} title={saveError ?? undefined}>⚠ 保存失败</button>
          ) : saveError ? (
            <button className="ghost saved-hint" style={{ color: 'var(--danger)' }} onClick={() => setRecovering(true)} title={saveError}>⚠ 备份失败</button>
          ) : syncError ? (
            <span className="saved-hint" style={{ color: 'var(--danger)' }} title={syncError}>⚠ 同步失败</span>
          ) : saveStatus === 'saving' ? (
            <span className="saved-hint">正在保存…</span>
          ) : !folder && storageUsage.available && storageUsage.bytes >= LOCAL_STORAGE_WARNING_BYTES ? (
            <button
              className="ghost saved-hint"
              style={{ color: 'var(--danger)' }}
              onClick={() => setRecovering(true)}
              title={`本地数据约 ${(storageUsage.bytes / 1024 / 1024).toFixed(1)} MB，建议检查备份和大尺寸资源`}
            >⚠ 本地空间偏高</button>
          ) : (
            <span className="saved-hint" title={folder ?? undefined}>
              {folder ? `已同步 · ${folder.split(/[\\/]/).pop()}` : '已自动保存到本地'}
            </span>
          )}
          <ThemeToggle />
          <button
            className="ghost saved-hint"
            style={{ padding: '2px 6px' }}
            title={isTauri ? '点击检查更新' : '网页版随部署自动更新'}
            disabled={checkingUpdate}
            onClick={() => { if (isTauri) runUpdateCheck(false); }}
          >
            {checkingUpdate ? '检查中…' : `v${__APP_VERSION__}`}
          </button>
          <div className="tools-wrap">
            <button className="ghost" onClick={() => setToolsOpen((o) => !o)} title="工具:文件 / 体检 / 历史 / 协作 / 导出">
              <Icon name="script" size={14} /> 工具 ▾
            </button>
            {toolsOpen && (
              <>
                <div className="backdrop" onClick={() => setToolsOpen(false)} />
                <div className="tools-menu">
                  {!isTauri && (
                    <>
                      <button
                        title="下载 Windows 安装包(自动跳转最新版本,大陆网络可直连);桌面版支持绑定本地文件夹与 Obsidian 互通"
                        onClick={() => { setToolsOpen(false); window.open('/api/download/latest', '_blank'); }}
                      >
                        <Icon name="download" size={14} /> 下载桌面版(Windows)
                      </button>
                      <div className="tools-sep" />
                    </>
                  )}
                  {isTauri && (
                    <>
                      <button onClick={() => { setToolsOpen(false); chooseFolder(); }}>
                        <Icon name="folder" size={14} /> {folder ? '更换文件夹' : '项目文件夹'}
                      </button>
                      {folder && (
                        <button onClick={() => { setToolsOpen(false); reloadFolder(); }}>
                          <Icon name="refresh" size={14} /> 重新加载
                        </button>
                      )}
                      <div className="tools-sep" />
                    </>
                  )}
                  <button onClick={() => { setToolsOpen(false); setAuditing(true); }}>
                    <Icon name="script" size={14} /> 体检
                  </button>
                  <button onClick={() => { setToolsOpen(false); setQuerying(true); }}>
                    <Icon name="search" size={14} /> 组合查询
                  </button>
                  <button
                    title="在全部文档正文里查找并替换;替换是一步操作,可撤销"
                    onClick={() => { setToolsOpen(false); setFindReplace(true); }}
                  >
                    <Icon name="search" size={14} /> 查找替换
                  </button>
                  <button onClick={() => { setToolsOpen(false); setHistory(true); }}>
                    <Icon name="undo" size={14} /> 版本历史
                  </button>
                  <button onClick={() => { setToolsOpen(false); setRecovering(true); }}>
                    <Icon name="archive" size={14} /> 恢复与备份
                  </button>
                  <button onClick={() => { setToolsOpen(false); setPalettes(true); }}>
                    <Icon name="palette" size={14} /> 配色表
                  </button>
                  <button onClick={() => { setToolsOpen(false); setSyncing(true); }}>
                    <Icon name="cloud" size={14} /> 协作
                  </button>
                  <div className="tools-sep" />
                  <div className="tools-label">AI</div>
                  <button
                    title="多份材料(正文/设定/笔记/AI记录)→ 生成计划 → 审阅 → 完整预检 → 事务式导入整个小说项目"
                    onClick={() => { setToolsOpen(false); setProjectImport(true); }}
                  >
                    <Icon name="archive" size={14} /> 完整项目导入(小说)
                  </button>
                  <button
                    title="粘贴长文或读入 md / txt,AI 抽取实体 / 场景 / 时间线,预检确认后写入"
                    onClick={() => { setToolsOpen(false); setAiExtract(true); }}
                  >
                    <Icon name="bulb" size={14} /> AI 抽取(长文 → 骨架)
                  </button>
                  <button
                    title="配置 LLM 服务:OpenAI 兼容 / Anthropic / Ollama 本地;Key 只存本机"
                    onClick={() => { setToolsOpen(false); setAiSettings(true); }}
                  >
                    <Icon name="braces" size={14} /> AI 设置
                  </button>
                  <div className="tools-sep" />
                  <div className="tools-label">导出</div>
                  <button onClick={() => { setToolsOpen(false); exportProject(project); }}>
                    JSON 完整备份
                  </button>
                  <button
                    title="带版本 JSON Schema 的引擎包(zip):数据 + 索引 + 类型定义;配合独立运行库在任何 JS 环境演出"
                    onClick={() => { setToolsOpen(false); setEngineExport(true); }}
                  >
                    <Icon name="braces" size={14} /> 引擎包 .zip(游戏引擎)
                  </button>
                  <button onClick={() => { setToolsOpen(false); downloadCsv(`${project.name}-实体表.csv`, entitiesToCsv(project)); }}>
                    实体表 CSV
                  </button>
                  <button onClick={() => { setToolsOpen(false); downloadCsv(`${project.name}-资源表.csv`, assetsToCsv(project)); }}>
                    资源表 CSV
                  </button>
                  <button onClick={() => { setToolsOpen(false); downloadCsv(`${project.name}-大纲表.csv`, outlineToCsv(project)); }}>
                    大纲表 CSV
                  </button>
                  <button onClick={async () => {
                    setToolsOpen(false);
                    const blob = await projectToXlsx(project);
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${project.name || 'theloom'}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}>
                    Excel 工作簿 .xlsx
                  </button>
                  <button onClick={() => {
                    setToolsOpen(false);
                    // 全流程 + 全文档合并为一份 fdx
                    const allParas = [
                      ...project.flows.flatMap((f) => flowToParagraphs(f, project.entities)),
                      ...project.documents.flatMap((d) => documentToParagraphs(d, project.entities)),
                    ];
                    const xml = paragraphsToFdx(allParas, project.name);
                    const blob = new Blob([xml], { type: 'application/xml' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${project.name || 'theloom'}.fdx`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}>
                    Final Draft .fdx
                  </button>
                  <div className="tools-sep" />
                  <div className="tools-label">导入</div>
                  <button onClick={() => { setToolsOpen(false); importXlsxRef.current?.click(); }}>
                    <Icon name="upload" size={12} /> Excel .xlsx(带预检)
                  </button>
                  <button onClick={() => { setToolsOpen(false); importFdxRef.current?.click(); }}>
                    <Icon name="upload" size={12} /> Final Draft .fdx(带预检)
                  </button>
                  <input
                    ref={importXlsxRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setImportFile({ mode: 'xlsx', file: f });
                      e.currentTarget.value = '';
                    }}
                  />
                  <input
                    ref={importFdxRef}
                    type="file"
                    accept=".fdx,application/xml,text/xml"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setImportFile({ mode: 'fdx', file: f });
                      e.currentTarget.value = '';
                    }}
                  />
                  <div className="tools-sep" />
                  <div className="tools-label">外部工具</div>
                  <a
                    className="tools-link"
                    href="https://70015.net"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setToolsOpen(false)}
                    title="70015 · 浏览器内运行的通用小工具集(图片压缩、格式转换、二维码等)"
                  >
                    <Icon name="archive" size={14} /> 70015 工具集 ↗
                    <span className="tools-hint">图片/文件/编码 通用小工具</span>
                  </a>
                  <a
                    className="tools-link"
                    href="https://70015.net/palette"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setToolsOpen(false)}
                    title="从图片提取主色 → 导出 JSON → 在「配色表」里导入,即可用作项目色板"
                  >
                    <Icon name="palette" size={14} /> Color Palette ↗
                    <span className="tools-hint">图片提色 → 导入到配色表</span>
                  </a>
                </div>
              </>
            )}
          </div>
        </header>

        <div className="content" key={revision}>
          <Suspense fallback={<div className="empty-hint" style={{ margin: 'auto' }}>加载中…</div>}>
            {tab === 'flow' && <FlowEditor />}
            {tab === 'entities' && <EntityLibrary />}
            {tab === 'assets' && <Assets />}
            {tab === 'documents' && <DocumentView />}
            {tab === 'brainstorm' && <Brainstorm />}
            {tab === 'outline' && <OutlineGrid />}
            {tab === 'timeline' && <Timeline />}
            {tab === 'map' && <MapEditor />}
            {tab === 'research' && <ResearchCards />}
            {tab === 'variables' && <Variables />}
            {tab === 'planning' && <Planning />}
          </Suspense>
        </div>
      </div>

      {searching && <SearchPalette onClose={() => setSearching(false)} />}
      {syncing && <SyncPanel onClose={() => setSyncing(false)} />}
      {auditing && <AuditPanel onClose={() => setAuditing(false)} />}
      {querying && <QueryPanel onClose={() => setQuerying(false)} />}
      {history && <VersionHistory onClose={() => setHistory(false)} />}
      {palettes && <PaletteManager onClose={() => setPalettes(false)} />}
      {aiSettings && <AiSettingsModal onClose={() => setAiSettings(false)} />}
      {aiExtract && <AiExtractModal onClose={() => setAiExtract(false)} />}
      {projectImport && <ProjectImportWizard onClose={() => setProjectImport(false)} />}
      {findReplace && <FindReplace onClose={() => setFindReplace(false)} />}
      {engineExport && <EngineExportModal onClose={() => setEngineExport(false)} />}
      {importFile && (
        <ImportPreview mode={importFile.mode} file={importFile.file} onClose={() => setImportFile(null)} />
      )}
      {recovering && <RecoveryPanel onClose={() => setRecovering(false)} />}
      {updateDialog && <UpdateDialog state={updateDialog} onClose={() => setUpdateDialog(null)} />}
      {aiAssistant && (
        <Suspense fallback={null}>
          <AiAssistantPanel
            currentTab={tab}
            onClose={() => setAiAssistant(false)}
            onOpenSettings={() => setAiSettings(true)}
          />
        </Suspense>
      )}
      <DialogHost />
    </div>
  );
}
