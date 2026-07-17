import { useMemo, useState } from 'react';
import { useLoom } from '../store';
import Icon from './Icon';
import { alertDialog } from '../dialog';
import {
  buildEngineDelta, buildEnginePackage, diffManifests, type EngineExportRules,
} from '../engine/package';
import { generateTypes } from '../engine/typegen';
import { ENGINE_PACKAGE_SCHEMA, engineReadme } from '../engine/schema';
import { makeZip } from '../interop/zip';

const manifestKey = (slotId: string) => `theloom-engine-manifest-${slotId}`;

function readLastManifest(slotId: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(manifestKey(slotId));
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch { /* 忽略 */ }
  return null;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function EngineExportModal({ onClose }: { onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const slotId = useLoom((s) => s.currentSlotId);

  const [flowIds, setFlowIds] = useState<Set<string>>(() => new Set(project.flows.map((f) => f.id)));
  const [includeLayout, setIncludeLayout] = useState(false);
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [referencedEntities, setReferencedEntities] = useState(false);
  const [referencedAssets, setReferencedAssets] = useState(false);
  const [lastManifest, setLastManifest] = useState<Record<string, string> | null>(() => readLastManifest(slotId));

  const rules: EngineExportRules = useMemo(() => ({
    flowIds: flowIds.size === project.flows.length ? undefined : [...flowIds],
    includeLayout,
    includeAnnotations,
    entities: referencedEntities ? 'referenced' : 'all',
    assets: referencedAssets ? 'referenced' : 'all',
  }), [flowIds, includeLayout, includeAnnotations, referencedEntities, referencedAssets, project.flows.length]);

  const pkg = useMemo(() => buildEnginePackage(project, rules), [project, rules]);
  const diff = useMemo(
    () => (lastManifest ? diffManifests(lastManifest, pkg.manifest) : null),
    [lastManifest, pkg],
  );

  const toggleFlow = (id: string) => {
    setFlowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rememberManifest = () => {
    try {
      localStorage.setItem(manifestKey(slotId), JSON.stringify(pkg.manifest));
      setLastManifest(pkg.manifest);
    } catch { /* 清单记不下不阻塞导出 */ }
  };

  const exportZip = async () => {
    if (flowIds.size === 0) {
      await alertDialog('至少选择一个流程。');
      return;
    }
    const zip = await makeZip([
      { name: 'theloom-package.json', content: JSON.stringify(pkg, null, 2) },
      { name: 'theloom-package.schema.json', content: JSON.stringify(ENGINE_PACKAGE_SCHEMA, null, 2) },
      { name: 'theloom-types.d.ts', content: generateTypes(pkg) },
      { name: 'README.md', content: engineReadme(project.name) },
    ]);
    download(zip, `${project.name || 'theloom'}-引擎包.zip`);
    rememberManifest();
  };

  const exportDelta = async () => {
    if (!lastManifest) return;
    const delta = buildEngineDelta(pkg, lastManifest);
    const total = delta.changed.flows.length + delta.changed.entities.length +
      delta.changed.assets.length + (delta.changed.variables ? 1 : 0) + delta.removed.length;
    if (total === 0) {
      await alertDialog('与上次导出相比没有任何变化,无需增量包。');
      return;
    }
    download(
      new Blob([JSON.stringify(delta, null, 2)], { type: 'application/json' }),
      `${project.name || 'theloom'}-增量.json`,
    );
    rememberManifest();
  };

  const stats = `${pkg.flows.length} 流程 · ${Object.keys(pkg.index.nodes).length} 节点 · ${pkg.entities.length} 实体 · ${pkg.variables.length} 变量 · ${pkg.assets.length} 资源`;

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <div className="sync-head">
          <Icon name="braces" size={14} />
          <span>导出引擎包</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="field">
            <label>包含的流程({flowIds.size}/{project.flows.length})</label>
            <div className="engine-flow-list">
              {project.flows.map((f) => (
                <label key={f.id} className="engine-flow-row">
                  <input type="checkbox" checked={flowIds.has(f.id)} onChange={() => toggleFlow(f.id)} />
                  <span>{f.name}</span>
                  {f.technicalName && <span className="hint">#{f.technicalName}</span>}
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label>导出规则</label>
            <label className="engine-flow-row">
              <input type="checkbox" checked={referencedEntities} onChange={(e) => setReferencedEntities(e.target.checked)} />
              <span>实体只导被引用的(说话人 + 引用字段闭包)</span>
            </label>
            <label className="engine-flow-row">
              <input type="checkbox" checked={referencedAssets} onChange={(e) => setReferencedAssets(e.target.checked)} />
              <span>资源只导被挂接的</span>
            </label>
            <label className="engine-flow-row">
              <input type="checkbox" checked={includeLayout} onChange={(e) => setIncludeLayout(e.target.checked)} />
              <span>保留画布布局(位置 / 尺寸 / 颜色)</span>
            </label>
            <label className="engine-flow-row">
              <input type="checkbox" checked={includeAnnotations} onChange={(e) => setIncludeAnnotations(e.target.checked)} />
              <span>保留注释 / 分区节点</span>
            </label>
          </div>

          <div className="field">
            <label>本次内容</label>
            <div className="hint">{stats}</div>
            {diff && (
              <div className="hint" style={{ marginTop: 4 }}>
                与上次导出相比:+{diff.added.length} 新增 / ~{diff.changed.length} 变更 / −{diff.removed.length} 删除
              </div>
            )}
            {!diff && <div className="hint" style={{ marginTop: 4 }}>本项目还没有导出记录;导出后将记录内容哈希清单,供增量导出对比。</div>}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="primary" onClick={exportZip}>
              导出引擎包 .zip
            </button>
            <button onClick={exportDelta} disabled={!lastManifest} title={lastManifest ? '只包含相对上次导出的新增 / 变更对象与删除键' : '先导出一次完整包'}>
              导出增量 .json
            </button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            zip 内含:数据包 JSON、JSON Schema、TypeScript 类型定义、使用说明。
            配合独立运行库 theloom-runtime 可在任何 JS 环境按编辑器语义演出对白流程。
          </div>
        </div>
      </div>
    </div>
  );
}
