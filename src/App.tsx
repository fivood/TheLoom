import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { exportProject, hydrateFromIdb, useLoom } from './store';
import { useAiPanelBus } from './ai/panelBus';
import { useToolBus } from './toolBus';
import Onboarding, { ONBOARDING_KEY, markOnboarded } from './components/Onboarding';
import OverviewPanel from './components/OverviewPanel';
import StorageManager from './components/StorageManager';
import HelpPanel from './components/HelpPanel';
import {
  folderHasProject, isTauri, loadFromFolder, pickFolder, saveToFolder,
} from './storage';
import { describeNavTarget, useNav } from './search';
import { confirmDialog, alertDialog } from './dialog';
import { useEscape } from './hooks/useEscape';
import { findAvailableUpdate, shouldAutoPromptUpdate } from './updater';
import { LOCAL_STORAGE_WARNING_BYTES } from './diagnostics';
import SearchPalette from './components/SearchPalette';
import RemotePanel from './components/RemotePanel';
import { redirectPending as oneDriveRedirectPending } from './remote/onedrive';
import { startAutoSync } from './remote/autoSync';
import { setupDesktopWindow } from './desktopWindow';
import AuditPanel from './components/AuditPanel';
import VersionHistory from './components/VersionHistory';
import PaletteManager from './components/PaletteManager';
import TemplateManager from './components/TemplateManager';
import ChapterCompileDialog from './components/ChapterCompileDialog';
import PaneHandle, { initPaneWidths } from './components/PaneHandle';
import ThemeToggle from './components/ThemeToggle';
import SyncButton from './components/SyncButton';
import { AiExtractModal, AiSettingsModal } from './components/AiPanel';
import ProjectMenu from './components/ProjectMenu';
import UpdateDialog, { type UpdateDialogState } from './components/UpdateDialog';
import RecoveryPanel from './components/RecoveryPanel';
import PwaBanner from './components/PwaBanner';
import DialogHost from './components/Dialog';
import ToastHost from './components/ToastHost';
import ImportPreview from './components/ImportPreview';
import FindReplace from './components/FindReplace';
import EngineExportModal from './components/EngineExportModal';
import FdxExportDialog from './components/FdxExportDialog';
import QueryPanel from './components/QueryPanel';
import Icon, { type IconName } from './components/Icon';
import { useIsMobile } from './mobile/useIsMobile';
import MobileShell from './mobile/MobileShell';
import { hasStages, presetHomeTab, primaryTabsFor, workspacePrimaryTabs, workspaceTabLabel, type WorkspaceTab } from './workspace';
import { STAGE_HINT, STAGE_LABEL, useStage, type WritingStage } from './stage';

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

export type Tab = WorkspaceTab;
/** 一次待预检的导入任务(拖入多文件时排队) */
interface ImportJob { mode: 'fdx' | 'manuscript'; file: File }

type TabGroup = 'build' | 'library' | 'plan' | 'logic';

const GROUP_LABEL: Record<TabGroup, string> = {
  build: '构建', library: '素材', plan: '构思', logic: '逻辑',
};

const TABS: { key: Tab; icon: IconName; label: string; group: TabGroup }[] = [
  { key: 'flow', icon: 'flow', label: '流程', group: 'build' },
  { key: 'documents', icon: 'doc', label: '文档', group: 'build' },
  { key: 'entities', icon: 'cards', label: '实体', group: 'library' },
  { key: 'assets', icon: 'image', label: '资源', group: 'library' },
  { key: 'research', icon: 'archive', label: '资料', group: 'library' },
  { key: 'planning', icon: 'flag', label: '规划', group: 'plan' },
  { key: 'outline', icon: 'grid', label: '大纲', group: 'plan' },
  { key: 'timeline', icon: 'clock', label: '时间线', group: 'plan' },
  { key: 'map', icon: 'mappin', label: '地图', group: 'plan' },
  { key: 'brainstorm', icon: 'bulb', label: '风暴', group: 'plan' },
  { key: 'variables', icon: 'braces', label: '变量', group: 'logic' },
];

const TAB_MEMORY_KEY = 'theloom-last-tab';
const VALID_TABS: Tab[] = ['flow', 'documents', 'entities', 'assets', 'research', 'planning', 'outline', 'timeline', 'map', 'brainstorm', 'variables'];

function renderTabContent(tab: Tab): React.ReactNode {
  switch (tab) {
    case 'flow': return <FlowEditor />;
    case 'entities': return <EntityLibrary />;
    case 'assets': return <Assets />;
    case 'documents': return <DocumentView />;
    case 'brainstorm': return <Brainstorm />;
    case 'outline': return <OutlineGrid />;
    case 'timeline': return <Timeline />;
    case 'map': return <MapEditor />;
    case 'research': return <ResearchCards />;
    case 'variables': return <Variables />;
    case 'planning': return <Planning />;
  }
}

export default function App() {
  // 记住上次停留的模块;首次使用默认落在「文档」(写作是最常见的起点)
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem(TAB_MEMORY_KEY) as Tab | null;
      if (saved && VALID_TABS.includes(saved)) return saved;
    } catch { /* 忽略 */ }
    // 首次进入:落点按预设决定(见 presetHomeTab),之后一律记住上次停留的模块
    return presetHomeTab(useLoom.getState().project.workspacePreset ?? 'universal');
  });
  useEffect(() => {
    try { localStorage.setItem(TAB_MEMORY_KEY, tab); } catch { /* 忽略 */ }
  }, [tab]);
  const [searching, setSearching] = useState(false);
  // OneDrive 登录跳回来时直接开面板,授权码由面板消费
  const [remoteSync, setRemoteSync] = useState(oneDriveRedirectPending);
  const [auditing, setAuditing] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [history, setHistory] = useState(false);
  const [palettes, setPalettes] = useState(false);
  const [templateManager, setTemplateManager] = useState(false);
  const [chapterCompile, setChapterCompile] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [aiAssistant, setAiAssistant] = useState(false);
  const aiPanelRequest = useAiPanelBus((s) => s.request);
  useEffect(() => {
    if (aiPanelRequest) setAiAssistant(true);
  }, [aiPanelRequest]);
  const toolRequest = useToolBus((s) => s.request);
  useEffect(() => {
    if (!toolRequest) return;
    const kind = toolRequest.kind;
    useToolBus.getState().consume();
    if (kind === 'chapterCompile') setChapterCompile(true);
    else if (kind === 'manuscriptImport') importManuscriptRef.current?.click();
    else if (kind === 'remoteSync') setRemoteSync(true);
    else if (kind === 'findReplace') setFindReplace(true);
    else if (kind === 'fdxExport') setFdxExport(true);
  }, [toolRequest]);
  useEffect(() => startAutoSync(), []);
  // 桌面窗口:恢复上次尺寸,首次按屏幕比例
  useEffect(() => { void setupDesktopWindow(); }, []);
  const [findReplace, setFindReplace] = useState(false);
  const [engineExport, setEngineExport] = useState(false);
  const [fdxExport, setFdxExport] = useState(false);
  const [aiExtract, setAiExtract] = useState(false);
  // 导入队列:一次拖入多个文件时逐个走预检,关掉当前预检自动推进到下一个
  const [importQueue, setImportQueue] = useState<ImportJob[]>([]);
  const importFile = importQueue[0] ?? null;
  const setImportFile = (job: ImportJob | null) => setImportQueue(job ? [job] : []);
  const importManuscriptRef = useRef<HTMLInputElement>(null);
  const importFdxRef = useRef<HTMLInputElement>(null);
  const [recovering, setRecovering] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateDialog, setUpdateDialog] = useState<UpdateDialogState | null>(null);
  const checkingUpdateRef = useRef(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  useEscape(toolsOpen, () => setToolsOpen(false));
  useEscape(recentOpen, () => setRecentOpen(false));
  const [onboarding, setOnboarding] = useState(false);
  const [overview, setOverview] = useState(false);
  // 侧栏有 overflow-x: hidden,菜单必须 fixed 定位才不会被裁掉;坐标打开时从按钮实测
  const [logoMenu, setLogoMenu] = useState<{ top: number; left: number } | null>(null);
  useEscape(!!logoMenu, () => setLogoMenu(null));
  // 手机 / 小平板一律走移动壳:桌面三栏布局在这些尺寸上无法使用(判定见 useIsMobile)
  const isMobile = useIsMobile();
  const mobileShell = isMobile && !isTauri;
  const [storageMgr, setStorageMgr] = useState(false);
  const [help, setHelp] = useState(false);
  // R14-3 分屏:副 pane 打开时,值为当前副 pane 的模块 tab;null = 单栏
  const [secondaryTab, setSecondaryTab] = useState<Tab | null>(null);
  // 拖拽长稿文件到窗口时显示导入遮罩
  const [dragOver, setDragOver] = useState(false);
  const navTarget = useNav((s) => s.target);
  const navSeq = useNav((s) => s.seq);
  const navBackCount = useNav((s) => s.backStack.length);
  const recentVisits = useNav((s) => s.recent);

  // 搜索/反向引用跳转:切到目标模块,细节由模块自行消费
  useEffect(() => {
    if (navTarget) {
      setTab(navTarget.tab);
      useNav.getState().setCurrentLabel(describeNavTarget(useLoom.getState().project, navTarget));
      if (Object.keys(navTarget).length === 1) useNav.getState().clear();
    }
  }, [navSeq]);

  useEffect(() => {
    const navigation = useNav.getState();
    if (!navigation.current) navigation.visit({ tab }, describeNavTarget(useLoom.getState().project, { tab }));
  }, []);

  // 恢复本机保存的分栏宽度(启动时一次)
  useEffect(() => { initPaneWidths(); }, []);

  // 未保存离开警告:防抖持久化窗口内直接关标签会丢改动 —— beforeunload 提示
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useLoom.getState();
      if (s.saveStatus === 'saving' || s.saveStatus === 'error') {
        e.preventDefault();
        // 现代浏览器忽略自定义文案,只看是否 preventDefault;returnValue 兼容老浏览器
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // 首启新手引导:未标记 + 项目实际为空(无文档 / 实体 / 流程节点)才弹
  useEffect(() => {
    let done = false;
    try { done = !!localStorage.getItem(ONBOARDING_KEY); } catch { /* 忽略 */ }
    if (done) return;
    const p = useLoom.getState().project;
    const empty = p.documents.length === 0 && p.entities.length === 0
      && p.flows.every((f) => f.nodes.length === 0);
    if (empty) setOnboarding(true);
  }, []);
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
  const workspacePreset = project.workspacePreset ?? 'universal';
  const stage = useStage((s) => s.stage);
  const setStage = useStage((s) => s.setStage);
  const primaryTabKeys = workspacePrimaryTabs(workspacePreset, stage);
  const primaryTabs = primaryTabsFor(workspacePreset, stage)
    .map((key) => TABS.find((item) => item.key === key)!)
    .filter(Boolean);
  const otherTabs = TABS.filter((item) => !primaryTabKeys.has(item.key));

  // 全局撤销/重做快捷键;焦点在输入框时交给浏览器原生文本撤销
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); setHelp(true); return; }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'k' && e.shiftKey) { e.preventDefault(); setOverview(true); return; }
      if (k === 'k') { e.preventDefault(); setSearching(true); return; }
      if (e.key === '\\') {
        e.preventDefault();
        setSecondaryTab((cur) => cur ? null : (tabRef.current === 'documents' ? 'flow' : 'documents'));
        return;
      }
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
        setFolder(null);
      });
    // 仅启动时执行一次
  }, []);

  // P2 网页版:启动后异步从 IndexedDB 恢复较新的数据(镜像回 localStorage 并补丁 store)
  useEffect(() => {
    if (isTauri) return;
    void hydrateFromIdb();
  }, []);

  // 拖拽文件到窗口:按扩展名路由到长稿 / Final Draft 导入预检
  useEffect(() => {
    const MANUSCRIPT_EXT = /\.(md|markdown|txt|epub|docx)$/i;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types?.includes('Files') ?? false;
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget == null) setDragOver(false);
    };
    const routeFile = (file: File): ImportJob | null => {
      if (MANUSCRIPT_EXT.test(file.name)) return { mode: 'manuscript', file };
            if (/\.fdx$/i.test(file.name)) return { mode: 'fdx', file };
      return null;
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      // 拖入多个文件时全部排队,逐个走预检 —— 只取第一个会静默丢掉其余的
      const jobs = files.map(routeFile).filter((j): j is ImportJob => j !== null);
      const rejected = files.filter((f) => routeFile(f) === null).map((f) => f.name);
      if (jobs.length > 0) setImportQueue((q) => [...q, ...jobs]);
      if (rejected.length > 0) {
        void alertDialog(
          `${rejected.length === 1 ? `无法识别该文件类型:${rejected[0]}` : `有 ${rejected.length} 个文件无法识别:\n${rejected.map((n) => `· ${n}`).join('\n')}`}`
          + `\n\n可拖入 TXT / Markdown / EPUB / DOCX 长稿、Final Draft .fdx。`
          + (jobs.length > 0 ? `\n\n其余 ${jobs.length} 个文件已排队导入。` : ''),
        );
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // P3 离线状态:监听在线/离线;恢复联网时自动补发「待推送」队列里积压的版本

  return (
    <div className={`app ${mobileShell ? 'app-mobile' : ''}`}>
      {mobileShell ? <MobileShell key={revision} /> : (
        <>
          <nav className="sidebar">
        <div className="logo-wrap">
          <button
            className={`logo ${logoMenu ? 'active' : ''}`}
            title="叙事织机 TheLoom · 总览 / 指南 / 版本"
            aria-label="应用菜单"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setLogoMenu((open) => open ? null : { top: r.top, left: r.right + 6 });
            }}
          >
            <img src="/logo.svg" alt="TheLoom" width={26} height={26} />
          </button>
          {logoMenu && (
            <>
              <div className="backdrop" onClick={() => setLogoMenu(null)} />
              <div className="tools-menu logo-menu" style={{ top: logoMenu.top, left: logoMenu.left }}>
                <button onClick={() => { setLogoMenu(null); setOverview(true); }}>
                  <Icon name="grid" size={14} /> 项目总览 <span className="menu-key">Ctrl+Shift+K</span>
                </button>
                <button onClick={() => { setLogoMenu(null); setSearching(true); }}>
                  <Icon name="search" size={14} /> 全局搜索 <span className="menu-key">Ctrl+K</span>
                </button>
                <button onClick={() => { setLogoMenu(null); setHelp(true); }}>
                  <Icon name="help" size={14} /> 使用指南 <span className="menu-key">F1</span>
                </button>
                {isTauri && (
                  <button
                    disabled={checkingUpdate}
                    onClick={() => { setLogoMenu(null); runUpdateCheck(false); }}
                  >
                    <Icon name="refresh" size={14} /> {checkingUpdate ? '检查中…' : '检查更新'}
                  </button>
                )}
                <span className="hint" style={{ padding: '4px 12px 2px' }}>v{__APP_VERSION__} · {isTauri ? '桌面版' : '网页版'}</span>
              </div>
            </>
          )}
        </div>
        {primaryTabs.map((t, i) => {
          const prev = i > 0 ? primaryTabs[i - 1].group : null;
          const showSep = workspacePreset === 'universal' && prev !== null && prev !== t.group;
          const label = workspaceTabLabel(workspacePreset, t.key);
          return (
            <div key={t.key} style={{ display: 'contents' }}>
              {showSep && <div className="nav-sep" title={GROUP_LABEL[t.group]}><span>{GROUP_LABEL[t.group]}</span></div>}
              <button
                className={`nav-btn ${tab === t.key ? 'active' : ''}`}
                onClick={() => {
                  useNav.getState().visit({ tab: t.key }, label);
                  setTab(t.key);
                }}
                title={label}
              >
                <Icon name={t.icon} size={18} />
                <span>{label}</span>
              </button>
            </div>
          );
        })}
        {otherTabs.length > 0 && <div className="nav-sep" title="其他模块"><span>其他</span></div>}
        {otherTabs.map((t) => {
          const label = workspaceTabLabel(workspacePreset, t.key);
          return (
            <button
              key={t.key}
              className={`nav-btn ${tab === t.key ? 'active' : ''}`}
              onClick={() => {
                useNav.getState().visit({ tab: t.key }, label);
                setTab(t.key);
              }}
              title={label}
            >
              <Icon name={t.icon} size={18} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="main">
        <header className="topbar">
          <ProjectMenu />
          {hasStages(workspacePreset) && (
            <div className="doc-mode-switch stage-switch mobile-hide">
              {(['write', 'revise', 'plan', 'codex'] as WritingStage[]).map((key) => (
                <button
                  key={key}
                  className={stage === key ? 'primary' : 'ghost'}
                  title={STAGE_HINT[key]}
                  onClick={() => setStage(key)}
                >{STAGE_LABEL[key]}</button>
              ))}
            </div>
          )}
          <button
            className="ghost icon-btn"
            title="撤销 (Ctrl+Z)"
            aria-label="撤销"
            disabled={!canUndo}
            onClick={() => useLoom.getState().undo()}
          ><Icon name="undo" /></button>
          <button
            className="ghost icon-btn"
            title="重做 (Ctrl+Y)"
            aria-label="重做"
            disabled={!canRedo}
            onClick={() => useLoom.getState().redo()}
          ><Icon name="redo" /></button>
          <button
            className="ghost icon-btn"
            title="返回上一个位置"
            aria-label="返回上一个位置"
            disabled={navBackCount === 0}
            onClick={() => useNav.getState().back()}
          ><Icon name="arrowLeft" /></button>
          <div className="nav-history-wrap">
            <button className={`ghost icon-btn mobile-hide ${recentOpen ? 'active' : ''}`} title="最近访问" aria-label="最近访问" onClick={() => setRecentOpen((open) => !open)}>
              <Icon name="clock" />
            </button>
            {recentOpen && (
              <>
                <div className="backdrop" onClick={() => setRecentOpen(false)} />
                <div className="nav-history-menu">
                  <div className="tools-label">最近访问</div>
                  {recentVisits.map((visit) => {
                    const liveLabel = describeNavTarget(project, visit.target);
                    return (
                    <button key={JSON.stringify(visit.target)} onClick={() => {
                      setRecentOpen(false);
                      useNav.getState().go(visit.target, liveLabel);
                    }}>
                      {liveLabel}
                    </button>
                    );
                  })}
                  {recentVisits.length === 0 && <span className="hint">还没有访问记录</span>}
                </div>
              </>
            )}
          </div>
          <button className="ghost icon-btn search-btn" title="全局搜索 (Ctrl+K)" aria-label="全局搜索 (Ctrl+K)" onClick={() => setSearching(true)}><Icon name="search" /> 搜索</button>
          <button
            className={`ghost icon-btn mobile-hide ${secondaryTab ? 'active' : ''}`}
            title="分屏:主副两个模块并列显示 (Ctrl+\)"
            aria-label="分屏"
            onClick={() => setSecondaryTab((cur) => cur ? null : (tab === 'documents' ? 'flow' : 'documents'))}
          ><Icon name="split" /> 分屏</button>
          <button
            className={`ghost icon-btn ${aiAssistant ? 'active' : ''}`}
            title="打开只读 AI 助手"
            aria-label="AI 助手"
            onClick={() => setAiAssistant((open) => !open)}
          >
            <Icon name="bulb" />
          </button>
          <span className="spacer" />
          {recoveryNotice ? (
            <button className="ghost saved-hint recovery-status" onClick={() => setRecovering(true)} title={recoveryNotice}><Icon name="warn" size={12} /> 恢复提醒</button>
          ) : saveStatus === 'error' ? (
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <button
                className="ghost saved-hint"
                style={{ color: 'var(--danger)' }}
                onClick={() => setRecovering(true)}
                title={saveError ?? undefined}
              ><Icon name="warn" size={12} /> 保存失败</button>
              <button
                className="primary"
                title="立即把当前内存里的项目 JSON 下载到本地(浏览器磁盘配额满 / IndexedDB 崩了时的抢救按钮)"
                onClick={() => exportProject(project)}
              >↓ 应急下载</button>
            </span>
          ) : saveError ? (
            <button className="ghost saved-hint" style={{ color: 'var(--danger)' }} onClick={() => setRecovering(true)} title={saveError}><Icon name="warn" size={12} /> 备份失败</button>
          ) : syncError ? (
            <span className="saved-hint" style={{ color: 'var(--danger)' }} title={syncError}><Icon name="warn" size={12} /> 同步失败</span>
          ) : saveStatus === 'saving' ? (
            <span className="saved-hint">正在保存…</span>
          ) : !folder && storageUsage.available && storageUsage.bytes >= LOCAL_STORAGE_WARNING_BYTES ? (
            <button
              className="ghost saved-hint"
              style={{ color: 'var(--danger)' }}
              onClick={() => setRecovering(true)}
              title={`本地数据约 ${(storageUsage.bytes / 1024 / 1024).toFixed(1)} MB，建议检查备份和大尺寸资源`}
            ><Icon name="warn" size={12} /> 本地空间偏高</button>
          ) : (
            <span className="saved-hint" title={folder ?? undefined}>
              {folder ? `已同步 · ${folder.split(/[\\/]/).pop()}` : '已自动保存到本地'}
            </span>
          )}
          <button
            className="ghost icon-btn"
            title="项目总览:一屏看全各模块 (Ctrl+Shift+K)"
            aria-label="项目总览"
            onClick={() => setOverview(true)}
          ><Icon name="grid" /></button>
          <SyncButton />
          <ThemeToggle />
          <div className="tools-wrap">
            <button className="ghost icon-btn" onClick={() => setToolsOpen((o) => !o)} title="工具:检查 / 项目数据 / 素材 / AI / 导入导出" aria-label="工具菜单">
              <Icon name="script" />
            </button>
            {toolsOpen && (
              <>
                <div className="backdrop" onClick={() => setToolsOpen(false)} />
                <div className="tools-menu tools-menu-main">
                  {!isTauri && (
                    <>
                      <div className="tools-label">桌面版</div>
                      <button
                        title="下载 Windows 安装包(自动跳转最新版本,大陆网络可直连);桌面版支持绑定本地文件夹与 Obsidian 互通"
                        onClick={() => { setToolsOpen(false); window.open('/api/download/latest', '_blank'); }}
                      >
                        <Icon name="download" size={14} /> 下载桌面版
                      </button>
                      <div className="tools-sep" />
                    </>
                  )}
                  <div className="tools-label">查找与检查</div>
                  <button onClick={() => { setToolsOpen(false); setAuditing(true); }}>
                    <Icon name="script" size={14} /> 体检
                  </button>
                  <button onClick={() => { setToolsOpen(false); setQuerying(true); }}>
                    <Icon name="grid" size={14} /> 组合查询
                  </button>
                  <button
                    title="在全部文档正文里查找并替换;替换是一步操作,可撤销"
                    onClick={() => { setToolsOpen(false); setFindReplace(true); }}
                  >
                    <Icon name="search" size={14} /> 查找替换
                  </button>
                  <div className="tools-sep" />
                  <div className="tools-label">项目数据</div>
                  <button onClick={() => { setToolsOpen(false); setHistory(true); }}>
                    <Icon name="undo" size={14} /> 版本历史
                  </button>
                  <button onClick={() => { setToolsOpen(false); setRecovering(true); }}>
                    <Icon name="refresh" size={14} /> 恢复与备份
                  </button>
                  <button
                    title="查看本机数据占用,备份或清除项目槽位与资源缓存"
                    onClick={() => { setToolsOpen(false); setStorageMgr(true); }}
                  >
                    <Icon name="trash" size={14} /> 存储管理
                  </button>
                  <button
                    title="同步到你自己的 S3 兼容存储(R2 / B2 / MinIO / OSS):端到端加密、无 20MB 上限、资源原文件一起走"
                    onClick={() => { setToolsOpen(false); setRemoteSync(true); }}
                  >
                    <Icon name="upload" size={14} /> 外链网盘同步
                  </button>
                  <div className="tools-sep" />
                  <div className="tools-label">素材与模板</div>
                  <button onClick={() => { setToolsOpen(false); setPalettes(true); }}>
                    <Icon name="palette" size={14} /> 配色表
                  </button>
                  <button onClick={() => { setToolsOpen(false); setTemplateManager(true); }}>
                    <Icon name="braces" size={14} /> 模板管理器
                  </button>
                  <div className="tools-sep" />
                  <div className="tools-label">AI</div>
                  <button
                    title="粘贴长文或读入 md / txt,AI 抽取实体 / 场景 / 时间线,预检确认后写入"
                    onClick={() => { setToolsOpen(false); setAiExtract(true); }}
                  >
                    <Icon name="bulb" size={14} /> AI 抽取
                  </button>
                  <button
                    title="配置 LLM 服务:OpenAI 兼容 / Anthropic / Ollama 本地;Key 只存本机"
                    onClick={() => { setToolsOpen(false); setAiSettings(true); }}
                  >
                    <Icon name="key" size={14} /> AI 设置
                  </button>
                  <div className="tools-sep" />
                  <div className="tools-label">导出</div>
                  <button onClick={() => { setToolsOpen(false); exportProject(project); }}>
                    <Icon name="download" size={14} /> JSON 备份
                  </button>
                  <button
                    title="带版本 JSON Schema 的引擎包(zip):数据 + 索引 + 类型定义;配合独立运行库在任何 JS 环境演出"
                    onClick={() => { setToolsOpen(false); setEngineExport(true); }}
                  >
                    <Icon name="braces" size={14} /> 引擎包 .zip
                  </button>
                  <button
                    title="勾选参与的流程与文档,合并导出为 Final Draft .fdx"
                    onClick={() => { setToolsOpen(false); setFdxExport(true); }}
                  >
                    <Icon name="doc" size={14} /> Final Draft .fdx
                  </button>
                  <button
                    onClick={() => { setToolsOpen(false); setChapterCompile(true); }}
                    title="按卷/章勾选文档，编译为 Word / Markdown / TXT / Final Draft 成品稿件"
                  >
                    <Icon name="script" size={14} /> 成稿导出 / 章节编译
                  </button>
                  <div className="tools-sep" />
                  <div className="tools-label">导入</div>
                  <button onClick={() => { setToolsOpen(false); importFdxRef.current?.click(); }}>
                    <Icon name="upload" size={14} /> Final Draft .fdx(带预检)
                  </button>
                  <button onClick={() => { setToolsOpen(false); importManuscriptRef.current?.click(); }}
                    title="TXT / Markdown / EPUB / DOCX 长稿:自动按 # 标题、「第X章」正则、EPUB spine 或 Word 标题样式拆卷 / 章 / 场景">
                    <Icon name="upload" size={14} /> 长稿导入
                  </button>
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
                  <input
                    ref={importManuscriptRef}
                    type="file"
                    accept=".md,.markdown,.txt,.epub,.docx,text/plain,text/markdown,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setImportFile({ mode: 'manuscript', file: f });
                      e.currentTarget.value = '';
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </header>

        <div className={`content ${secondaryTab ? 'content-split' : ''}`} key={revision}>
          <div className="content-pane content-pane-primary">
            <div className="pane-module">
              <Suspense fallback={<div className="empty-hint" style={{ margin: 'auto' }}>加载中…</div>}>
                {renderTabContent(tab)}
              </Suspense>
            </div>
            {secondaryTab && <PaneHandle varName="--pane-split" side="right" />}
          </div>
          {secondaryTab && (
            <div className="content-pane content-pane-secondary">
              <div className="pane-tabbar">
                <div className="pane-tabs">
                  {TABS.map((t) => {
                    const label = workspaceTabLabel(workspacePreset, t.key);
                    return (
                      <button
                        key={t.key}
                        className={`pane-tab ${secondaryTab === t.key ? 'active' : ''}`}
                        title={label}
                        onClick={() => setSecondaryTab(t.key)}
                      >
                        <Icon name={t.icon} size={15} /><span>{label}</span>
                      </button>
                    );
                  })}
                </div>
                <span className="spacer" />
                <button className="ghost icon-btn" title="关闭副面板" onClick={() => setSecondaryTab(null)}>×</button>
              </div>
              <div className="pane-inner">
                <div className="pane-module">
                  <Suspense fallback={<div className="empty-hint" style={{ margin: 'auto' }}>加载中…</div>}>
                    {renderTabContent(secondaryTab)}
                  </Suspense>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {searching && <SearchPalette onClose={() => setSearching(false)} />}
      {remoteSync && <RemotePanel onClose={() => setRemoteSync(false)} />}
      {auditing && <AuditPanel onClose={() => setAuditing(false)} />}
      {querying && <QueryPanel onClose={() => setQuerying(false)} />}
      {history && <VersionHistory onClose={() => setHistory(false)} />}
      {palettes && <PaletteManager onClose={() => setPalettes(false)} />}
      {templateManager && <TemplateManager onClose={() => setTemplateManager(false)} />}
      {chapterCompile && <ChapterCompileDialog onClose={() => setChapterCompile(false)} />}
      {aiSettings && <AiSettingsModal onClose={() => setAiSettings(false)} />}
      {aiExtract && <AiExtractModal onClose={() => setAiExtract(false)} />}
      {overview && <OverviewPanel onClose={() => setOverview(false)} />}
      {storageMgr && <StorageManager onClose={() => setStorageMgr(false)} />}
      {help && <HelpPanel onClose={() => setHelp(false)} />}
      {onboarding && !mobileShell && (
        <Onboarding
          onContinueBlank={() => { setTab(presetHomeTab(useLoom.getState().project.workspacePreset ?? 'universal')); }}
          onLoadSample={() => {
            useLoom.getState().loadSampleProject();
            setTab(presetHomeTab(useLoom.getState().project.workspacePreset ?? 'universal'));
          }}
          onClose={() => setOnboarding(false)}
        />
      )}
      {findReplace && <FindReplace onClose={() => setFindReplace(false)} />}
      {engineExport && <EngineExportModal onClose={() => setEngineExport(false)} />}
      {fdxExport && <FdxExportDialog onClose={() => setFdxExport(false)} />}
      {importFile && (
        <ImportPreview
          key={`${importQueue.length}-${importFile.file.name}`}
          mode={importFile.mode}
          file={importFile.file}
          onClose={() => setImportQueue((q) => q.slice(1))}
        />
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
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <Icon name="upload" size={28} />
            <div>松手导入稿件</div>
            <div className="drop-overlay-hint">TXT · Markdown · EPUB · DOCX · Final Draft</div>
          </div>
        </div>
      )}
      <PwaBanner />
      <DialogHost />
      <ToastHost />
    </div>
  );
}
