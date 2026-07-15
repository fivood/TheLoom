import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { findAssetRefs, useNav } from '../../search';
import { confirmDialog } from '../../dialog';
import Icon from '../../components/Icon';
import type { Asset, AssetKind } from '../../types';
import { ASSET_KIND_ICON, ASSET_KIND_LABEL } from '../../types';
import { classifyAsset, fileToImageThumb, formatSize } from '../../util';
import TechNameField from '../../components/TechNameField';
import NavigatorTree, { FolderSelect } from '../../components/NavigatorTree';

const KINDS = Object.keys(ASSET_KIND_LABEL) as AssetKind[];

export default function Assets() {
  const project = useLoom((s) => s.project);
  const assets = project.assets;
  const { addAsset, updateAsset, removeAsset, update } = useLoom();
  const go = useNav((s) => s.go);

  const [kindFilter, setKindFilter] = useState<AssetKind | 'all'>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
        a.tags.some((t) => t.toLowerCase().includes(q))),
    );
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }, [assets, kindFilter, tagFilter, query]);

  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const refs = useMemo(
    () => selected ? findAssetRefs(project, selected) : [],
    [project, selected],
  );

  const onPickFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      const kind = classifyAsset(file);
      let thumbnail: string | undefined;
      if (kind === 'image') {
        try { thumbnail = await fileToImageThumb(file); } catch { /* 忽略单张失败 */ }
      }
      const a: Asset = {
        id: uid(),
        folderId: selected?.folderId,
        name: file.name.replace(/\.[^.]+$/, ''),
        kind,
        mime: file.type || 'application/octet-stream',
        thumbnail,
        size: file.size,
        tags: [],
        source: '',
        notes: '',
        createdAt: Date.now(),
      };
      addAsset(a);
    }
  };

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
            accept="image/*,audio/*,video/*"
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) onPickFiles(e.target.files); e.currentTarget.value = ''; }}
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
            placeholder="搜索名称 / 标签 / 来源…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 260 }}
          />
          <span className="hint">图片自动压缩为 256px 缩略图;音频/视频仅在文件夹模式下保留原文件</span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-hint" style={{ gridColumn: '1/-1' }}>
            <p>这里还没有资源。</p>
            <p style={{ fontSize: 12 }}>点击左上「＋」或拖入图片 / 音频 / 视频文件。</p>
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
        <aside className="inspector">
          <div className="side-head" style={{ padding: '0 0 4px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0 }}>资源属性</h3>
            <span className="spacer" style={{ flex: 1 }} />
            <button
              className="ghost icon-btn"
              title="删除资源(会从所有对象的附件中移除)"
              onClick={async () => {
                if (!await confirmDialog({ message: `删除资源「${selected.name}」?\n\n所有对象对它的附件引用都会被清理。`, danger: true, confirmText: '删除' })) return;
                removeAsset(selected.id);
                setSelectedId(null);
              }}
            ><Icon name="trash" size={14} /></button>
          </div>

          <div className="asset-preview">
            {selected.thumbnail
              ? <img src={selected.thumbnail} alt={selected.name} />
              : <div className="asset-preview-empty"><Icon name={ASSET_KIND_ICON[selected.kind]} size={48} /> <span>{ASSET_KIND_LABEL[selected.kind]}</span></div>}
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
        </aside>
      )}
    </>
  );
}
