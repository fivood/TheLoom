import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { uid, useLoom } from '../store';
import { confirmDialog, promptText } from '../dialog';
import type { Folder, FolderModule } from '../types';
import { setObjectFavorites } from '../batch';
import BatchEditDialog from './BatchEditDialog';
import PaneHandle from './PaneHandle';

interface NavigatorItem {
  id: string;
  favorite?: boolean;
  folderId?: string;
  order?: number;
}

interface NavigatorTreeProps<T extends NavigatorItem> {
  module: FolderModule;
  title: string;
  items: T[];
  selectedId: string | null;
  getLabel: (item: T) => string;
  getDetail?: (item: T) => string | undefined;
  /** 在标签后渲染一段元信息(如技术名 code),与 getDetail 互补 */
  renderItemMeta?: (item: T) => ReactNode;
  /** 行尾操作按钮(如设置技术名、删除) */
  renderItemActions?: (item: T) => ReactNode;
  onSelect: (id: string) => void;
  /** 双击对象:通常用于重命名 */
  onItemDoubleClick?: (item: T) => void;
  onMove: (id: string, folderId: string | undefined) => void;
  /** 批量移动;未提供时逐项调用 onMove(撤销栈会合并连续编辑) */
  onMoveMany?: (ids: string[], folderId: string | undefined) => void;
  /** 在某文件夹内重排对象;orderedIds 为新顺序,模块据此写回 order */
  onReorder?: (parentId: string | null, orderedIds: string[]) => void;
  onCreate?: () => void;
  createLabel?: string;
  emptyLabel?: string;
}

function byOrder<T extends { order?: number }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const oa = a.order ?? Number.POSITIVE_INFINITY;
    const ob = b.order ?? Number.POSITIVE_INFINITY;
    return oa - ob;
  });
}

function flattenFolders(folders: Folder[]): { folder: Folder; depth: number }[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const parentId = folder.parentId ?? null;
    const list = byParent.get(parentId) ?? [];
    list.push(folder);
    byParent.set(parentId, list);
  }
  for (const list of byParent.values()) byOrder(list);
  const rows: { folder: Folder; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number, trail: Set<string>) => {
    for (const folder of byOrder(byParent.get(parentId) ?? [])) {
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

type DropTarget = { id: string; kind: 'folder' | 'item'; position: 'before' | 'after' | 'into' };

export default function NavigatorTree<T extends NavigatorItem>({
  module, title, items, selectedId, getLabel, getDetail, renderItemMeta, renderItemActions,
  onSelect, onItemDoubleClick, onMove, onMoveMany, onReorder, onCreate,
  createLabel = '新建', emptyLabel = '这里还没有内容',
}: NavigatorTreeProps<T>) {
  const allFolders = useLoom((s) => s.project.folders);
  const folders = useMemo(() => allFolders.filter((folder) => folder.module === module), [allFolders, module]);
  const { addFolder, updateFolder, removeFolder, update } = useLoom();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folders.map((folder) => folder.id)));
  const [multiSelect, setMultiSelect] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [batchEditIds, setBatchEditIds] = useState<string[] | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragRef = useRef<{ kind: 'item' | 'folder'; id: string } | null>(null);
  const rowRects = useRef(new Map<string, { top: number; height: number }>());

  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const foldersByParent = useMemo(() => {
    const result = new Map<string | null, Folder[]>();
    if (favoritesOnly) return result;
    for (const folder of folders) {
      const parentId = folder.parentId ?? null;
      const list = result.get(parentId) ?? [];
      list.push(folder);
      result.set(parentId, list);
    }
    for (const list of result.values()) byOrder(list);
    return result;
  }, [folders, favoritesOnly]);
  const itemsByFolder = useMemo(() => {
    const result = new Map<string | null, T[]>();
    for (const item of items) {
      if (favoritesOnly && !item.favorite) continue;
      const folderId = favoritesOnly ? null : item.folderId && folderById.has(item.folderId) ? item.folderId : null;
      const list = result.get(folderId) ?? [];
      list.push(item);
      result.set(folderId, list);
    }
    for (const list of result.values()) byOrder(list);
    return result;
  }, [items, folderById, favoritesOnly]);
  const folderRows = useMemo(() => flattenFolders(folders), [folders]);
  const favoriteCount = items.filter((item) => item.favorite).length;
  const visibleItems = favoritesOnly ? items.filter((item) => item.favorite) : items;

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

  const clearMulti = () => { if (multiSelect.size) setMultiSelect(new Set()); };

  const toggleFolder = (id: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const createFolder = async (parentId: string | null) => {
    const name = await promptText({
      message: parentId ? '子文件夹名称' : '文件夹名称',
      placeholder: '文件夹名称',
    });
    if (!name?.trim()) return;
    const id = uid();
    addFolder({ id, name: name.trim(), module, parentId });
    setExpanded((previous) => new Set(previous).add(id).add(parentId ?? id));
  };
  const renameFolder = async (folder: Folder) => {
    const name = await promptText({
      message: '文件夹名称',
      defaultValue: folder.name,
    });
    if (name?.trim()) updateFolder(folder.id, { name: name.trim() });
  };
  const deleteFolder = async (folder: Folder) => {
    const ok = await confirmDialog({
      message: `删除文件夹「${folder.name}」？\n其下子文件夹一并删除，内容归入未分组（不会删除正文或资源）。`,
      danger: true,
      confirmText: '删除',
    });
    if (ok) removeFolder(folder.id);
  };

  const isDescendant = (candidateId: string, ancestorId: string): boolean => {
    let current = folderById.get(candidateId);
    const seen = new Set<string>();
    while (current && current.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.parentId === ancestorId) return true;
      current = folderById.get(current.parentId);
    }
    return false;
  };

  const countItemsIn = (folderId: string, trail = new Set<string>()): number => {
    if (trail.has(folderId)) return 0;
    const nextTrail = new Set(trail).add(folderId);
    return (itemsByFolder.get(folderId)?.length ?? 0) +
      (foldersByParent.get(folderId) ?? []).reduce((sum, child) => sum + countItemsIn(child.id, nextTrail), 0);
  };

  // ---- 拖拽 ----
  const onDragStartItem = (e: React.DragEvent, id: string) => {
    dragRef.current = { kind: 'item', id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };
  const onDragStartFolder = (e: React.DragEvent, id: string) => {
    dragRef.current = { kind: 'folder', id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setDropTarget(null);
    rowRects.current.clear();
  };
  const computeZone = (e: React.DragEvent, id: string, isFolder: boolean): 'before' | 'after' | 'into' => {
    const rect = rowRects.current.get(id);
    if (!rect) return isFolder ? 'into' : 'after';
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;
    if (isFolder) {
      if (ratio < 0.28) return 'before';
      if (ratio > 0.72) return 'after';
      return 'into';
    }
    return ratio < 0.5 ? 'before' : 'after';
  };
  const onDragOverRow = (e: React.DragEvent, id: string, isFolder: boolean) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const zone = computeZone(e, id, isFolder);
    setDropTarget({ id, kind: isFolder ? 'folder' : 'item', position: zone });
  };
  const onDropOnFolder = (folderId: string, zone: 'before' | 'after' | 'into') => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'folder') {
      if (d.id === folderId || isDescendant(folderId, d.id)) { onDragEnd(); return; }
      const target = folderById.get(folderId);
      if (!target) { onDragEnd(); return; }
      if (zone === 'into') {
        updateFolder(d.id, { parentId: folderId });
        setExpanded((s) => new Set(s).add(folderId));
      } else {
        const parentId = target.parentId ?? null;
        if (d.id === parentId || isDescendant(parentId ?? '', d.id)) { onDragEnd(); return; }
        updateFolder(d.id, { parentId });
        reorderSiblings(parentId, d.id, folderId, zone);
      }
    } else {
      // item → folder
      if (zone === 'into') {
        moveItemsTo(folderId);
      } else {
        // 把对象放到该文件夹所在层级的目标位置之后/之前:先归到同级父文件夹,再在该层重排
        const target = folderById.get(folderId);
        if (!target) { onDragEnd(); return; }
        const parentId = target.parentId ?? null;
        moveItemsTo(parentId);
      }
    }
    onDragEnd();
  };
  const onDropOnItem = (itemId: string, zone: 'before' | 'after') => {
    const d = dragRef.current;
    if (!d) return;
    const item = items.find((it) => it.id === itemId);
    if (!item) { onDragEnd(); return; }
    const parentId = item.folderId && folderById.has(item.folderId) ? item.folderId : null;
    if (d.kind === 'item') {
      moveItemsTo(parentId);
      if (onReorder) {
        const siblings = (itemsByFolder.get(parentId) ?? []).map((it) => it.id).filter((id) => id !== d.id);
        const idx = siblings.indexOf(itemId);
        const insertAt = zone === 'before' ? idx : idx + 1;
        siblings.splice(insertAt, 0, d.id);
        onReorder(parentId, siblings);
      }
    } else {
      // folder → item:把文件夹挂到该对象所在层级
      if (parentId === d.id || isDescendant(parentId ?? '', d.id)) { onDragEnd(); return; }
      updateFolder(d.id, { parentId: parentId ?? undefined });
    }
    onDragEnd();
  };
  const reorderSiblings = (parentId: string | null, draggedId: string, anchorId: string, zone: 'before' | 'after') => {
    update((p) => {
      const siblings = p.folders.filter((f) => f.module === module && (f.parentId ?? null) === parentId);
      const ordered = byOrder(siblings);
      const ids = ordered.map((f) => f.id).filter((id) => id !== draggedId);
      const idx = ids.indexOf(anchorId);
      if (idx < 0) return;
      ids.splice(zone === 'before' ? idx : idx + 1, 0, draggedId);
      const map = new Map(ids.map((id, i) => [id, i]));
      for (const f of p.folders) {
        if (f.module === module && (f.parentId ?? null) === parentId && map.has(f.id)) f.order = map.get(f.id);
      }
    });
  };
  const moveItemsTo = (folderId: string | null | undefined) => {
    const fid = folderId ?? undefined;
    const d = dragRef.current;
    if (!d || d.kind !== 'item') return;
    let ids = [d.id];
    if (multiSelect.has(d.id)) ids = [...multiSelect];
    else clearMulti();
    if (onMoveMany && ids.length > 1) onMoveMany(ids, fid);
    else ids.forEach((id) => onMove(id, fid));
  };

  const toggleFavorite = (item: T) => {
    update((project) => setObjectFavorites(project, module, [item.id], !item.favorite));
  };

  const renderTree = (parentId: string | null, depth: number, trail: Set<string>): ReactNode => {
    const pad = 8 + depth * 14;
    const siblingFolders = foldersByParent.get(parentId) ?? [];
    return (
      <>
        {siblingFolders.map((folder) => {
          if (trail.has(folder.id)) return null;
          const open = expanded.has(folder.id);
          const isDrop = dropTarget?.id === folder.id && dropTarget.kind === 'folder';
          return (
            <div key={folder.id}>
              <div
                className={`side-item folder-row navigator-folder-row${isDrop && dropTarget?.position === 'into' ? ' drag-into' : ''}`}
                style={{ paddingLeft: pad }}
                onClick={() => toggleFolder(folder.id)}
                draggable
                onDragStart={(e) => { e.stopPropagation(); onDragStartFolder(e, folder.id); }}
                onDragOver={(e) => onDragOverRow(e, folder.id, true)}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => { e.preventDefault(); const zone = computeZone(e, folder.id, true); onDropOnFolder(folder.id, zone); }}
                onDragEnd={onDragEnd}
                ref={(el) => { if (el) rowRects.current.set(folder.id, { top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height }); }}
              >
                {isDrop && dropTarget?.position === 'before' && <span className="drop-line" />}
                <span className="caret">{open ? '▾' : '▸'}</span>
                <span className="navigator-label">{folder.name}</span>
                <span className="count">{countItemsIn(folder.id)}</span>
                <span className="navigator-folder-actions">
                  <button className="ghost icon-btn" title="新建子文件夹" onClick={(event) => { event.stopPropagation(); createFolder(folder.id); }}>＋</button>
                  <button className="ghost icon-btn" title="重命名文件夹" onClick={(event) => { event.stopPropagation(); renameFolder(folder); }}>✎</button>
                  <button className="ghost icon-btn" title="删除文件夹" onClick={(event) => { event.stopPropagation(); deleteFolder(folder); }}>×</button>
                </span>
                {isDrop && dropTarget?.position === 'after' && <span className="drop-line" />}
              </div>
              {open && renderTree(folder.id, depth + 1, new Set(trail).add(folder.id))}
            </div>
          );
        })}
        {(itemsByFolder.get(parentId) ?? []).map((item) => {
          const isDrop = dropTarget?.id === item.id && dropTarget.kind === 'item';
          const isSelected = selectedId === item.id || multiSelect.has(item.id);
          return (
            <div
              key={item.id}
              className={`side-item navigator-object-row${isSelected ? ' active' : ''}${isDrop ? ' drag-into' : ''}`}
              style={{ paddingLeft: pad + 16 }}
              onClick={(event) => handleItemClick(event, item.id)}
              onDoubleClick={() => onItemDoubleClick?.(item)}
              title={getDetail?.(item) || getLabel(item)}
              draggable
              onDragStart={(e) => { e.stopPropagation(); onDragStartItem(e, item.id); }}
              onDragOver={(e) => onDragOverRow(e, item.id, false)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => { e.preventDefault(); const zone = computeZone(e, item.id, false); onDropOnItem(item.id, zone === 'into' ? 'after' : zone); }}
              onDragEnd={onDragEnd}
              ref={(el) => { if (el) rowRects.current.set(item.id, { top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height }); }}
            >
              {isDrop && dropTarget?.position === 'before' && <span className="drop-line" />}
              <span className="navigator-label">{getLabel(item)}</span>
              {getDetail?.(item) && <span className="navigator-detail">{getDetail(item)}</span>}
              {renderItemMeta?.(item)}
              <button
                className={`ghost navigator-favorite${item.favorite ? ' active' : ''}`}
                title={item.favorite ? '取消收藏' : '加入收藏'}
                aria-label={`${item.favorite ? '取消收藏' : '收藏'}${getLabel(item)}`}
                onClick={(event) => { event.stopPropagation(); toggleFavorite(item); }}
              >
                {item.favorite ? '★' : '☆'}
              </button>
              {renderItemActions?.(item)}
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
              {isDrop && dropTarget?.position === 'after' && <span className="drop-line" />}
            </div>
          );
        })}
      </>
    );
  };

  const handleItemClick = (event: React.MouseEvent, id: string) => {
    if (event.ctrlKey || event.metaKey) {
      setMultiSelect((prev) => {
        // 首次 ctrl+click 时,把上次单选(selectedId)也纳入选择集,避免丢失
        const next = new Set(prev);
        if (next.size === 0 && selectedId && selectedId !== id) next.add(selectedId);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      onSelect(id);
      return;
    }
    if (event.shiftKey && selectedId) {
      const visible = visibleItems.map((it) => it.id);
      const i = visible.indexOf(id);
      const j = visible.indexOf(selectedId);
      if (i >= 0 && j >= 0) {
        const [lo, hi] = i < j ? [i, j] : [j, i];
        setMultiSelect(new Set(visible.slice(lo, hi + 1)));
      }
      onSelect(id);
      return;
    }
    setMultiSelect(new Set([id]));
    onSelect(id);
  };

  const batchIds = [...multiSelect];
  const showBatch = batchIds.length > 1;

  return (
    <>
    <div className="side-list navigator-side">
      <div className="side-head">
        <span>{title}</span>
        <div className="navigator-head-actions">
          <button
            className={`ghost navigator-head-btn navigator-favorites-btn${favoritesOnly ? ' active' : ''}`}
            onClick={() => {
              setFavoritesOnly((value) => !value);
              setMultiSelect(new Set());
            }}
            title={favoritesOnly ? '返回全部内容' : '只看收藏'}
          >
            <span className="btn-glyph">★</span> 收藏 {favoriteCount}
          </button>
          <button className="ghost navigator-head-btn" onClick={() => createFolder(null)} title="新建文件夹(用于分组归档)">
            <span className="btn-glyph">▤</span> 文件夹
          </button>
          {onCreate && (
            <button className="ghost navigator-head-btn primary-ghost" onClick={onCreate} title={createLabel}>
              <span className="btn-glyph">＋</span> {createLabel}
            </button>
          )}
        </div>
      </div>
      <div className="items">
        {renderTree(null, 0, new Set())}
        {!favoritesOnly && items.length === 0 && folders.length === 0 && (
          <div className="empty-hint navigator-empty">{emptyLabel}<br />点击顶部「＋ {createLabel}」新建,或「▤ 文件夹」建立分组</div>
        )}
        {favoritesOnly && favoriteCount === 0 && (
          <div className="empty-hint navigator-empty">还没有收藏<br />点击条目右侧的 ☆ 即可加入收藏夹</div>
        )}
      </div>
      <PaneHandle varName="--pane-nav" side="right" />
      {showBatch && (
        <div className="navigator-batch">
          <span className="navigator-batch-count">已选 {batchIds.length} 项</span>
          <select
            value=""
            onChange={(e) => {
              const fid = e.target.value || undefined;
              if (onMoveMany) onMoveMany(batchIds, fid);
              else batchIds.forEach((id) => onMove(id, fid));
              setMultiSelect(new Set());
            }}
            title="批量移到文件夹"
          >
            <option value="" disabled>移到文件夹…</option>
            <option value="">未分组</option>
            {folderRows.map(({ folder, depth: fd }) => (
              <option key={folder.id} value={folder.id}>{`${'　'.repeat(fd)}${folder.name}`}</option>
            ))}
          </select>
          <button className="ghost navigator-batch-edit" onClick={() => setBatchEditIds(batchIds)}>批量编辑…</button>
          <button className="ghost icon-btn" title="取消多选" onClick={() => setMultiSelect(new Set())}>×</button>
        </div>
      )}
    </div>
    {batchEditIds && (
      <BatchEditDialog module={module} ids={batchEditIds} onClose={() => {
        setBatchEditIds(null);
        setMultiSelect(new Set());
      }} />
    )}
    </>
  );
}
