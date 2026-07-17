import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { findAssetRefs, useNav } from '../../search';
import { alertDialog, confirmDialog } from '../../dialog';
import Icon from '../../components/Icon';
import type { Asset, AssetKind } from '../../types';
import { ASSET_KIND_ICON, ASSET_KIND_LABEL } from '../../types';
import { classifyAsset, fileToImageThumb, fileToVideoThumb, formatSize } from '../../util';
import {
  assetExt, collectReferencedTexts, computeOrphans, deleteStoredFiles, getAssetUrl,
  hashBlob, invalidateAssetUrl, isAssetStored, listStoredFiles, storeAssetFile,
} from '../../assetFiles';
import Inspector from '../../components/Inspector';
import TechNameField from '../../components/TechNameField';
import NavigatorTree, { FolderSelect } from '../../components/NavigatorTree';

const KINDS = Object.keys(ASSET_KIND_LABEL) as AssetKind[];

async function fileThumb(file: File, kind: AssetKind): Promise<string | undefined> {
  try {
    if (kind === 'image') return await fileToImageThumb(file);
    if (kind === 'video') return await fileToVideoThumb(file);
  } catch { /* 单个缩略图失败不阻塞导入 */ }
  return undefined;
}

export default function Assets() {
  const project = useLoom((s) => s.project);
  const folder = useLoom((s) => s.folder);
  const assets = project.assets;
  const { addAsset, updateAsset, removeAsset, update } = useLoom();
  const go = useNav((s) => s.go);

  const [kindFilter, setKindFilter] = useState<AssetKind | 'all'>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const repickRef = useRef<HTMLInputElement>(null);
  /** repick 输入框当前的语义:replace = 替换文件;relocate = 缺失重定位 / 关联原文件 */
  const repickMode = useRef<'replace' | 'relocate'>('replace');

  /** 已落盘 / 已入库的存储键集合;null = 尚未扫描 */
  const [storedKeys, setStoredKeys] = useState<Set<string> | null>(null);
  const refreshStored = useCallback(async () => {
    try {
      const files = await listStoredFiles(folder);
      setStoredKeys(new Set(files.map((f) => f.key)));
    } catch {
      setStoredKeys(null);
    }
  }, [folder]);
  useEffect(() => { refreshStored(); }, [refreshStored]);

  const navSeq = useNav((s) => s.seq);
  useEffect(() => {
    const t = useNav.getState().target;
    if (t?.tab === 'assets' && t.assetId) {
      setKindFilter('all');
      setTagFilter(null);
      setQuery('');
      setSelectedId(t.assetId);
      useNav.getState().clear();
    }
  }, [navSeq]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) for (const t of a.tags) set.add(t);
    return [...set].sort();
  }, [assets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = assets.filter((a) =>
      (kindFilter === 'all' || a.kind === kindFilter) &&
      (!tagFilter || a.tags.includes(tagFilter)) &&
      (!q ||
        a.name.toLowerCase().includes(q) ||
        a.notes.toLowerCase().includes(q) ||
        a.source.toLowerCase().includes(q) ||
        (a.license ?? '').toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q))),
    );
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }, [assets, kindFilter, tagFilter, query]);

  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const refs = useMemo(
    () => selected ? findAssetRefs(project, selected) : [],
    [project, selected],
  );

  const missing = useCallback(
    (a: Asset) => !!a.hash && storedKeys !== null && !isAssetStored(a, storedKeys, folder),
    [storedKeys, folder],
  );

  /** 选中资源的原文件对象 URL(播放 / 原图 / 下载用) */
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setMediaUrl(null);
    if (selected?.hash) {
      getAssetUrl(folder, selected).then((u) => { if (alive) setMediaUrl(u); });
    }
    return () => { alive = false; };
    // storedKeys 变化(导入 / 重定位 / 清理后)也重取:缺失恢复后无需重新选中即可播放
  }, [selected?.id, selected?.hash, folder, storedKeys]);

  const onPickFiles = async (files: FileList) => {
    const skipped: string[] = [];
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      const kind = classifyAsset(file);
      const hash = await hashBlob(file);
      const ext = assetExt(file.name, file.type);
      const dup = useLoom.getState().project.assets.find((x) => x.hash === hash);
      if (dup) {
        skipped.push(`${file.name} → 与「${dup.name}」内容相同`);
        continue;
      }
      try {
        await storeAssetFile(folder, hash, ext, file);
      } catch (e) {
        failed.push(`${file.name}:${e instanceof Error ? e.message : e}`);
      }
      const a: Asset = {
        id: uid(),
        folderId: selected?.folderId,
        name: file.name.replace(/\.[^.]+$/, ''),
        kind,
        mime: file.type || 'application/octet-stream',
        thumbnail: await fileThumb(file, kind),
        hash,
        ext,
        size: file.size,
        tags: [],
        source: '',
        notes: '',
        createdAt: Date.now(),
      };
      addAsset(a);
    }
    await refreshStored();
    const report = [
      skipped.length ? `已跳过 ${skipped.length} 个重复文件(内容哈希一致):\n${skipped.join('\n')}` : '',
      failed.length ? `原文件保存失败(条目已创建,可稍后「重新定位」):\n${failed.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    if (report) await alertDialog(report);
  };

  /** 替换文件:保留资源 id(所有附件引用不变),换掉原文件与元数据 */
  const doReplace = async (a: Asset, file: File) => {
    const hash = await hashBlob(file);
    const ext = assetExt(file.name, file.type);
    const kind = classifyAsset(file);
    try {
      await storeAssetFile(folder, hash, ext, file);
    } catch (e) {
      await alertDialog(`原文件保存失败:${e instanceof Error ? e.message : e}`);
      return;
    }
    invalidateAssetUrl(hash);
    updateAsset(a.id, {
      hash, ext, kind,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      thumbnail: await fileThumb(file, kind),
    });
    await refreshStored();
  };

  /** 重新定位:优先校验内容一致(哈希相同);不一致时经确认转为替换 */
  const doRelocate = async (a: Asset, file: File) => {
    const hash = await hashBlob(file);
    if (a.hash && hash !== a.hash) {
      if (!await confirmDialog({
        message: `所选文件与原记录的内容不一致(哈希不同)。\n\n作为「替换文件」导入?引用关系保持不变,但缩略图与元数据会更新。`,
        confirmText: '替换',
      })) return;
      await doReplace(a, file);
      return;
    }
    // 内容一致(或旧资源从未记录哈希):存字节并补全记录
    const ext = a.ext ?? assetExt(file.name, file.type);
    try {
      await storeAssetFile(folder, hash, ext, file);
    } catch (e) {
      await alertDialog(`原文件保存失败:${e instanceof Error ? e.message : e}`);
      return;
    }
    invalidateAssetUrl(hash);
    if (!a.hash) {
      const kind = classifyAsset(file);
      updateAsset(a.id, {
        hash, ext, kind,
        mime: file.type || a.mime || 'application/octet-stream',
        size: file.size,
        thumbnail: a.thumbnail ?? await fileThumb(file, kind),
      });
    }
    await refreshStored();
  };

  const onRepick = async (files: FileList) => {
    const file = files[0];
    const a = selected;
    if (!file || !a) return;
    if (repickMode.current === 'replace') await doReplace(a, file);
    else await doRelocate(a, file);
  };

  /** 清理未被任何项目 / 快照引用的原文件字节(唯一会删除字节的入口) */
  const cleanupOrphans = async () => {
    let stored;
    try {
      stored = await listStoredFiles(folder);
    } catch (e) {
      await alertDialog(`无法扫描原文件:${e instanceof Error ? e.message : e}`);
      return;
    }
    const orphans = computeOrphans(stored, collectReferencedTexts(useLoom.getState().project));
    if (orphans.length === 0) {
      await alertDialog('没有未引用的原文件,无需清理。');
      return;
    }
    const total = orphans.reduce((s, f) => s + (f.size ?? 0), 0);
    const names = orphans.slice(0, 12).map((f) => `· ${f.key}`).join('\n');
    if (!await confirmDialog({
      message: `发现 ${orphans.length} 个未被任何项目 / 快照 / 恢复点引用的原文件${total ? `(共 ${formatSize(total)})` : ''}:\n\n${names}${orphans.length > 12 ? '\n…' : ''}\n\n删除这些文件?此操作不可撤销。`,
      danger: true,
      confirmText: '删除',
    })) return;
    try {
      await deleteStoredFiles(folder, orphans.map((f) => f.key));
    } catch (e) {
      await alertDialog(`清理失败:${e instanceof Error ? e.message : e}`);
    }
    await refreshStored();
  };

  const selectedMissing = selected ? missing(selected) : false;

  return (
    <>
      <NavigatorTree
        module="asset"
        title="资源"
        items={filtered}
        selectedId={selectedId}
        getLabel={(asset) => asset.name}
        getDetail={(asset) => ASSET_KIND_LABEL[asset.kind]}
        onSelect={setSelectedId}
        onMove={(id, folderId) => updateAsset(id, { folderId })}
        onMoveMany={(ids, folderId) => update((p) => {
          const set = new Set(ids);
          for (const a of p.assets) if (set.has(a.id)) { a.folderId = folderId; delete a.order; }
        })}
        onReorder={(_parentId, orderedIds) => update((p) => {
          const map = new Map(orderedIds.map((id, i) => [id, i]));
          for (const a of p.assets) if (map.has(a.id)) a.order = map.get(a.id);
        })}
        onCreate={() => fileRef.current?.click()}
        createLabel="导入资源"
        emptyLabel="还没有资源"
      />

      <div className="pane-col">
        <div className="toolbar">
          <button className="primary" onClick={() => fileRef.current?.click()}>＋ 导入资源</button>
          <input
            ref={fileRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) onPickFiles(e.target.files); e.currentTarget.value = ''; }}
          />
          <input
            ref={repickRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) onRepick(e.target.files); e.currentTarget.value = ''; }}
          />
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as AssetKind | 'all')} style={{ width: 110 }}>
            <option value="all">全部类型</option>
            {KINDS.map((kind) => <option key={kind} value={kind}>{ASSET_KIND_LABEL[kind]}</option>)}
          </select>
          {allTags.length > 0 && (
            <select value={tagFilter ?? ''} onChange={(event) => setTagFilter(event.target.value || null)} style={{ width: 120 }}>
              <option value="">全部标签</option>
              {allTags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
            </select>
          )}
          <input
            placeholder="搜索名称 / 标签 / 来源 / 授权…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 240 }}
          />
          <span className="spacer" style={{ flex: 1 }} />
          <button className="ghost" onClick={cleanupOrphans} title="扫描并删除未被任何项目、快照、恢复点引用的原文件字节">清理未引用原文件</button>
          <span className="hint">{folder ? '原文件保存在项目文件夹 assets/,随文件夹迁移' : '原文件保存在浏览器本地(IndexedDB);绑定项目文件夹后自动落盘'}</span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-hint" style={{ gridColumn: '1/-1' }}>
            <p>这里还没有资源。</p>
            <p style={{ fontSize: 12 }}>点击左上「＋」导入图片 / 音频 / 视频 / 任意文件,原文件将完整保留。</p>
          </div>
        ) : (
          <div className="asset-grid">
            {filtered.map((a) => (
              <div
                key={a.id}
                className={`asset-card ${selectedId === a.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(a.id)}
              >
                <div className="asset-thumb">
                  {a.thumbnail
                    ? <img src={a.thumbnail} alt={a.name} />
                    : <div className="asset-thumb-empty"><Icon name={ASSET_KIND_ICON[a.kind]} size={32} /></div>}
                  {missing(a) && <span className="asset-missing" title="原文件缺失,可在右侧「重新定位」">缺失</span>}
                </div>
                <div className="asset-meta">
                  <div className="asset-name" title={a.name}>{a.name}</div>
                  <div className="asset-sub">
                    <Icon name={ASSET_KIND_ICON[a.kind]} size={11} /> {ASSET_KIND_LABEL[a.kind]} · {formatSize(a.size)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <Inspector>
          <div className="side-head" style={{ padding: '0 0 4px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0 }}>资源属性</h3>
            <span className="spacer" style={{ flex: 1 }} />
            <button
              className="ghost icon-btn"
              title="删除资源(会从所有对象的附件中移除;原文件字节保留,可用「清理未引用原文件」回收)"
              onClick={async () => {
                if (!await confirmDialog({ message: `删除资源「${selected.name}」?\n\n所有对象对它的附件引用都会被清理。原文件字节暂时保留(撤销可完整恢复),之后可用「清理未引用原文件」回收空间。`, danger: true, confirmText: '删除' })) return;
                removeAsset(selected.id);
                setSelectedId(null);
              }}
            ><Icon name="trash" size={14} /></button>
          </div>

          <div className="asset-preview">
            {selected.kind === 'image' && (mediaUrl || selected.thumbnail) && (
              <img src={mediaUrl ?? selected.thumbnail} alt={selected.name} />
            )}
            {selected.kind === 'video' && mediaUrl && (
              <video controls src={mediaUrl} style={{ width: '100%', maxHeight: 220, display: 'block' }} />
            )}
            {selected.kind === 'video' && !mediaUrl && selected.thumbnail && (
              <img src={selected.thumbnail} alt={selected.name} />
            )}
            {selected.kind === 'audio' && mediaUrl && (
              <div style={{ padding: '14px 10px' }}>
                <audio controls src={mediaUrl} style={{ width: '100%' }} />
              </div>
            )}
            {((selected.kind === 'file') ||
              (selected.kind === 'audio' && !mediaUrl) ||
              (selected.kind === 'video' && !mediaUrl && !selected.thumbnail) ||
              (selected.kind === 'image' && !mediaUrl && !selected.thumbnail)) && (
              <div className="asset-preview-empty">
                <Icon name={ASSET_KIND_ICON[selected.kind]} size={48} />
                <span>{ASSET_KIND_LABEL[selected.kind]}</span>
              </div>
            )}
          </div>

          <div className="field">
            <label>原文件</label>
            <div className="asset-file-row">
              {selected.hash
                ? selectedMissing
                  ? <span className="asset-file-state warn">⚠ 缺失 —— 未在{folder ? '项目文件夹 assets/' : '浏览器存储'}中找到</span>
                  : <span className="asset-file-state ok">已保留 · {selected.ext ? `.${selected.ext}` : ''} {formatSize(selected.size)}</span>
                : <span className="asset-file-state">无原文件(旧版本导入,仅缩略图)</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {mediaUrl && (
                <button
                  className="ghost"
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = mediaUrl;
                    a.download = `${selected.name}${selected.ext ? `.${selected.ext}` : ''}`;
                    a.click();
                  }}
                >下载原文件</button>
              )}
              <button
                className="ghost"
                onClick={() => { repickMode.current = 'replace'; repickRef.current?.click(); }}
                title="换成另一个文件;资源 id 与所有引用保持不变"
              >替换文件…</button>
              {(selectedMissing || !selected.hash) && (
                <button
                  className="ghost"
                  onClick={() => { repickMode.current = 'relocate'; repickRef.current?.click(); }}
                  title="选择本机上的原文件;内容哈希一致才会直接关联,不一致时询问是否替换"
                >{selected.hash ? '重新定位…' : '关联原文件…'}</button>
              )}
            </div>
          </div>

          <div className="field">
            <label>名称</label>
            <input value={selected.name} onChange={(e) => updateAsset(selected.id, { name: e.target.value })} />
          </div>
          <TechNameField
            value={selected.technicalName}
            onChange={(v) => updateAsset(selected.id, { technicalName: v })}
            displayName={selected.name}
          />
          <div className="field">
            <label>类型 / 大小</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
              <span className="tag">{ASSET_KIND_LABEL[selected.kind]}</span>
              <span style={{ flex: 1 }}>{selected.mime || '—'}</span>
              <span>{formatSize(selected.size)}</span>
            </div>
          </div>
          <div className="field">
            <label>文件夹</label>
            <FolderSelect module="asset" value={selected.folderId} onChange={(folderId) => updateAsset(selected.id, { folderId })} />
          </div>
          <div className="field">
            <label>来源(URL / 作者 / 出处)</label>
            <input value={selected.source} onChange={(e) => updateAsset(selected.id, { source: e.target.value })} placeholder="https://… 或作者署名" />
          </div>
          <div className="field">
            <label>授权 / 许可</label>
            <input
              value={selected.license ?? ''}
              onChange={(e) => updateAsset(selected.id, { license: e.target.value || undefined })}
              placeholder="如:CC-BY 4.0 / 已购买商用授权 / 自绘"
            />
          </div>
          <div className="field">
            <label>标签</label>
            <input
              value={selected.tags.join(', ')}
              onChange={(e) => updateAsset(selected.id, {
                tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              })}
              placeholder="逗号分隔,如:概念图, 林晚, 第一幕"
            />
          </div>
          <div className="field">
            <label>备注</label>
            <textarea value={selected.notes} rows={5} onChange={(e) => updateAsset(selected.id, { notes: e.target.value })} placeholder="这张图怎么用 / 设计意图 / 待办…" />
          </div>
          <div className="field">
            <label>出现于({refs.length})</label>
            {refs.length === 0 && (
              <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                暂无引用——在实体 / 资料卡 / 流程节点 / 大纲 / 时间线 / 文档块的「附件」里挂接它
              </div>
            )}
            {refs.map((r) => (
              <div
                key={r.key}
                className="ref-item"
                onClick={() => go(r.nav)}
                title={r.snippet}
              >
                <span className="palette-kind">{r.module} · {r.kind}</span>
                <span className="ref-title">{r.title}</span>
              </div>
            ))}
          </div>
        </Inspector>
      )}
    </>
  );
}
