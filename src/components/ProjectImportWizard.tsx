import { useEffect, useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../store';
import { useNav } from '../search';
import Icon from './Icon';
import { chatComplete, llmHasCredential, loadLlmConfig, parseModelJson } from '../ai/llm';
import { pushAiLog } from '../ai/extract';
import {
  applyProjectImport, buildGeneratePrompt, buildPlanPrompt, buildProjectImportPreview,
  MATERIAL_KIND_LABEL, MATERIAL_TRUST_LABEL, materialsToText, normalizeGenerated, normalizePlan,
  PROJECT_KIND_LABEL, suggestProjectKind,
  type ImportConfig, type ImportPlan, type MaterialKind, type MaterialTrust,
  type ProjectImportPreview, type ProjectKind, type SourceMaterial,
} from '../ai/projectImport';
import {
  applyInteractiveImport, BRANCH_DENSITY_LABEL, buildInteractiveGeneratePrompt,
  buildInteractiveImportPreview, buildInteractivePlanPrompt, defaultInteractiveOptions,
  FAIL_MODE_LABEL, normalizeInteractiveGenerated, normalizeInteractivePlan, verifyInteractiveImport,
  type InteractiveExtrasPlan, type InteractiveImportPreview, type InteractiveOptions, type InteractiveVerification,
} from '../ai/interactiveImport';

type Step = 'materials' | 'config' | 'plan' | 'preview';
const STEP_LABEL: Record<Step, string> = {
  materials: '① 材料', config: '② 配置', plan: '③ 生成计划', preview: '④ 预检导入',
};

function blankMaterial(kind: MaterialKind = 'manuscript'): SourceMaterial {
  return { id: uid(), name: '', kind, trust: 'normal', text: '' };
}

export default function ProjectImportWizard({ onClose }: { onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const update = useLoom((s) => s.update);
  const go = useNav((s) => s.go);

  const [step, setStep] = useState<Step>('materials');
  const [materials, setMaterials] = useState<SourceMaterial[]>([blankMaterial()]);
  const [config, setConfig] = useState<ImportConfig>({ projectKind: 'novel' });
  const [iOptions, setIOptions] = useState<InteractiveOptions>(defaultInteractiveOptions);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [extras, setExtras] = useState<InteractiveExtrasPlan | null>(null);
  const [preview, setPreview] = useState<ProjectImportPreview | null>(null);
  const [iPreview, setIPreview] = useState<InteractiveImportPreview | null>(null);
  const [verification, setVerification] = useState<InteractiveVerification | null>(null);
  const [pipelineWarnings, setPipelineWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const interactive = config.projectKind === 'interactive';

  useEffect(() => () => abortRef.current?.abort(), []);

  const validMaterials = useMemo(() => materials.filter((m) => m.text.trim()), [materials]);
  const totalChars = useMemo(() => validMaterials.reduce((s, m) => s + m.text.length, 0), [validMaterials]);
  const suggestion = useMemo(() => suggestProjectKind(validMaterials), [validMaterials]);

  const patchMaterial = (id: string, patch: Partial<SourceMaterial>) =>
    setMaterials((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: SourceMaterial[] = [];
    for (const f of Array.from(files)) {
      added.push({ id: uid(), name: f.name.replace(/\.(md|txt|markdown)$/i, ''), kind: 'manuscript', trust: 'normal', text: await f.text() });
    }
    setMaterials((ms) => [...ms.filter((m) => m.text.trim() || m.name.trim()), ...added]);
  };

  const callLlm = async (purpose: 'plan' | 'generate', system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<string> => {
    const cfg = loadLlmConfig();
    if (!llmHasCredential(cfg)) {
      throw new Error('还没有配置 API Key。请先在「工具 → AI 设置」里完成配置。');
    }
    try {
      const output = await chatComplete(cfg, { system, user, maxTokens, signal });
      update((p) => pushAiLog(p, { provider: cfg.provider, model: cfg.model, purpose, inChars: user.length, outChars: output.length, ok: true }));
      return output;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      update((p) => pushAiLog(p, { provider: cfg.provider, model: cfg.model, purpose, inChars: user.length, outChars: 0, ok: false, error: message.slice(0, 200) }));
      throw e;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const isAbort = (e: unknown) => (e instanceof DOMException && e.name === 'AbortError')
    || (e instanceof Error && (e.message.includes('已取消') || e.message.includes('cancelled') || e.message.includes('aborted')));

  const runPlan = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy('正在生成项目计划…(长材料可能需要一两分钟;可随时停止)');
    setError(null);
    try {
      const { text, truncated } = materialsToText(validMaterials);
      const truncWarn = truncated ? ['材料超过 20 万字,超出部分未参与分析'] : [];
      if (interactive) {
        const output = await callLlm('plan', buildInteractivePlanPrompt(iOptions), text, 8000, controller.signal);
        const { plan: parsed, extras: ext, warnings } = normalizeInteractivePlan(parseModelJson(output));
        setPlan(parsed);
        setExtras(ext);
        setPipelineWarnings([...truncWarn, ...warnings]);
      } else {
        const output = await callLlm('plan', buildPlanPrompt(config), text, 8000, controller.signal);
        const { plan: parsed, warnings } = normalizePlan(parseModelJson(output));
        setPlan(parsed);
        setExtras(null);
        setPipelineWarnings([...truncWarn, ...warnings]);
      }
      setStep('plan');
    } catch (e) {
      if (isAbort(e)) setError('已停止:未收到模型响应,可修改材料或提示词后重试');
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(null);
    }
  };

  const runGenerate = async () => {
    if (!plan) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(interactive
      ? '正在生成互动候选数据并执行脚本 / 引用 / 路径验收…(这一步最慢;可随时停止)'
      : '正在按计划生成完整候选数据…(这一步最慢;可随时停止)');
    setError(null);
    try {
      const { text } = materialsToText(validMaterials);
      if (interactive && extras) {
        const output = await callLlm('generate', buildInteractiveGeneratePrompt(plan, extras, iOptions), text, 32000, controller.signal);
        const { data, warnings } = normalizeInteractiveGenerated(parseModelJson(output));
        const built = buildInteractiveImportPreview(project, plan, extras, data, validMaterials, [...pipelineWarnings, ...warnings]);
        setIPreview(built);
        setVerification(verifyInteractiveImport(project, built));
        setPreview(built.base);
      } else {
        const output = await callLlm('generate', buildGeneratePrompt(plan, config), text, 32000, controller.signal);
        const { data, warnings } = normalizeGenerated(parseModelJson(output));
        const built = buildProjectImportPreview(project, plan, data, validMaterials, [...pipelineWarnings, ...warnings]);
        setPreview(built);
        setIPreview(null);
        setVerification(null);
      }
      setStep('preview');
    } catch (e) {
      if (isAbort(e)) setError('已停止:未收到模型响应,可返回上一步重试');
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(null);
    }
  };

  const apply = () => {
    if (interactive && iPreview) {
      if (verification?.status === 'blocked') return;
      update((p) => applyInteractiveImport(p, iPreview));
      const firstFlow = iPreview.newFlows[0];
      onClose();
      if (firstFlow) go({ tab: 'flow', flowId: firstFlow.id });
      return;
    }
    if (!preview) return;
    update((p) => applyProjectImport(p, preview));
    const firstDoc = preview.newDocs[0];
    onClose();
    if (firstDoc) go({ tab: 'documents', docId: firstDoc.id });
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 760, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div className="sync-head">
          <Icon name="archive" size={14} />
          <span>完整项目导入(小说版)· {STEP_LABEL[step]}</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body" style={{ overflowY: 'auto' }}>
          {busy && (
            <div className="empty-hint" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div>{busy}</div>
              <button onClick={cancel}>停止</button>
            </div>
          )}
          {error && (
            <div className="field">
              <label style={{ color: 'var(--danger)' }}>出错了</label>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--bg-panel)', padding: 10, borderRadius: 6 }}>{error}</pre>
            </div>
          )}

          {step === 'materials' && !busy && (
            <>
              <div className="hint" style={{ fontSize: 12 }}>
                把正文、设定、笔记、AI 咨询记录分成多份材料输入,并标注类型与可信度 ——
                计划与冲突仲裁会依赖这些标注(正文权威,草案与 AI 记录只进待定,不定稿)。
              </div>
              {materials.map((m) => (
                <div key={m.id} className="field" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input value={m.name} onChange={(e) => patchMaterial(m.id, { name: e.target.value })} placeholder="材料名称(如:第一卷正文)" style={{ flex: 1 }} />
                    <select value={m.kind} onChange={(e) => patchMaterial(m.id, { kind: e.target.value as MaterialKind })} style={{ width: 120 }}>
                      {(Object.keys(MATERIAL_KIND_LABEL) as MaterialKind[]).map((k) => <option key={k} value={k}>{MATERIAL_KIND_LABEL[k]}</option>)}
                    </select>
                    <select value={m.trust} onChange={(e) => patchMaterial(m.id, { trust: e.target.value as MaterialTrust })} style={{ width: 140 }}>
                      {(Object.keys(MATERIAL_TRUST_LABEL) as MaterialTrust[]).map((t) => <option key={t} value={t}>{MATERIAL_TRUST_LABEL[t]}</option>)}
                    </select>
                    <button className="ghost icon-btn" title="移除材料" onClick={() => setMaterials((ms) => ms.filter((x) => x.id !== m.id))}>×</button>
                  </div>
                  <textarea rows={4} value={m.text} onChange={(e) => patchMaterial(m.id, { text: e.target.value })} placeholder="粘贴这份材料的内容…(PDF 请复制文字)" />
                  <div className="hint" style={{ fontSize: 11, marginTop: 2 }}>{m.text.length} 字</div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="ghost" onClick={() => setMaterials((ms) => [...ms, blankMaterial('setting')])}>＋ 添加材料</button>
                <button className="ghost" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={12} /> 读入 .md / .txt(每个文件一份材料)
                </button>
                <span className="hint" style={{ fontSize: 11, alignSelf: 'center' }}>
                  合计 {totalChars} 字{totalChars > 200000 ? '(超出 20 万字部分会被截断)' : ''}
                </span>
              </div>
              <input ref={fileRef} type="file" accept=".md,.txt,.markdown" multiple style={{ display: 'none' }}
                onChange={(e) => { readFiles(e.target.files); e.target.value = ''; }} />
              <div className="sync-actions">
                <button onClick={onClose}>取消</button>
                <button className="primary" disabled={!validMaterials.length} onClick={() => setStep('config')}>下一步:配置 →</button>
              </div>
            </>
          )}

          {step === 'config' && !busy && (
            <>
              <div className="field">
                <label>项目类型(建议:{PROJECT_KIND_LABEL[suggestion.kind]} —— {suggestion.reason})</label>
                {(Object.keys(PROJECT_KIND_LABEL) as ProjectKind[]).map((k) => (
                  <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                    <input type="radio" name="projectKind" checked={config.projectKind === k} onChange={() => setConfig({ projectKind: k })} />
                    {PROJECT_KIND_LABEL[k]}
                  </label>
                ))}
              </div>
              {interactive && (
                <div className="field" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                  <label>互动配置</label>
                  <div className="kv-row">
                    <div className="field" style={{ flex: 1 }}>
                      <label>分支密度</label>
                      <select value={iOptions.branchDensity} onChange={(e) => setIOptions({ ...iOptions, branchDensity: e.target.value as InteractiveOptions['branchDensity'] })}>
                        {(Object.keys(BRANCH_DENSITY_LABEL) as InteractiveOptions['branchDensity'][]).map((k) => (
                          <option key={k} value={k}>{BRANCH_DENSITY_LABEL[k]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field" style={{ flex: 1 }}>
                      <label>目标结局数</label>
                      <input
                        type="number" min={1} max={6}
                        value={iOptions.endings}
                        onChange={(e) => setIOptions({ ...iOptions, endings: Math.max(1, Math.min(6, Math.floor(Number(e.target.value) || 1))) })}
                      />
                    </div>
                  </div>
                  <div className="kv-row">
                    <div className="field" style={{ flex: 1 }}>
                      <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={iOptions.useChecks} onChange={(e) => setIOptions({ ...iOptions, useChecks: e.target.checked })} />
                        使用 2d6 检定节点
                      </label>
                    </div>
                    <div className="field" style={{ flex: 1 }}>
                      <label>失败回路</label>
                      <select value={iOptions.failMode} onChange={(e) => setIOptions({ ...iOptions, failMode: e.target.value as InteractiveOptions['failMode'] })}>
                        {(Object.keys(FAIL_MODE_LABEL) as InteractiveOptions['failMode'][]).map((k) => (
                          <option key={k} value={k}>{FAIL_MODE_LABEL[k]}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
              <div className="player-tip">
                {interactive ? (
                  <>
                    将生成:卷章文档、实体、时间线等内容结构,<b>外加</b>流程节点 / 选择 / 变量 / 条件指令与结局。<br />
                    生成结果必须通过脚本类型检查、高级体检与路径测试(不可达 / 死循环 / 卡死),
                    且每个结局至少有一条可达路径,否则不允许导入。
                  </>
                ) : (
                  <>
                    将生成:卷章目录、场景文档(初稿骨架 + 元数据)、实体与关系、角色弧线、伏笔台账、大纲、时间线、
                    资料原文备份、待定设定卡、风暴板便签;<b>不生成</b>流程 / 变量 / 条件等游戏机制。
                  </>
                )}<br />
                建议在<b>空白项目槽位</b>中使用;导入不会删除或覆盖任何现有内容,且整体可一步撤销。
              </div>
              <div className="sync-actions">
                <button onClick={() => setStep('materials')}>← 返回材料</button>
                <button className="primary" onClick={runPlan}>生成项目计划 →</button>
              </div>
            </>
          )}

          {step === 'plan' && plan && !busy && (
            <>
              <div className="field">
                <label>项目生成计划 · 请审阅(生成阶段将严格按此结构执行)</label>
                <div style={{ fontSize: 13 }}>
                  <b>{plan.projectName}</b>
                  {plan.summary && <div className="hint" style={{ fontSize: 12, margin: '4px 0' }}>{plan.summary}</div>}
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 12 }}>
                  {plan.volumes.map((v, vi) => (
                    <div key={vi} style={{ marginBottom: 6 }}>
                      <b>{v.title}</b>
                      {v.chapters.map((c, ci) => (
                        <div key={ci} style={{ paddingLeft: 14 }}>
                          {c.title}
                          <span className="hint" style={{ fontSize: 11 }}>({c.scenes.length} 场:{c.scenes.slice(0, 3).join(' / ')}{c.scenes.length > 3 ? '…' : ''})</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>实体清单({plan.entities.length})</label>
                <div className="card-tags">
                  {plan.entities.slice(0, 30).map((e) => <span key={e.name} className="tag" title={e.brief}>{e.name}</span>)}
                  {plan.entities.length > 30 && <span className="hint" style={{ fontSize: 11 }}>…等 {plan.entities.length} 个</span>}
                </div>
              </div>
              {interactive && extras && (
                <>
                  <div className="field">
                    <label>变量({extras.variables.length})· 驱动分支与结局</label>
                    <table className="var-table">
                      <thead><tr><th>变量</th><th>类型</th><th>初始值</th><th>用途</th></tr></thead>
                      <tbody>
                        {extras.variables.map((v) => (
                          <tr key={v.name}><td><code>{v.name}</code></td><td>{v.type}</td><td>{v.value}</td><td className="hint">{v.description}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="field">
                    <label>结局({extras.endings.length})· 每个结局都会验收可达性</label>
                    <ul className="doc-legend">
                      {extras.endings.map((e) => (
                        <li key={e.technicalName}><b>{e.title}</b> <code style={{ fontSize: 10 }}>{e.technicalName}</code>{e.summary && ` —— ${e.summary}`}</li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
              {plan.pending.length > 0 && (
                <div className="field">
                  <label>待定问题({plan.pending.length})· 不会被擅自定稿,导入后见「待定设定」资料卡</label>
                  <ul className="doc-legend">
                    {plan.pending.map((p, i) => <li key={i}><b>{p.topic}</b>{p.options.length > 0 && `:${p.options.map((o) => o.claim).join(' / ')}`}</li>)}
                  </ul>
                </div>
              )}
              {pipelineWarnings.length > 0 && (
                <div className="field">
                  <label>提示</label>
                  <ul className="doc-legend">{pipelineWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
              <div className="sync-actions">
                <button onClick={() => setStep('config')}>← 返回配置</button>
                <button onClick={runPlan}>↻ 重新生成计划</button>
                <button className="primary" onClick={runGenerate}>按计划生成完整数据 →</button>
              </div>
            </>
          )}

          {step === 'preview' && preview && !busy && (
            <>
              <div className="field">
                <label>完整差异预检 · 确认后单次事务导入(Ctrl+Z 可整体回滚)</label>
                <table className="var-table">
                  <thead><tr><th>模块</th><th>新增</th><th>更新</th><th>跳过</th></tr></thead>
                  <tbody>
                    {Object.entries(preview.counts).map(([label, v]) => {
                      const zero = v.add === 0 && v.update === 0 && v.skip === 0;
                      return (
                        <tr key={label} style={zero ? { color: 'var(--text-faint)' } : undefined}>
                          <td>{label}</td>
                          <td>{v.add > 0 ? <b style={{ color: 'var(--diff-add-strong)' }}>+{v.add}</b> : v.add}</td>
                          <td>{v.update > 0 ? <b>{v.update}</b> : v.update}</td>
                          <td>{v.skip > 0 ? <span style={{ color: 'var(--text-faint)' }}>{v.skip}</span> : v.skip}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {preview.pending.length > 0 && (
                <div className="field">
                  <label>待定设定({preview.pending.length})· 已生成置顶资料卡与风暴板便签,由你定夺</label>
                  <ul className="doc-legend">
                    {preview.pending.map((p, i) => <li key={i}>{p.topic}</li>)}
                  </ul>
                </div>
              )}
              {preview.warnings.length > 0 && (
                <div className="field">
                  <label>提示({preview.warnings.length})</label>
                  <ul className="doc-legend">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
              {interactive && verification && (
                <div
                  className="field"
                  style={{
                    border: `1px solid ${verification.status === 'blocked' ? 'var(--danger)' : 'var(--border)'}`,
                    borderRadius: 8, padding: 10,
                  }}
                >
                  <label style={{ color: verification.status === 'blocked' ? 'var(--danger)' : undefined }}>
                    互动验收 · {verification.status === 'pass' ? '✓ 全部通过' : verification.status === 'warning' ? '△ 有警告(可导入)' : '✗ 未通过(不能导入)'}
                  </label>
                  <table className="var-table">
                    <tbody>
                      <tr><td>新增脚本 / 体检错误</td><td style={{ color: verification.summary.newAuditErrors ? 'var(--danger)' : undefined }}>{verification.summary.newAuditErrors}</td></tr>
                      <tr><td>新增警告</td><td>{verification.summary.newAuditWarnings}</td></tr>
                      <tr>
                        <td>结局可达</td>
                        <td style={{ color: verification.summary.unreachableEndings.length ? 'var(--danger)' : 'var(--diff-add-strong)' }}>
                          {verification.summary.endingsChecked - verification.summary.unreachableEndings.length} / {verification.summary.endingsChecked}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {verification.issues.length > 0 && (
                    <ul className="doc-legend" style={{ marginTop: 6 }}>
                      {verification.issues.slice(0, 25).map((i, idx) => (
                        <li key={idx} style={i.severity === 'error' ? { color: 'var(--danger)' } : undefined}>{i.message}</li>
                      ))}
                      {verification.issues.length > 25 && <li>…以及另外 {verification.issues.length - 25} 条</li>}
                    </ul>
                  )}
                  {verification.status === 'blocked' && (
                    <div className="hint" style={{ fontSize: 12, marginTop: 6 }}>
                      生成结果没有通过验收(路径卡死 / 死循环 / 脚本错误 / 结局不可达都会阻断)。
                      可以「返回计划」调整后重新生成,验收通过才会出现导入按钮。
                    </div>
                  )}
                </div>
              )}
              <div className="player-tip" style={{ marginTop: 4 }}>
                只新增、不删除、不覆盖;同名实体仅补空白。建议先在「工具 → 版本历史」存一个快照。
              </div>
              <div className="sync-actions">
                <button onClick={() => setStep('plan')}>← 返回计划</button>
                {interactive && <button onClick={runGenerate}>↻ 重新生成</button>}
                <button onClick={onClose}>取消</button>
                {(!interactive || verification?.status !== 'blocked') && (
                  <button className="primary" onClick={apply}>事务式导入</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
