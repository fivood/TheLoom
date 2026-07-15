import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { uid, useLoom } from '../store';
import type { Folder, FolderModule } from '../types';

interface NavigatorItem {
  id: string;
  folderId?: string;
}

interface NavigatorTreeProps<T extends NavigatorItem> {
  module: FolderModule;
  title: string;
  items: T[];
  selectedId: string | null;
  getLabel: (item: T) => string;
  getDetail?: (item: T) => string | undefined;
  onSelect: (id: string) => void;
  onMove: (id: string, folderId: string | undefined) => void;
  onCreate?: () => void;
  createLabel?: string;
  emptyLabel?: string;
}

function flattenFolders(folders: Folder[]): { folder: Folder; depth: number }[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const parentId = folder.parentId ?? null;
    const list = byParent.get(parentId) ?? [];
    list.push(folder);
    byParent.set(parentId, list);
  }
  const rows: { folder: Folder; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number, trail: Set<string>) => {
    for (const folder of byParent.get(parentId) ?? []) {
      if (trail.has(folder.id)) continue;
      rows.push({ folder, depth });
      visit(folder.id, depth + 1, new Set(trail).add(folder.id));
    }
  };
  visit(null, 0, new Set());
  return rows;
}

export function FolderSelect({ module, value, onChange }: {
  module: FolderModule;
  value?: string;
  onChange: (folderId: string | undefined) => void;
}) {
  const allFolders = useLoom((s) => s.project.folders);
  const folders = useMemo(() => allFolders.filter((folder) => folder.module === module), [allFolders, module]);
  const rows = useMemo(() => flattenFolders(folders), [folders]);
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value || undefined)}>
      <option value="">未分组</option>
      {rows.map(({ folder, depth }) => (
        <option key={folder.id} value={folder.id}>{`${'　'.repeat(depth)}${folder.name}`}</option>
      ))}
    </select>
  );
}

export default function NavigatorTree<T extends NavigatorItem>({
  module, title, items, selectedId, getLabel, getDetail, onSelect, onMove,
  onCreate, createLabel = '新建', emptyLabel = '这里还没有内容',
}: NavigatorTreeProps<T>) {
  const allFolders = useLoom((s) => s.project.folders);
  const folders = useMemo(() => allFolders.filter((folder) => folder.module === module), [allFolders, module]);
  const { addFolder, updateFolder, removeFolder } = useLoom();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folders.map((folder) => folder.id)));

  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const foldersByParent = useMemo(() => {
    const result = new Map<string | null, Folder[]>();
    for (const folder of folders) {
      const parentId = folder.parentId ?? null;
      const list = result.get(parentId) ?? [];
      list.push(folder);
      result.set(parentId, list);
    }
    return result;
  }, [folders]);
  const itemsByFolder = useMemo(() => {
    const result = new Map<string | null, T[]>();
    for (const item of items) {
      const folderId = item.folderId && folderById.has(item.folderId) ? item.folderId : null;
      const list = result.get(folderId) ?? [];
      list.push(item);
      result.set(folderId, list);
    }
    return result;
  }, [items, folderById]);
  const folderRows = useMemo(() => flattenFolders(folders), [folders]);

  useEffect(() => {
    const selected = items.find((item) => item.id === selectedId);
    if (!selected?.folderId) return;
    const ancestors: string[] = [];
    let current = folderById.get(selected.folderId);
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      ancestors.push(current.id);
      current = current.parentId ? folderById.get(current.parentId) : undefined;
    }
    setExpanded((previous) => {
      if (ancestors.every((id) => previous.has(id))) return previous;
      const next = new Set(previous);
      for (const id of ancestors) next.add(id);
      return next;
    });
  }, [selectedId, items, folderById]);

  const toggleFolder = (id: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const createFolder = (parentId: string | null) => {
    const name = prompt(parentId ? '子文件夹名称' : '文件夹名称');
    if (!name?.trim()) return;
    const id = uid();
    addFolder({ id, name: name.trim(), module, parentId });
    setExpanded((previous) => new Set(previous).add(id).add(parentId ?? id));
  };
  const renameFolder = (folder: Folder) => {
    const name = prompt('文件夹名称', folder.name);
    if (name?.trim()) updateFolder(folder.id, { name: name.trim() });
  };
  const countItemsIn = (folderId: string, trail = new Set<string>()): number => {
    if (trail.has(folderId)) return 0;
    const nextTrail = new Set(trail).add(folderId);
    return (itemsByFolder.get(folderId)?.length ?? 0) +
      (foldersByParent.get(folderId) ?? []).reduce((sum, child) => sum + countItemsIn(child.id, nextTrail), 0);
  };

  const renderTree = (parentId: string | null, depth: number, trail: Set<string>): ReactNode => {
    const pad = 8 + depth * 14;
    return (
      <>
        {(foldersByParent.get(parentId) ?? []).map((folder) => {
          if (trail.has(folder.id)) return null;
          const open = expanded.has(folder.id);
          return (
            <div key={folder.id}>
              <div className="side-item folder-row navigator-folder-row" style={{ paddingLeft: pad }} onClick={() => toggleFolder(folder.id)}>
                <span className="caret">{open ? '▾' : '▸'}</span>
                <span className="navigator-label">{folder.name}</span>
                <span className="count">{countItemsIn(folder.id)}</span>
                <span className="navigator-folder-actions">
                  <button className="ghost icon-btn" title="新建子文件夹" onClick={(event) => { event.stopPropagation(); createFolder(folder.id); }}>＋</button>
                  <button className="ghost icon-btn" title="重命名文件夹" onClick={(event) => { event.stopPropagation(); renameFolder(folder); }}>✎</button>
                  <button
                    className="ghost icon-btn"
                    title="删除文件夹"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (confirm(`删除文件夹「${folder.name}」？其下子文件夹一并删除，内容归入未分组。`)) removeFolder(folder.id);
                    }}
                  >×</button>
                </span>
              </div>
              {open && renderTree(folder.id, depth + 1, new Set(trail).add(folder.id))}
            </div>
          );
        })}
        {(itemsByFolder.get(parentId) ?? []).map((item) => (
          <div
            key={item.id}
            className={`side-item navigator-object-row ${selectedId === item.id ? 'active' : ''}`}
            style={{ paddingLeft: pad + 16 }}
            onClick={() => onSelect(item.id)}
            title={getDetail?.(item) || getLabel(item)}
          >
            <span className="navigator-label">{getLabel(item)}</span>
            {getDetail?.(item) && <span className="navigator-detail">{getDetail(item)}</span>}
            <select
              className="move-to-folder"
              value={item.folderId ?? ''}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onMove(item.id, event.target.value || undefined)}
              title="移到文件夹"
              aria-label={`移动${getLabel(item)}`}
            >
              <option value="">未分组</option>
              {folderRows.map(({ folder, depth: folderDepth }) => (
                <option key={folder.id} value={folder.id}>{`${'　'.repeat(folderDepth)}${folder.name}`}</option>
              ))}
            </select>
          </div>
        ))}
      </>
    );
  };

  return (
    <div className="side-list navigator-side">
      <div className="side-head">
        <span>{title}</span>
        <div className="navigator-head-actions">
          <button className="ghost icon-btn" onClick={() => createFolder(null)} title="新建文件夹">▤＋</button>
          {onCreate && <button className="ghost icon-btn" onClick={onCreate} title={createLabel}>＋</button>}
        </div>
      </div>
      <div className="items">
        {renderTree(null, 0, new Set())}
        {items.length === 0 && folders.length === 0 && (
          <div className="empty-hint navigator-empty">{emptyLabel}<br />点击「＋」新建，或「▤＋」建立文件夹</div>
        )}
      </div>
    </div>
  );
}
