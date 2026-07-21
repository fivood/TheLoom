import { useEffect, useMemo, useState } from 'react';
import { useLoom } from '../store';
import { alertDialog, confirmDialog, promptText } from '../dialog';
import Icon from './Icon';
import { useEscape } from '../hooks/useEscape';
import { listStoredFiles } from '../assetFiles';
import { makeZip } from '../interop/zip';

/**
 * 存储管理 · 一屏看清本机数据 + 备份 + 清除。
 * - 显示每个槽位大小与总占用、IndexedDB 资源缓存大小
 * - 「全部导出为 zip」:所有槽位打包成 zip(每个槽位一个 project-<name>.json)
 * - 「清除本机数据」:分粒度 —— 单槽位 / 全部槽位 / 只清资源缓存 / 全清 (含主题 / 引导 / 演出存档等非项目键)
 * 网页版是本地数据的唯一副本,清除前会强制先做一次备份;桌面版绑定文件夹的槽位标注「已落盘」,
 * 可以放心清浏览器镜像。
 */

interface SlotStats {
  id: string;
  name: string;
  bytes: number;
  folder?: string;
  folderOnly?: boolean;
  updatedAt?: number;
}

const NON_PROJECT_KEYS_HINT = [
  ['theloom-plays-', '演出存档(每槽位一份)'],
  ['theloom-breakpoints-', '演出断点(每槽位一份)'],
  ['theloom-theme-v1', '主题偏好'],
  ['theloom-onboarded-v1', '首启引导标记'],
  ['theloom-last-tab', '上次停留的模块'],
  ['theloom-llm-v2', 'AI 服务配置(不含桌面版密钥)'],
];

function keySize(key: string): number {
  const v = localStorage.getItem(key) ?? '';
  return (key.length + v.length) * 2;
}

function bytesToText(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

async function backupSlotsToZip(slots: SlotStats[]) {
  const entries: { name: string; content: string }[] = [];
  const usedNames = new Set<string>();
  for (const s of slots) {
    const raw = localStorage.getItem(`theloom-project-${s.id}`);
    if (!raw) continue;
    let safe = (s.name || '未命名项目').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    let n = 1;
    let candidate = `${safe}.json`;
    while (usedNames.has(candidate)) { n++; candidate = `${safe}-${n}.json`; }
    usedNames.add(candidate);
    entries.push({ name: candidate, content: raw });
  }
  const manifest = {
    exportedAt: new Date().toISOString(),
    projectCount: entries.length,
    slots: slots.map((s) => ({ id: s.id, name: s.name, bytes: s.bytes })),
  };
  entries.push({ name: 'manifest.json', content: JSON.stringify(manifest, null, 2) });
  const blob = await makeZip(entries);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `theloom-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function StorageManager({ onClose }: { onClose: () => void }) {
  useEscape(true, onClose);
  const slots = useLoom((s) => s.slots);
  const currentSlotId = useLoom((s) => s.currentSlotId);
  const deleteSlot = useLoom((s) => s.deleteSlot);
  const storageUsage = useLoom((s) => s.storageUsage);

  const [idbCount, setIdbCount] = useState<number | null>(null);
  const [idbBytes, setIdbBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const slotStats: SlotStats[] = useMemo(() => slots.map((s) => ({
    id: s.id,
    name: s.name || '未命名项目',
    bytes: keySize(`theloom-project-${s.id}`)
      + keySize(`theloom-plays-${s.id}`)
      + keySize(`theloom-breakpoints-${s.id}`),
    folder: s.folder,
    folderOnly: s.folderOnly,
    updatedAt: s.updatedAt,
  })), [slots, refresh]);

  const nonProjectBytes = useMemo(() => {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('theloom-')) continue;
      if (k.startsWith('theloom-project-')) continue;
      if (k.startsWith('theloom-plays-')) continue;
      if (k.startsWith('theloom-breakpoints-')) continue;
      if (k === 'theloom-slots-v1' || k === 'theloom-current-v1') continue;
      total += keySize(k);
    }
    return total;
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const files = await listStoredFiles(null);
        if (cancelled) return;
        setIdbCount(files.length);
        // 网页版 listStoredFiles 不返回 size(桌面版会),这里对桌面就近汇总
        const totalSize = files.reduce((n, f) => n + (f.size ?? 0), 0);
        setIdbBytes(totalSize > 0 ? totalSize : null);
      } catch {
        if (!cancelled) setIdbCount(null);
      }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  const doBackupAll = async () => {
    setBusy('正在打包全部槽位…');
    try {
      await backupSlotsToZip(slotStats);
      await alertDialog('已下载 zip 备份;可放到 U 盘 / 网盘保存或用于新机器恢复。');
    } catch (e) {
      await alertDialog(`备份失败:${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(null); }
  };

  const doDeleteSlot = async (s: SlotStats) => {
    if (slots.length <= 1) { await alertDialog('至少要保留一个项目槽位;要彻底清空请用「清除全部」。'); return; }
    const isCurrent = s.id === currentSlotId;
    const hint = s.folder ? `已绑定文件夹 ${s.folder}(内容不动)` : '数据只在浏览器里,删除后无法恢复';
    if (!await confirmDialog({
      message: `删除项目「${s.name}」?\n${hint}\n${isCurrent ? '\n(当前项目;删除后会自动切到下一个)' : ''}`,
      danger: true, confirmText: '删除',
    })) return;
    setBusy('正在删除…');
    try { await deleteSlot(s.id); setRefresh((n) => n + 1); }
    catch (e) { await alertDialog(`删除失败:${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  };

  const doClearIdb = async () => {
    if (idbCount === 0) { await alertDialog('IndexedDB 资源缓存本来就是空的。'); return; }
    const sizeText = idbBytes != null ? `(${bytesToText(idbBytes)})` : '';
    if (!await confirmDialog({
      message: `清除 ${idbCount ?? '?'} 个资源原文件${sizeText}?\n\n这只删存在浏览器里的字节;项目 JSON 里的资源引用不动,\n下次导入或从文件夹重新绑定后仍可恢复。`,
      danger: true, confirmText: '清除',
    })) return;
    setBusy('正在清除 IndexedDB…');
    try {
      const files = await listStoredFiles(null);
      const req = indexedDB.deleteDatabase('theloom-assets');
      await new Promise<void>((res, rej) => {
        req.onsuccess = () => res();
        req.onerror = () => rej(new Error(req.error?.message ?? 'deleteDatabase failed'));
        req.onblocked = () => rej(new Error('IndexedDB 被其他标签页占用,请先关闭其他 TheLoom 标签'));
      });
      await alertDialog(`已清除 ${files.length} 个资源原文件。`);
      setRefresh((n) => n + 1);
    } catch (e) {
      await alertDialog(`清除失败:${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(null); }
  };

  const doClearAll = async () => {
    const backed = await confirmDialog({
      message: '⚠️ 危险操作 · 清除本机全部 TheLoom 数据\n\n将删除:\n· 所有项目槽位(浏览器本地副本)\n· 所有版本快照、演出存档、断点\n· 主题偏好 / AI 配置 / 首启引导标记\n· IndexedDB 资源原文件缓存\n\n绑定文件夹的项目 —— 磁盘上的文件不会动;但浏览器镜像会消失,下次打开会从文件夹重新加载。\n\n继续吗?建议先「全部导出为 zip」。',
      danger: true, confirmText: '我已备份,清除全部',
    });
    if (!backed) return;
    const confirmText = await promptText({
      message: '输入 CLEAR ALL 确认清除:',
      defaultValue: '',
      placeholder: 'CLEAR ALL',
    });
    if (confirmText !== 'CLEAR ALL') { await alertDialog('已取消(输入不匹配)。'); return; }

    setBusy('正在清除…');
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('theloom-')) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
      try {
        await new Promise<void>((res) => {
          const req = indexedDB.deleteDatabase('theloom-assets');
          req.onsuccess = () => res();
          req.onerror = () => res();
          req.onblocked = () => res();
        });
      } catch { /* 忽略 */ }
      await alertDialog(`已清除 ${keys.length} 项本地数据。页面将刷新以重置。`);
      location.reload();
    } catch (e) {
      await alertDialog(`清除失败:${e instanceof Error ? e.message : String(e)}`);
      setBusy(null);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette storage-manager" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <Icon name="archive" size={14} />
          <span>存储管理 · 本机数据</span>
          <span className="spacer" />
          <button className="ghost icon-btn" title="关闭 (Esc)" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <div className="sync-body" style={{ overflowY: 'auto', padding: 12 }}>
          {busy && <div className="empty-hint" style={{ padding: 20 }}>{busy}</div>}
          {!busy && (
            <>
              <div className="field">
                <label>本机 localStorage 占用</label>
                <div style={{ fontSize: 13 }}>
                  {storageUsage.available
                    ? `${bytesToText(storageUsage.bytes)} · ${storageUsage.entries} 项`
                    : '(浏览器未开放读取)'}
                </div>
              </div>

              <div className="field">
                <label>项目槽位({slotStats.length})</label>
                <table className="var-table">
                  <thead><tr><th>项目名</th><th>大小</th><th>状态</th><th></th></tr></thead>
                  <tbody>
                    {slotStats.map((s) => (
                      <tr key={s.id} style={s.id === currentSlotId ? { fontWeight: 600 } : undefined}>
                        <td>{s.name}{s.id === currentSlotId && <span className="hint" style={{ marginLeft: 4 }}>(当前)</span>}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{bytesToText(s.bytes)}</td>
                        <td className="hint" style={{ fontSize: 11 }}>
                          {s.folderOnly ? '仅文件夹(浏览器无镜像)' : s.folder ? '文件夹 + 镜像' : '仅浏览器'}
                        </td>
                        <td>
                          <button
                            className="ghost icon-btn danger"
                            title="删除该槽位(桌面绑定文件夹的话仅删镜像,文件夹内容不动)"
                            onClick={() => doDeleteSlot(s)}
                            disabled={slots.length <= 1}
                          >×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="field">
                <label>IndexedDB 资源原文件</label>
                <div style={{ fontSize: 13 }}>
                  {idbCount == null
                    ? '(读取中…或浏览器不支持)'
                    : `${idbCount} 个文件${idbBytes != null ? ` · ${bytesToText(idbBytes)}` : ''}`}
                </div>
                <button
                  className="ghost" style={{ marginTop: 6 }} disabled={!idbCount}
                  onClick={doClearIdb}
                >清除资源缓存</button>
              </div>

              <div className="field">
                <label>非项目键 · {bytesToText(nonProjectBytes)}</label>
                <ul className="doc-legend" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  {NON_PROJECT_KEYS_HINT.map(([k, desc]) => <li key={k}>{k}* — {desc}</li>)}
                </ul>
              </div>

              <div className="field" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <label>备份与清除</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button className="primary" onClick={doBackupAll}>
                    <Icon name="download" /> 全部导出为 zip({slotStats.length} 个项目)
                  </button>
                  <button className="danger" onClick={doClearAll}>
                    <Icon name="trash" /> 清除本机全部 TheLoom 数据…
                  </button>
                </div>
                <div className="hint" style={{ fontSize: 11, marginTop: 6 }}>
                  网页版是本地数据唯一副本 —— 清除前请先备份。桌面版绑定过文件夹的项目,
                  磁盘上的文件不会被这个操作删除,只清浏览器镜像;下次打开会从文件夹重新加载。
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
