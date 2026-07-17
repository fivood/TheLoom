import { useEffect, useRef, useState } from 'react';
import { useLoom } from '../store';
import { inspectProjectImport, type ImportInspection } from '../diagnostics';
import { confirmDialog, alertDialog } from '../dialog';
import Icon from './Icon';
import ImportProjectDialog from './ImportProjectDialog';

/**
 * 顶栏项目切换菜单:项目名可直接改,点开抽屉列出全部槽位并新建/导入/删除。
 * 桌面版绑定文件夹时仍可切换项目,但会先安全解除绑定。
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
    if (!await ensureUnbound()) return;
    if (!newSlot('blank')) {
      await alertDialog('无法创建新项目，请先在“恢复与备份”中检查本地空间。当前项目没有被修改。');
      return;
    }
    replaceProject(inspection.project);
    setInspection(null);
  };

  const inFolder = !!folder;
  const others = slots.filter((s) => s.id !== currentSlotId).sort((a, b) => b.updatedAt - a.updatedAt);

  /** 绑定文件夹时,切换 / 新建 / 导入前先确认解绑(避免把别的项目写进已绑定文件夹) */
  const ensureUnbound = async (): Promise<boolean> => {
    if (!folder) return true;
    const ok = await confirmDialog({
      message: `当前项目绑定在文件夹:\n${folder}\n\n继续操作会解除绑定,当前项目改回浏览器本地存储;文件夹里的内容保持不变,之后可随时重新绑定。`,
      confirmText: '解除绑定并继续',
    });
    if (!ok) return false;
    if (unbindFolder()) return true;
    await alertDialog('浏览器本地空间不足或不可用,未能解除绑定。当前项目仍安全地绑定在原文件夹。');
    return false;
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
                  onClick={async () => {
                    if (await ensureUnbound()) switchSlot(s.id);
                    setOpen(false);
                  }}
                >
                  <span className="project-slot-name">{s.name || '未命名项目'}</span>
                  <span className="project-slot-date">{new Date(s.updatedAt).toLocaleDateString()}</span>
                  <button
                    className="ghost icon-btn"
                    title="删除该项目(不可撤销)"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await confirmDialog({ message: `删除项目「${s.name || '未命名项目'}」?数据不可恢复。`, danger: true, confirmText: '删除' })) deleteSlot(s.id);
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
                  if (await confirmDialog({ message: `删除当前项目「${project.name || '未命名项目'}」?数据不可恢复。`, danger: true, confirmText: '删除' })) deleteSlot(currentSlotId);
                  setOpen(false);
                }}
              >
                <span className="project-slot-name">删除当前项目</span>
              </div>
              <div className="project-dropdown-sep" />
            </>
          )}
          <div className="project-slot" onClick={async () => { if (await ensureUnbound()) newSlot('blank'); setOpen(false); }}>
            <Icon name="plus" /> <span className="project-slot-name">新建空白项目</span>
          </div>
          <div className="project-slot" onClick={async () => { if (await ensureUnbound()) newSlot('sample'); setOpen(false); }}>
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
