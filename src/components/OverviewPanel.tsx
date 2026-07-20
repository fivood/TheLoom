import { useMemo, useState } from 'react';
import { useLoom } from '../store';
import { useNav, type NavTab } from '../search';
import Icon from './Icon';
import type { Folder, FolderModule, Project } from '../types';

/**
 * R14-2 跨模块项目总览面板:一屏看全 5 个模块的文件夹树与对象计数,
 * 点击任一对象直接跳转(切 tab + 选中)。用于全项目导览,
 * 与 Ctrl+K 关键词搜索互补(搜索是"我知道要找",总览是"看看有什么")。
 */

interface ObjectLite { id: string; name: string; folderId?: string }

const MODULE_LABEL: Record<FolderModule, string> = {
  flow: '流程', document: '文档', entity: '实体', asset: '资源', research: '资料',
};
const MODULE_TO_TAB: Record<FolderModule, NavTab> = {
  flow: 'flow', document: 'documents', entity: 'entities', asset: 'assets', research: 'research',
};
const MODULE_ICON: Record<FolderModule, 'flow' | 'doc' | 'entity' | 'image' | 'archive'> = {
  flow: 'flow', document: 'doc', entity: 'entity', asset: 'image', research: 'archive',
};

/** 每种模块的对象取名(不同模块字段不同) */
function collectObjects(project: Project, module: FolderModule): ObjectLite[] {
  if (module === 'flow') return project.flows.map((f) => ({ id: f.id, name: f.name, folderId: f.folderId }));
  if (module === 'document') return project.documents.map((d) => ({ id: d.id, name: d.name, folderId: d.folderId }));
  if (module === 'entity') return project.entities.map((e) => ({ id: e.id, name: e.name, folderId: e.folderId }));
  if (module === 'asset') return project.assets.map((a) => ({ id: a.id, name: a.name, folderId: a.folderId }));
  return project.researchCards.map((c) => ({ id: c.id, name: c.title, folderId: c.folderId }));
}

/** 生成模块 → { rootFolders, byParent, objectsByFolder } 的索引 */
function buildTree(folders: Folder[], objects: ObjectLite[]) {
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(f);
    byParent.set(key, arr);
  }
  for (const [, arr] of byParent) arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const objectsByFolder = new Map<string | null, ObjectLite[]>();
  for (const o of objects) {
    const key = o.folderId ?? null;
    const arr = objectsByFolder.get(key) ?? [];
    arr.push(o);
    objectsByFolder.set(key, arr);
  }
  for (const [, arr] of objectsByFolder) arr.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return { byParent, objectsByFolder };
}

const OBJECT_NAV_KEY: Record<FolderModule, 'flowId' | 'docId' | 'entityId' | 'assetId' | 'cardId'> = {
  flow: 'flowId', document: 'docId', entity: 'entityId', asset: 'assetId', research: 'cardId',
};

export default function OverviewPanel({ onClose }: { onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const go = useNav((s) => s.go);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const modules = useMemo(() => (['flow', 'document', 'entity', 'asset', 'research'] as FolderModule[]).map((m) => {
    const folders = project.folders.filter((f) => f.module === m);
    const objects = collectObjects(project, m);
    return { module: m, folders, objects, tree: buildTree(folders, objects) };
  }), [project]);

  const toggle = (key: string) => setCollapsed((s) => {
    const next = new Set(s);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const openObject = (module: FolderModule, id: string) => {
    onClose();
    go({ tab: MODULE_TO_TAB[module], [OBJECT_NAV_KEY[module]]: id } as Parameters<typeof go>[0]);
  };

  const matches = (name: string) => !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase());

  /** 折叠树中递归统计匹配对象数(过滤空文件夹) */
  const countMatches = (module: FolderModule, folderId: string | null, tree: ReturnType<typeof buildTree>): number => {
    const own = (tree.objectsByFolder.get(folderId) ?? []).filter((o) => matches(o.name)).length;
    const kids = (tree.byParent.get(folderId) ?? []).reduce((n, c) => n + countMatches(module, c.id, tree), 0);
    return own + kids;
  };

  const renderFolder = (module: FolderModule, folder: Folder | null, tree: ReturnType<typeof buildTree>): React.ReactNode => {
    const key = `${module}:${folder?.id ?? 'root'}`;
    const children = tree.byParent.get(folder?.id ?? null) ?? [];
    const objects = (tree.objectsByFolder.get(folder?.id ?? null) ?? []).filter((o) => matches(o.name));
    // 查询过滤:该文件夹自身与后代都没命中就不渲染
    if (query && folder && countMatches(module, folder.id, tree) === 0) return null;
    const isCollapsed = folder && collapsed.has(key);
    return (
      <div key={key} style={{ marginLeft: folder ? 14 : 0 }}>
        {folder && (
          <div className="overview-folder" onClick={() => toggle(key)}>
            <span className="overview-caret">{isCollapsed ? '▸' : '▾'}</span>
            <Icon name="folder" size={12} />
            <span className="overview-folder-name">{folder.name}</span>
            <span className="overview-count">{countMatches(module, folder.id, tree)}</span>
          </div>
        )}
        {!isCollapsed && (
          <>
            {objects.map((o) => (
              <div key={`${module}:${o.id}`} className="overview-item" onClick={() => openObject(module, o.id)}>
                {o.name || <span className="hint">(未命名)</span>}
              </div>
            ))}
            {children.map((c) => renderFolder(module, c, tree))}
          </>
        )}
      </div>
    );
  };

  const totalObjects = modules.reduce((n, m) => n + m.objects.length, 0);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette overview-panel" onClick={(e) => e.stopPropagation()}>
        <div className="overview-head">
          <Icon name="grid" size={14} />
          <span>项目总览 · {project.name || '未命名项目'} · {totalObjects} 个对象</span>
          <span className="spacer" />
          <input
            className="overview-search"
            placeholder="按名称过滤…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="overview-body">
          {modules.map((m) => {
            const shown = renderFolder(m.module, null, m.tree);
            const hasContent = m.objects.some((o) => matches(o.name));
            if (query && !hasContent) return null;
            return (
              <div key={m.module} className="overview-module">
                <div className="overview-module-head">
                  <Icon name={MODULE_ICON[m.module]} size={14} />
                  <b>{MODULE_LABEL[m.module]}</b>
                  <span className="overview-count">{m.objects.length}</span>
                </div>
                {m.objects.length === 0
                  ? <div className="hint" style={{ padding: '4px 8px', fontSize: 12 }}>还没有{MODULE_LABEL[m.module]}</div>
                  : shown}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
