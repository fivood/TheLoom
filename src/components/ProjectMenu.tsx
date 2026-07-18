import { useEffect, useRef, useState } from 'react';
import { useLoom } from '../store';
import { inspectProjectImport, type ImportInspection } from '../diagnostics';
import { confirmDialog, alertDialog } from '../dialog';
import { exportBlobsToFolder } from '../assetFiles';
import { offerClearCurrentBrowserCache } from '../folderCache';
import { folderHasProject, isTauri, loadFromFolder, pickFolder, saveToFolder } from '../storage';
import Icon from './Icon';
import ImportProjectDialog from './ImportProjectDialog';

/**
 * 顶栏项目切换菜单:项目名可直接改,点开抽屉列出全部槽位并新建/导入/删除。
 * 每个项目独立记住自己的文件夹,切换时先保存当前项目再载入目标项目。
 */
export default function ProjectMenu() {
  const project = useLoom((s) => s.project);
  const slots = useLoom((s) => s.slots);
  const currentSlotId = useLoom((s) => s.currentSlotId);
  const folder = useLoom((s) => s.folder);
  const storageUsage = useLoom((s) => s.storageUsage);
  const update = useLoom((s) => s.update);
  const unbindFolder = useLoom((s) => s.unbindFolder);
  const switchSlot = useLoom((s) => s.switchSlot);
  const newSlot = useLoom((s) => s.newSlot);
  const deleteSlot = useLoom((s) => s.deleteSlot);
  const replaceProject = useLoom((s) => s.replaceProject);
  const setFolder = useLoom((s) => s.setFolder);

  const [open, setOpen] = useState(false);
  const [checkingImport, setCheckingImport] = useState(false);
  const [inspection, setInspection] = useState<ImportInspection | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onImport = async (file: File) => {
    setCheckingImport(true);
    try {
      const data = await file.text();
      setInspection(inspectProjectImport(data, file.name));
      setOpen(false);
    } catch (error) {
      await alertDialog(`导入失败:${error instanceof Error ? error.message : '文件不是有效的 TheLoom 项目文件'}`);
    } finally {
      setCheckingImport(false);
    }
  };

  const confirmImport = async () => {
    if (!inspection) return;
    if (!await newSlot('blank')) {
      await alertDialog('无法创建新项目，请先在“恢复与备份”中检查本地空间。当前项目没有被修改。');
      return;
    }
    replaceProject(inspection.project);
    setInspection(null);
  };

  const inFolder = !!folder;
  const currentSlot = slots.find((slot) => slot.id === currentSlotId);
  const others = slots.filter((s) => s.id !== currentSlotId).sort((a, b) => b.updatedAt - a.updatedAt);

  const openSlot = async (id: string) => {
    if (await switchSlot(id)) {
      setOpen(false);
      return;
    }
    const state = useLoom.getState();
    await alertDialog(state.syncError || state.saveError || '项目切换失败，当前项目仍保持打开。');
  };

  const createSlot = async (kind: 'blank' | 'sample') => {
    let dir: string | null = null;
    if (isTauri) {
      setOpen(false);
      dir = await pickFolder();
      if (!dir) {
        if (!await confirmDialog({
          message: '没有选择本地文件夹。\n\n是否仍创建一个只保存在应用内的项目?',
          confirmText: '仍然创建',
          cancelText: '取消新建',
        })) return;
      }
      if (!dir) {
        if (!await newSlot(kind)) {
          const state = useLoom.getState();
          await alertDialog(state.syncError || state.saveError || '无法创建新项目，当前项目没有被修改。');
        }
        return;
      }
      const normalizePath = (value: string) => value.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLocaleLowerCase();
      const boundSlot = slots.find((slot) => slot.folder && normalizePath(slot.folder) === normalizePath(dir!));
      if (boundSlot) {
        if (boundSlot.id === currentSlotId) {
          await alertDialog('这个文件夹已经属于当前项目，请为新项目选择另一个文件夹。');
        } else if (await confirmDialog({
          message: `这个文件夹已经绑定到项目「${boundSlot.name || '未命名项目'}」。\n\n是否直接切换到该项目?`,
          confirmText: '切换项目',
        })) {
          await openSlot(boundSlot.id);
        }
        return;
      }
      try {
        if (await folderHasProject(dir)) {
          if (!await confirmDialog({
            message: `所选文件夹里已有 TheLoom 项目。\n\n${dir}\n\n是否把它作为一个项目槽位打开?`,
            confirmText: '打开已有项目',
          })) return;
          const loaded = await loadFromFolder(dir);
          if (!await newSlot('blank')) throw new Error('无法创建项目槽位');
          replaceProject(loaded.project);
          setFolder(dir);
          useLoom.getState().setRecoveryNotice(loaded.recoveredFromBackup
            ? '项目文件夹中的 project.json 无法读取，已从 project.json.bak 恢复。'
            : null);
          await offerClearCurrentBrowserCache(dir);
          return;
        }
      } catch (error) {
        await alertDialog(`无法检查所选文件夹:${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }

    if (!await newSlot(kind)) {
      const state = useLoom.getState();
      await alertDialog(state.syncError || state.saveError || '无法创建新项目，当前项目没有被修改。');
      return;
    }

    if (!dir) {
      setOpen(false);
      return;
    }

    try {
      const createdProject = useLoom.getState().project;
      await saveToFolder(dir, createdProject);
      const moved = await exportBlobsToFolder(createdProject, dir);
      setFolder(dir);
      if (useLoom.getState().folder !== dir) throw new Error('无法记录项目文件夹绑定');
      if (moved.missing > 0) {
        await alertDialog(`项目已落盘，但有 ${moved.missing} 个资源原文件在浏览器缓存中缺失，可稍后在资源模块重新定位。`);
      }
      await offerClearCurrentBrowserCache(dir);
    } catch (error) {
      await alertDialog(`新项目已保存在应用内，但无法写入所选文件夹:\n${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="project-menu" ref={rootRef}>
      <input
        className="project-name"
        value={project.name}
        onChange={(e) => update((p) => { p.name = e.target.value; })}
        placeholder="项目名称"
        title={inFolder ? `绑定于文件夹:${folder}` : '当前项目'}
      />
      <button
        className="ghost icon-btn project-menu-toggle"
        title="切换项目 / 新建 / 导入"
        onClick={() => setOpen((v) => !v)}
      >
        ▾
      </button>

      {open && (
        <div className="project-dropdown">
          {inFolder && (
            <>
              <div className="project-dropdown-head">项目文件夹</div>
              <div className="project-folder-info" title={folder!}>{folder}</div>
              <div className="project-folder-note">
                {currentSlot?.folderOnly
                  ? '仅文件夹存储；浏览器镜像已清理。'
                  : '这个项目会记住自己的绑定，切换项目时无需解除。'}
              </div>
              {!currentSlot?.folderOnly && (
                <div
                  className="project-slot"
                  onClick={async () => {
                    setOpen(false);
                    await offerClearCurrentBrowserCache(folder!);
                  }}
                >
                  <Icon name="trash" /> <span className="project-slot-name">清理浏览器缓存</span>
                </div>
              )}
              <div
                className="project-slot"
                onClick={async () => {
                  if (await confirmDialog({
                    message: `解除与文件夹的绑定?\n\n${folder}\n\n当前项目将改回浏览器本地存储;文件夹里的内容保持不变,之后可通过「工具 → 项目文件夹」重新绑定。`,
                    confirmText: '解除绑定',
                  })) {
                    if (unbindFolder()) {
                      setOpen(false);
                    } else {
                      await alertDialog('浏览器本地空间不足或不可用,未能解除绑定。当前项目仍安全地绑定在原文件夹。');
                    }
                  }
                }}
              >
                <Icon name="folder" /> <span className="project-slot-name">解除文件夹绑定</span>
              </div>
              <div className="project-dropdown-sep" />
            </>
          )}
          {others.length > 0 && (
            <>
              <div className="project-dropdown-head">切换到</div>
              {others.map((s) => (
                <div
                  key={s.id}
                  className="project-slot"
                  onClick={() => { void openSlot(s.id); }}
                  title={s.folder ? `绑定于 ${s.folder}` : '仅保存在本机应用中'}
                >
                  <span className="project-slot-name">{s.name || '未命名项目'}</span>
                  {s.folder && (
                    <span className="project-slot-folder">
                      <Icon name="folder" /> {s.folderOnly ? '仅文件夹' : '已绑定'}
                    </span>
                  )}
                  <span className="project-slot-date">{new Date(s.updatedAt).toLocaleDateString()}</span>
                  <button
                    className="ghost icon-btn"
                    title="删除该项目(不可撤销)"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const folderNote = s.folder ? '\n\n绑定文件夹中的内容会保留，不会被删除。' : '';
                      if (await confirmDialog({ message: `删除项目「${s.name || '未命名项目'}」?应用内数据不可恢复。${folderNote}`, danger: true, confirmText: '删除' })) {
                        await deleteSlot(s.id);
                      }
                    }}
                  >×</button>
                </div>
              ))}
              <div className="project-dropdown-sep" />
            </>
          )}
          {!inFolder && (
            <>
              <div className="project-dropdown-head">当前项目</div>
              <div
                className="project-slot danger-hover"
                onClick={async () => {
                  if (slots.length <= 1) { await alertDialog('至少要保留一个项目'); return; }
                  if (await confirmDialog({ message: `删除当前项目「${project.name || '未命名项目'}」?数据不可恢复。`, danger: true, confirmText: '删除' })) {
                    if (await deleteSlot(currentSlotId)) setOpen(false);
                  }
                }}
              >
                <span className="project-slot-name">删除当前项目</span>
              </div>
              <div className="project-dropdown-sep" />
            </>
          )}
          <div className="project-slot" onClick={() => { void createSlot('blank'); }}>
            <Icon name="plus" /> <span className="project-slot-name">新建空白项目</span>
          </div>
          <div className="project-slot" onClick={() => { void createSlot('sample'); }}>
            <Icon name="book" /> <span className="project-slot-name">新建 · 载入示例</span>
          </div>
          <div className="project-slot" onClick={() => { if (!checkingImport) fileRef.current?.click(); }}>
            <Icon name="upload" /> <span className="project-slot-name">{checkingImport ? '正在检查…' : '从 JSON 文件导入'}</span>
          </div>
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
        </div>
      )}
      {inspection && (
        <ImportProjectDialog
          inspection={inspection}
          storageUsage={storageUsage}
          onCancel={() => setInspection(null)}
          onConfirm={confirmImport}
        />
      )}
    </div>
  );
}
