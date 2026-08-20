import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../store';
import { useNav } from '../search';
import Icon from './Icon';
import { alertDialog, confirmDialog, promptText } from '../dialog';
import type { EngineExportConfig } from '../types';
import { DEFAULT_ENGINE_EXPORT_GATE } from '../types';
import {
  buildEngineDelta, buildEnginePackage, diffManifests, rulesFromConfig,
  ENGINE_SCHEMA_VERSION, type EngineBaselineFile,
} from '../engine/package';
import { generateTypes } from '../engine/typegen';
import { ENGINE_PACKAGE_SCHEMA, engineReadme } from '../engine/schema';
import {
  BASELINE_SCHEMA, deleteBaseline, loadBaseline, parseBaseline, saveBaseline,
  serializeBaseline, type BaselineSource,
} from '../engine/baseline';
import { runExportGate, type ExportGateReport } from '../engine/gate';
import { buildBundleFiles, type BundleResult } from '../engine/bundle';
import { RUNTIME_AVAILABLE, RUNTIME_SOURCE } from '../engine/runtimeSource';
import { loadAssetBlob } from '../assetFiles';
import { makeZip } from '../interop/zip';
import { formatSize } from '../util';
import { useEscape } from '../hooks/useEscape';
import { toast } from '../toast';

/** 未保存为命名配置时用的临时配置 */
const DRAFT_ID = '__draft__';

function draftConfig(): EngineExportConfig {
  return {
    id: DRAFT_ID,
    name: '未保存的配置',
    gate: { ...DEFAULT_ENGINE_EXPORT_GATE },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const SOURCE_LABEL: Record<BaselineSource, string> = {
  folder: '项目文件夹 engine/',
  local: '本机浏览器',
  legacy: '旧版本记录(导出后升级为配置基线)',
  none: '尚无基线',
};

export default function EngineExportModal({ onClose }: { onClose: () => void }) {
  useEscape(true, onClose);
  const project = useLoom((s) => s.project);
  const slotId = useLoom((s) => s.currentSlotId);
  const folder = useLoom((s) => s.folder);
  const update = useLoom((s) => s.update);
  const go = useNav((s) => s.go);

  const savedConfigs = project.engineExportConfigs;
  const [activeId, setActiveId] = useState<string>(() => savedConfigs?.[0]?.id ?? DRAFT_ID);
  /** 当前编辑中的配置(可能是草稿,也可能是某个命名配置的未保存改动) */
  const [draft, setDraft] = useState<EngineExportConfig>(() => savedConfigs?.[0] ?? draftConfig());

  const [baseline, setBaseline] = useState<EngineBaselineFile | null>(null);
  const [baselineSource, setBaselineSource] = useState<BaselineSource>('none');
  const [gateReport, setGateReport] = useState<ExportGateReport | null>(null);
  /** 上次导出的打包结果:告诉用户实际带走了多少原文件 */
  const [lastBundle, setLastBundle] = useState<BundleResult | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const saved = useMemo(
    () => (savedConfigs ?? []).find((c) => c.id === activeId) ?? null,
    [savedConfigs, activeId],
  );
  const dirty = useMemo(() => {
    if (!saved) return activeId === DRAFT_ID;
    return JSON.stringify({ ...saved, updatedAt: 0 }) !== JSON.stringify({ ...draft, updatedAt: 0 });
  }, [saved, draft, activeId]);

  /** 选中的流程集合;draft.flowIds 缺省表示「全部(含以后新建的)」 */
  const selectedFlowIds = useMemo(
    () => (draft.flowIds ? new Set(draft.flowIds) : new Set(project.flows.map((f) => f.id))),
    [draft.flowIds, project.flows],
  );
  const allFlows = draft.flowIds === undefined;

  const pkg = useMemo(
    () => buildEnginePackage(project, rulesFromConfig(draft)),
    [project, draft],
  );
  const diff = useMemo(
    () => (baseline ? diffManifests(baseline.manifest, pkg.manifest) : null),
    [baseline, pkg],
  );

  const refreshBaseline = useCallback(async (configId: string) => {
    const loaded = await loadBaseline(folder, slotId, configId);
    setBaseline(loaded.baseline);
    setBaselineSource(loaded.source);
  }, [folder, slotId]);

  useEffect(() => { refreshBaseline(activeId); }, [activeId, refreshBaseline]);
  // 改了规则,上次闸门结果就不再代表当前内容
  useEffect(() => { setGateReport(null); }, [draft]);

  const patch = (p: Partial<EngineExportConfig>) => setDraft((d) => ({ ...d, ...p, updatedAt: Date.now() }));

  const toggleFlow = (id: string) => {
    const next = new Set(selectedFlowIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // 全选时回到「全部」语义,让以后新建的流程自动纳入
    patch({ flowIds: next.size === project.flows.length ? undefined : [...next] });
  };

  const patchGate = (p: Partial<NonNullable<EngineExportConfig['gate']>>) =>
    patch({ gate: { ...DEFAULT_ENGINE_EXPORT_GATE, ...(draft.gate ?? {}), ...p } });
  const gate = { ...DEFAULT_ENGINE_EXPORT_GATE, ...(draft.gate ?? {}) };

  const bundle = draft.bundle ?? {};
  const patchBundle = (p: Partial<NonNullable<EngineExportConfig['bundle']>>) =>
    patch({ bundle: { ...bundle, ...p } });
  const selfContained = bundle.assetFiles === true && bundle.runtime === true;
  /** 会随包带走的资源原文件总量,给用户一个体积预期 */
  const bundledAssetBytes = useMemo(
    () => (bundle.assetFiles ? pkg.assets.reduce((sum, a) => sum + (a.fileName ? a.size : 0), 0) : 0),
    [bundle.assetFiles, pkg.assets],
  );

  /* ---------- 配置管理 ---------- */

  const applyConfig = (id: string) => {
    if (id === DRAFT_ID) {
      setActiveId(DRAFT_ID);
      setDraft(draftConfig());
      return;
    }
    const cfg = (savedConfigs ?? []).find((c) => c.id === id);
    if (!cfg) return;
    setActiveId(id);
    setDraft(structuredClone(cfg));
  };

  const saveConfig = async () => {
    if (saved) {
      update((p) => {
        const target = (p.engineExportConfigs ?? []).find((c) => c.id === saved.id);
        if (target) Object.assign(target, { ...draft, id: saved.id, updatedAt: Date.now() });
      });
      return;
    }
    await saveAsConfig();
  };

  const saveAsConfig = async () => {
    const name = await promptText({
      title: '保存导出配置',
      message: '给这套导出规则起个名字,之后可以直接套用。',
      defaultValue: saved ? `${saved.name} 副本` : '默认导出',
    });
    if (!name?.trim()) return;
    const id = uid();
    const cfg: EngineExportConfig = { ...draft, id, name: name.trim(), createdAt: Date.now(), updatedAt: Date.now() };
    update((p) => {
      p.engineExportConfigs ??= [];
      p.engineExportConfigs.push(cfg);
    });
    setActiveId(id);
    setDraft(cfg);
  };

  const renameConfig = async () => {
    if (!saved) return;
    const name = await promptText({ title: '重命名导出配置', message: '新的配置名称', defaultValue: saved.name });
    if (!name?.trim()) return;
    update((p) => {
      const target = (p.engineExportConfigs ?? []).find((c) => c.id === saved.id);
      if (target) { target.name = name.trim(); target.updatedAt = Date.now(); }
    });
    setDraft((d) => ({ ...d, name: name.trim() }));
  };

  const removeConfig = async () => {
    if (!saved) return;
    if (!await confirmDialog({
      message: `删除导出配置「${saved.name}」?它的增量基线也会一并删除,之后需要重新全量导出建立基线。`,
      danger: true,
      confirmText: '删除',
    })) return;
    await deleteBaseline(folder, slotId, saved.id);
    update((p) => {
      p.engineExportConfigs = (p.engineExportConfigs ?? []).filter((c) => c.id !== saved.id);
      if (p.engineExportConfigs.length === 0) delete p.engineExportConfigs;
    });
    applyConfig(DRAFT_ID);
  };

  /* ---------- 闸门 ---------- */

  const runGate = async (): Promise<ExportGateReport> => {
    setRunning(true);
    // 让「检查中」先渲染出来:体检 + 路径遍历在大项目上要秒级
    await new Promise((r) => setTimeout(r, 0));
    try {
      const report = runExportGate(project, draft);
      setGateReport(report);
      return report;
    } finally {
      setRunning(false);
    }
  };

  /** 导出前闸门:阻断项直接拒绝;只有警告时显式确认 */
  const passGate = async (): Promise<boolean> => {
    const report = gateReport ?? await runGate();
    if (!report.ok) {
      await alertDialog({
        title: '导出前检查未通过',
        message: `${report.blocking.length} 个阻断问题、${report.failedTests.length} 个失败测试。\n\n修好后再导出;也可以在「导出前检查」里关掉不需要的检查项。`,
      });
      return false;
    }
    if (report.warnings.length > 0) {
      return await confirmDialog({
        message: `检查通过,但有 ${report.warnings.length} 条警告。仍然导出?`,
        confirmText: '继续导出',
      });
    }
    return true;
  };

  /* ---------- 导出 ---------- */

  const rememberBaseline = async () => {
    const next: EngineBaselineFile = {
      schema: BASELINE_SCHEMA,
      configId: activeId,
      configName: draft.name,
      schemaVersion: ENGINE_SCHEMA_VERSION,
      exportedAt: Date.now(),
      manifest: pkg.manifest,
    };
    const source = await saveBaseline(folder, slotId, next);
    setBaseline(next);
    setBaselineSource(source);
  };

  const exportZip = async () => {
    if (selectedFlowIds.size === 0) {
      await alertDialog('至少选择一个流程。');
      return;
    }
    setBusy(true);
    try {
      if (!await passGate()) return;
      const baseFiles = [
        { name: 'theloom-package.json', content: JSON.stringify(pkg, null, 2) },
        { name: 'theloom-package.schema.json', content: JSON.stringify(ENGINE_PACKAGE_SCHEMA, null, 2) },
        { name: 'theloom-types.d.ts', content: generateTypes(pkg) },
        { name: 'README.md', content: engineReadme(project.name, bundle) },
      ];
      const result: BundleResult = await buildBundleFiles(pkg, baseFiles, {
        bundle,
        runtimeSource: RUNTIME_SOURCE,
        readAssetBytes: async (asset) => {
          const blob = await loadAssetBlob(folder, { hash: asset.hash, ext: asset.ext, mime: asset.mime });
          return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
        },
      });
      // 原文件取不到就如实说,不能让用户以为自包含包是完整的
      if (result.missingAssets.length > 0) {
        const names = result.missingAssets.slice(0, 8).map((m) => `· ${m.name}(${m.reason})`).join('\n');
        const more = result.missingAssets.length > 8 ? `\n…还有 ${result.missingAssets.length - 8} 个` : '';
        if (!await confirmDialog({
          message: `${result.missingAssets.length} 个资源的原文件没能打进包:\n\n${names}${more}\n\n包内会缺这些字节。仍然导出?`,
          confirmText: '仍然导出',
        })) return;
      }
      const zip = await makeZip(result.files);
      download(zip, `${project.name || 'theloom'}-引擎包.zip`);
      toast(`引擎包已导出(${result.files.length} 个文件)`);
      setLastBundle(result);
      await rememberBaseline();
    } finally {
      setBusy(false);
    }
  };

  const exportDelta = async () => {
    if (!baseline) return;
    setBusy(true);
    try {
      const delta = buildEngineDelta(pkg, baseline.manifest);
      const total = delta.changed.flows.length + delta.changed.entities.length +
        delta.changed.assets.length + (delta.changed.variables ? 1 : 0) + delta.removed.length;
      if (total === 0) {
        await alertDialog('与基线相比没有任何变化,无需增量包。');
        return;
      }
      if (!await passGate()) return;
      download(
        new Blob([JSON.stringify(delta, null, 2)], { type: 'application/json' }),
        `${project.name || 'theloom'}-增量.json`,
      );
      toast(`增量包已导出(${total} 处变化)`);
      await rememberBaseline();
    } finally {
      setBusy(false);
    }
  };

  /* ---------- 基线搬运 ---------- */

  const exportBaselineFile = () => {
    if (!baseline) return;
    download(
      new Blob([serializeBaseline(baseline)], { type: 'application/json' }),
      `${project.name || 'theloom'}-${draft.name}-基线.json`,
    );
  };

  const importBaselineFile = async (file: File) => {
    const parsed = parseBaseline(await file.text());
    if (!parsed) {
      await alertDialog('这不是有效的基线文件(需要 TheLoom 导出的 baseline JSON)。');
      return;
    }
    if (parsed.schemaVersion && parsed.schemaVersion !== ENGINE_SCHEMA_VERSION) {
      if (!await confirmDialog({
        message: `这份基线由包版本 ${parsed.schemaVersion} 产出,当前是 ${ENGINE_SCHEMA_VERSION}。\n\n跨版本增量可能不完整,建议先做一次全量导出。仍然导入?`,
      })) return;
    }
    const next: EngineBaselineFile = { ...parsed, configId: activeId, configName: draft.name };
    const source = await saveBaseline(folder, slotId, next);
    setBaseline(next);
    setBaselineSource(source);
  };

  const stats = `${pkg.flows.length} 流程 · ${Object.keys(pkg.index.nodes).length} 节点 · ${pkg.entities.length} 实体 · ${pkg.variables.length} 变量 · ${pkg.assets.length} 资源`;
  const disabled = busy || running;

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 620 }}>
        <div className="sync-head">
          <Icon name="braces" size={14} />
          <span>导出引擎包</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="field">
            <label>导出配置</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={activeId}
                onChange={(e) => applyConfig(e.target.value)}
                style={{ flex: 1, minWidth: 160 }}
              >
                <option value={DRAFT_ID}>未保存的配置</option>
                {(savedConfigs ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button className="ghost" onClick={saveConfig} disabled={!dirty} title={saved ? '把当前规则保存回这个配置' : '保存为命名配置'}>
                保存
              </button>
              <button className="ghost" onClick={saveAsConfig}>另存为…</button>
              {saved && <button className="ghost" onClick={renameConfig}>重命名</button>}
              {saved && <button className="ghost" onClick={removeConfig}>删除</button>}
            </div>
            {dirty && saved && <div className="hint" style={{ marginTop: 4 }}>当前规则与已保存的「{saved.name}」不同,点「保存」写回。</div>}
          </div>

          <div className="field">
            <label>
              包含的流程({selectedFlowIds.size}/{project.flows.length}{allFlows ? ' · 全部,新建流程自动纳入' : ''})
            </label>
            <div className="engine-flow-list">
              {project.flows.map((f) => (
                <label key={f.id} className="engine-flow-row">
                  <input type="checkbox" checked={selectedFlowIds.has(f.id)} onChange={() => toggleFlow(f.id)} />
                  <span>{f.name}</span>
                  {f.technicalName && <span className="hint">#{f.technicalName}</span>}
                </label>
              ))}
            </div>
            {!allFlows && (
              <button className="ghost" style={{ marginTop: 4 }} onClick={() => patch({ flowIds: undefined })}>
                改为「全部流程」
              </button>
            )}
          </div>

          <div className="field">
            <label>导出规则</label>
            <label className="engine-flow-row">
              <input
                type="checkbox"
                checked={draft.entities === 'referenced'}
                onChange={(e) => patch({ entities: e.target.checked ? 'referenced' : 'all' })}
              />
              <span>实体只导被引用的(说话人 + 引用字段闭包)</span>
            </label>
            <label className="engine-flow-row">
              <input
                type="checkbox"
                checked={draft.assets === 'referenced'}
                onChange={(e) => patch({ assets: e.target.checked ? 'referenced' : 'all' })}
              />
              <span>资源只导被挂接的</span>
            </label>
            <label className="engine-flow-row">
              <input
                type="checkbox"
                checked={draft.includeLayout === true}
                onChange={(e) => patch({ includeLayout: e.target.checked })}
              />
              <span>保留画布布局(位置 / 尺寸 / 颜色)</span>
            </label>
            <label className="engine-flow-row">
              <input
                type="checkbox"
                checked={draft.includeAnnotations === true}
                onChange={(e) => patch({ includeAnnotations: e.target.checked })}
              />
              <span>保留注释 / 分区节点</span>
            </label>
          </div>

          <div className="field">
            <label>打包内容{selfContained ? ' · 自包含' : ''}</label>
            <label className="engine-flow-row">
              <input
                type="checkbox"
                checked={bundle.assetFiles === true}
                onChange={(e) => patchBundle({ assetFiles: e.target.checked })}
              />
              <span>
                资源原文件随包(assets/)
                {bundle.assetFiles && bundledAssetBytes > 0 && (
                  <span className="hint"> 约 {formatSize(bundledAssetBytes)}</span>
                )}
              </span>
            </label>
            <label className="engine-flow-row" title={RUNTIME_AVAILABLE ? undefined : '当前构建没有运行库产物,先跑 npm run build:runtime'}>
              <input
                type="checkbox"
                checked={bundle.runtime === true && RUNTIME_AVAILABLE}
                disabled={!RUNTIME_AVAILABLE}
                onChange={(e) => patchBundle({ runtime: e.target.checked })}
              />
              <span>
                运行库随包(theloom-runtime.js)
                {!RUNTIME_AVAILABLE && <span className="hint"> 当前构建不可用</span>}
              </span>
            </label>
            <label className="engine-flow-row">
              <input
                type="checkbox"
                checked={bundle.checksums === true}
                onChange={(e) => patchBundle({ checksums: e.target.checked })}
              />
              <span>校验清单与授权来源表(checksums.json / LICENSES.md)</span>
            </label>
            <div className="hint" style={{ marginTop: 4 }}>
              {selfContained
                ? '自包含:复制到没有 TheLoom 项目文件夹的机器也能加载、演出并读取附件。'
                : '仅数据包:资源原文件与运行库需要另外提供。'}
            </div>
            {lastBundle && (
              <div className="hint" style={{ marginTop: 4 }}>
                上次导出带走 {lastBundle.assetCount} 个原文件({formatSize(lastBundle.assetBytes)})
                {lastBundle.missingAssets.length > 0 ? `,${lastBundle.missingAssets.length} 个缺失` : ''}
              </div>
            )}
          </div>

          <div className="field">
            <label>导出前检查</label>
            <label className="engine-flow-row">
              <input type="checkbox" checked={gate.script !== false} onChange={(e) => patchGate({ script: e.target.checked })} />
              <span>脚本错误</span>
            </label>
            <label className="engine-flow-row">
              <input type="checkbox" checked={gate.audit !== false} onChange={(e) => patchGate({ audit: e.target.checked })} />
              <span>高级体检(跨模块引用、技术名冲突等)</span>
            </label>
            <label className="engine-flow-row">
              <input type="checkbox" checked={gate.paths !== false} onChange={(e) => patchGate({ paths: e.target.checked })} />
              <span>路径测试(不可达 / 卡死 / 死循环)</span>
            </label>
            <label className="engine-flow-row">
              <input type="checkbox" checked={gate.tests !== false} onChange={(e) => patchGate({ tests: e.target.checked })} />
              <span>场景化回归测试</span>
            </label>
            <label className="engine-flow-row">
              <input type="checkbox" checked={gate.blockOnWarnings === true} onChange={(e) => patchGate({ blockOnWarnings: e.target.checked })} />
              <span>警告也阻断导出(默认只提示)</span>
            </label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
              <button className="ghost" onClick={runGate} disabled={disabled}>
                {running ? '检查中…' : '立即检查'}
              </button>
              {gateReport && (
                <span className={`hint ${gateReport.ok ? '' : 'gate-bad'}`}>
                  {gateReport.ok
                    ? `通过 · ${gateReport.warnings.length} 警告 · ${gateReport.testsRun} 测试 · ${gateReport.durationMs}ms`
                    : `${gateReport.blocking.length} 阻断 · ${gateReport.failedTests.length} 测试失败`}
                </span>
              )}
            </div>
            {gateReport && gateReport.skipped.length > 0 && (
              <div className="hint" style={{ marginTop: 4 }}>未检查:{gateReport.skipped.join(' / ')}</div>
            )}
            {gateReport && (gateReport.blocking.length > 0 || gateReport.failedTests.length > 0 || gateReport.warnings.length > 0) && (
              <div className="engine-gate-list">
                {gateReport.blocking.slice(0, 8).map((issue) => (
                  <div
                    key={issue.id}
                    className="engine-gate-row bad"
                    onClick={() => { if (issue.nav) { go(issue.nav); onClose(); } }}
                    title={issue.nav ? '点击跳转到问题位置' : undefined}
                  >
                    <span className="tag">{issue.kind}</span>
                    <span className="engine-gate-msg">{issue.message}</span>
                  </div>
                ))}
                {gateReport.failedTests.slice(0, 5).map((t) => (
                  <div key={t.testId} className="engine-gate-row bad">
                    <span className="tag">测试</span>
                    <span className="engine-gate-msg">
                      {t.name}:{t.error ?? t.results.filter((r) => !r.ok).map((r) => r.detail).join(';')}
                    </span>
                  </div>
                ))}
                {gateReport.warnings.slice(0, 5).map((issue) => (
                  <div
                    key={issue.id}
                    className="engine-gate-row"
                    onClick={() => { if (issue.nav) { go(issue.nav); onClose(); } }}
                  >
                    <span className="tag">{issue.kind}</span>
                    <span className="engine-gate-msg">{issue.message}</span>
                  </div>
                ))}
                {gateReport.blocking.length > 8 && (
                  <div className="hint">还有 {gateReport.blocking.length - 8} 个阻断问题,可在体检面板查看全部。</div>
                )}
              </div>
            )}
          </div>

          <div className="field">
            <label>本次内容</label>
            <div className="hint">{stats}</div>
            <div className="hint" style={{ marginTop: 4 }}>
              增量基线:{SOURCE_LABEL[baselineSource]}
              {baseline?.exportedAt ? ` · 上次导出 ${new Date(baseline.exportedAt).toLocaleString()}` : ''}
            </div>
            {diff && (
              <div className="hint" style={{ marginTop: 4 }}>
                与基线相比:+{diff.added.length} 新增 / ~{diff.changed.length} 变更 / −{diff.removed.length} 删除
              </div>
            )}
            {!diff && <div className="hint" style={{ marginTop: 4 }}>这个配置还没有基线;完成一次导出后即可做增量。</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="ghost" onClick={exportBaselineFile} disabled={!baseline} title="把基线保存为 JSON,交给同事或 CI">
                导出基线 JSON
              </button>
              <button className="ghost" onClick={() => importRef.current?.click()} title="套用别人给的基线,继续做增量">
                导入基线 JSON
              </button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importBaselineFile(f); e.currentTarget.value = ''; }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="primary" onClick={exportZip} disabled={disabled}>
              {busy ? '导出中…' : '导出引擎包 .zip'}
            </button>
            <button onClick={exportDelta} disabled={disabled || !baseline} title={baseline ? '只包含相对基线的新增 / 变更对象与删除键' : '先导出一次完整包建立基线'}>
              导出增量 .json
            </button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            zip 内含:数据包 JSON、JSON Schema、TypeScript 类型定义、使用说明。
            {folder
              ? '增量基线随项目文件夹保存,换机器或多人协作都能续上。'
              : '当前未绑定项目文件夹,基线存在本机;绑定文件夹后基线会随项目走。'}
          </div>
        </div>
      </div>
    </div>
  );
}
