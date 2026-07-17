import { useMemo, useRef, useState } from 'react';
import { uid, useLoom } from '../store';
import { useNav } from '../search';
import Icon from './Icon';
import { chatComplete, loadLlmConfig, parseModelJson } from '../ai/llm';
import { pushAiLog } from '../ai/extract';
import {
  applyProjectImport, buildGeneratePrompt, buildPlanPrompt, buildProjectImportPreview,
  MATERIAL_KIND_LABEL, MATERIAL_TRUST_LABEL, materialsToText, normalizeGenerated, normalizePlan,
  PROJECT_KIND_LABEL, suggestProjectKind,
  type ImportConfig, type ImportPlan, type MaterialKind, type MaterialTrust,
  type ProjectImportPreview, type ProjectKind, type SourceMaterial,
} from '../ai/projectImport';

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
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [preview, setPreview] = useState<ProjectImportPreview | null>(null);
  const [pipelineWarnings, setPipelineWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const callLlm = async (purpose: 'plan' | 'generate', system: string, user: string, maxTokens: number): Promise<string> => {
    const cfg = loadLlmConfig();
    if (cfg.provider !== 'ollama' && !cfg.apiKey) {
      throw new Error('还没有配置 API Key。请先在「工具 → AI 设置」里完成配置。');
    }
    try {
      const output = await chatComplete(cfg, { system, user, maxTokens });
      update((p) => pushAiLog(p, { provider: cfg.provider, model: cfg.model, purpose, inChars: user.length, outChars: output.length, ok: true }));
      return output;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      update((p) => pushAiLog(p, { provider: cfg.provider, model: cfg.model, purpose, inChars: user.length, outChars: 0, ok: false, error: message.slice(0, 200) }));
      throw e;
    }
  };

  const runPlan = async () => {
    setBusy('正在生成项目计划…(长材料可能需要一两分钟)');
    setError(null);
    try {
      const { text, truncated } = materialsToText(validMaterials);
      const output = await callLlm('plan', buildPlanPrompt(config), text, 8000);
      const { plan: parsed, warnings } = normalizePlan(parseModelJson(output));
      setPlan(parsed);
      setPipelineWarnings([...(truncated ? ['材料超过 20 万字,超出部分未参与分析'] : []), ...warnings]);
      setStep('plan');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runGenerate = async () => {
    if (!plan) return;
    setBusy('正在按计划生成完整候选数据…(这一步最慢,请耐心等待)');
    setError(null);
    try {
      const { text } = materialsToText(validMaterials);
      const output = await callLlm('generate', buildGeneratePrompt(plan, config), text, 32000);
      const { data, warnings } = normalizeGenerated(parseModelJson(output));
      const built = buildProjectImportPreview(project, plan, data, validMaterials, [...pipelineWarnings, ...warnings]);
      setPreview(built);
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const apply = () => {
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
          {busy && <div className="empty-hint" style={{ padding: 20 }}>{busy}</div>}
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
              <div className="player-tip">
                将生成:卷章目录、场景文档(初稿骨架 + 元数据)、实体与关系、角色弧线、伏笔台账、大纲、时间线、
                资料原文备份、待定设定卡、风暴板便签;<b>不生成</b>流程 / 变量 / 条件等游戏机制。<br />
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
              <div className="player-tip" style={{ marginTop: 4 }}>
                只新增、不删除、不覆盖;同名实体仅补空白。建议先在「工具 → 版本历史」存一个快照。
              </div>
              <div className="sync-actions">
                <button onClick={() => setStep('plan')}>← 返回计划</button>
                <button onClick={onClose}>取消</button>
                <button className="primary" onClick={apply}>事务式导入</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
