import { useRef, useState } from 'react';
import { useLoom } from '../store';
import { useNav } from '../search';
import { alertDialog, confirmDialog } from '../dialog';
import Icon from './Icon';
import type { Entity } from '../types';
import {
  chatComplete, loadLlmConfig, parseModelJson, PROVIDER_DEFAULTS, PROVIDER_LABEL,
  saveLlmConfig, testLlmConnection, type LlmConfig, type LlmProvider,
} from '../ai/llm';
import {
  applyAiImportPreview, buildAiImportPreview, buildFieldFillPrompt, DEFAULT_EXTRACT_PROMPT,
  normalizeExtracted, normalizeFieldFill, pushAiLog, type AiImportPreview,
} from '../ai/extract';

/* ---------- AI 设置 ---------- */

export function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<LlmConfig>(() => loadLlmConfig());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const switchProvider = (provider: LlmProvider) => {
    setCfg((c) => ({ ...PROVIDER_DEFAULTS[provider], apiKey: c.apiKey }));
    setTestResult(null);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    saveLlmConfig(cfg);
    try {
      const ms = await testLlmConnection(cfg);
      setTestResult(`✓ 连接成功(${ms}ms)`);
    } catch (e) {
      setTestResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
        <div className="sync-head">
          <Icon name="braces" size={14} />
          <span>AI 设置</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          <div className="field">
            <label>服务商</label>
            <select value={cfg.provider} onChange={(e) => switchProvider(e.target.value as LlmProvider)}>
              {(Object.keys(PROVIDER_LABEL) as LlmProvider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
              ))}
            </select>
            <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
              OpenAI 兼容可接 DeepSeek / Moonshot / SiliconFlow 等任意兼容网关;Ollama 为本机模型,需设置 OLLAMA_ORIGINS 允许跨域
            </div>
          </div>
          <div className="field">
            <label>API 地址</label>
            <input value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} placeholder={PROVIDER_DEFAULTS[cfg.provider].baseUrl} />
          </div>
          {cfg.provider !== 'ollama' && (
            <div className="field">
              <label>API Key</label>
              <input
                type="password"
                value={cfg.apiKey}
                onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                placeholder="sk-…"
                autoComplete="off"
              />
              <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
                只保存在本浏览器 / 本机,不写入项目文件,不随云协作同步
              </div>
            </div>
          )}
          <div className="field">
            <label>模型</label>
            <input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder={PROVIDER_DEFAULTS[cfg.provider].model} />
          </div>
          {testResult && (
            <div className="hint" style={{ fontSize: 12, color: testResult.startsWith('✓') ? 'var(--text)' : 'var(--danger)', whiteSpace: 'pre-wrap' }}>
              {testResult}
            </div>
          )}
          <div className="sync-actions">
            <button disabled={testing} onClick={test}>{testing ? '测试中…' : '测试连接'}</button>
            <button className="primary" onClick={() => { saveLlmConfig(cfg); onClose(); }}>保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- AI 长文抽取 ---------- */

export function AiExtractModal({ onClose }: { onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const update = useLoom((s) => s.update);
  const go = useNav((s) => s.go);
  const [text, setText] = useState('');
  const [fileNote, setFileNote] = useState('');
  const [prompt, setPrompt] = useState(() => project.aiPrompts?.extract || DEFAULT_EXTRACT_PROMPT);
  const [showPrompt, setShowPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AiImportPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let combined = text;
    const names: string[] = [];
    for (const f of Array.from(files)) {
      const content = await f.text();
      combined += `${combined ? '\n\n' : ''}# 文件:${f.name}\n\n${content}`;
      names.push(f.name);
    }
    setText(combined);
    setFileNote(`已读入 ${names.length} 个文件:${names.join('、')}`);
  };

  const run = async () => {
    const cfg = loadLlmConfig();
    if (cfg.provider !== 'ollama' && !cfg.apiKey) {
      setError('还没有配置 API Key。请先在「工具 → AI 设置」里完成配置。');
      return;
    }
    setBusy(true);
    setError(null);
    setPreview(null);
    const source = text.slice(0, 200000);
    try {
      const output = await chatComplete(cfg, { system: prompt, user: source });
      const { data, warnings } = normalizeExtracted(parseModelJson(output));
      const built = buildAiImportPreview(project, data, warnings);
      setPreview(built);
      update((p) => pushAiLog(p, {
        provider: cfg.provider, model: cfg.model, purpose: 'extract',
        inChars: source.length, outChars: output.length, ok: true,
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      update((p) => pushAiLog(p, {
        provider: cfg.provider, model: cfg.model, purpose: 'extract',
        inChars: source.length, outChars: 0, ok: false, error: message.slice(0, 200),
      }));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!preview) return;
    update((p) => {
      applyAiImportPreview(p, preview);
      if (prompt !== DEFAULT_EXTRACT_PROMPT) {
        p.aiPrompts = { ...(p.aiPrompts ?? {}), extract: prompt };
      }
    });
    const firstDoc = preview.newDocs[0];
    onClose();
    if (firstDoc) go({ tab: 'documents', docId: firstDoc.id });
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 680 }}>
        <div className="sync-head">
          <Icon name="bulb" size={14} />
          <span>AI 抽取 · 长文 → 实体 / 场景 / 时间线</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body">
          {!preview && (
            <>
              <div className="field">
                <label>源文本(小说 / 剧本 / 设定 / Obsidian 笔记;PDF 请先复制文字粘贴)</label>
                <textarea
                  rows={10}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="把长文粘贴到这里,或用下面的按钮读入 .md / .txt 文件…"
                />
                <div className="hint" style={{ fontSize: 11, marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="ghost" style={{ fontSize: 12 }} onClick={() => fileRef.current?.click()}>
                    <Icon name="upload" size={12} /> 读入 .md / .txt 文件(可多选)
                  </button>
                  <span>{fileNote || `${text.length} 字`}{text.length > 200000 ? '(超出 20 万字的部分会被截断)' : ''}</span>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".md,.txt,.markdown"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => { readFiles(e.target.files); e.target.value = ''; }}
                />
              </div>
              <div className="field">
                <button className="ghost" style={{ alignSelf: 'start', fontSize: 12 }} onClick={() => setShowPrompt((v) => !v)}>
                  {showPrompt ? '▾' : '▸'} 提示词模板(随项目保存,可自定义)
                </button>
                {showPrompt && (
                  <>
                    <textarea rows={8} value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }} />
                    <button className="ghost" style={{ alignSelf: 'start', fontSize: 11 }} onClick={() => setPrompt(DEFAULT_EXTRACT_PROMPT)}>恢复默认</button>
                  </>
                )}
              </div>
              {error && (
                <div className="field">
                  <label style={{ color: 'var(--danger)' }}>抽取失败</label>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--bg-panel)', padding: 10, borderRadius: 6 }}>{error}</pre>
                </div>
              )}
              <div className="sync-actions">
                <button onClick={onClose}>取消</button>
                <button className="primary" disabled={busy || !text.trim()} onClick={run}>
                  {busy ? '抽取中…(长文可能需要一两分钟)' : '开始抽取'}
                </button>
              </div>
            </>
          )}

          {preview && (
            <>
              <div className="field">
                <label>抽取结果 · 确认后才写入项目</label>
                <table className="var-table">
                  <thead><tr><th>对象</th><th>新增</th><th>更新</th><th>跳过</th></tr></thead>
                  <tbody>
                    <AiDiffRow label="实体" v={preview.counts.entities} />
                    <AiDiffRow label="场景文档(AI 初稿)" v={{ add: preview.counts.scenes.add, update: 0, skip: 0 }} />
                    <AiDiffRow label="时间线时间点" v={{ add: preview.counts.timelinePoints.add, update: 0, skip: preview.counts.timelinePoints.skip }} />
                    <AiDiffRow label="时间线事件" v={{ add: preview.counts.timelineEvents.add, update: 0, skip: 0 }} />
                  </tbody>
                </table>
              </div>
              {preview.entityUpdates.length > 0 && (
                <div className="hint" style={{ fontSize: 11 }}>
                  更新只补空白:已有实体仅填充空简介与缺失字段,不覆盖现有内容
                </div>
              )}
              {preview.warnings.length > 0 && (
                <div className="field">
                  <label>提示({preview.warnings.length})</label>
                  <ul className="doc-legend">
                    {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
              {preview.unknownSpeakers.length > 0 && (
                <div className="field">
                  <label>未识别的说话人</label>
                  <div className="card-tags">
                    {preview.unknownSpeakers.map((n) => <span key={n} className="tag">{n}</span>)}
                  </div>
                </div>
              )}
              <div className="player-tip" style={{ marginTop: 8 }}>
                应用不会删除或覆盖任何现有内容。建议先在「工具 → 版本历史」存一个快照,方便回滚。
              </div>
              <div className="sync-actions">
                <button onClick={() => setPreview(null)}>← 返回修改</button>
                <button onClick={onClose}>取消</button>
                <button className="primary" onClick={apply}>应用到项目</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AiDiffRow({ label, v }: { label: string; v: { add: number; update: number; skip: number } }) {
  const zero = v.add === 0 && v.update === 0 && v.skip === 0;
  return (
    <tr style={zero ? { color: 'var(--text-faint)' } : undefined}>
      <td>{label}</td>
      <td>{v.add > 0 ? <b style={{ color: 'var(--diff-add-strong)' }}>+{v.add}</b> : v.add}</td>
      <td>{v.update > 0 ? <b>{v.update}</b> : v.update}</td>
      <td>{v.skip > 0 ? <span style={{ color: 'var(--text-faint)' }}>{v.skip}</span> : v.skip}</td>
    </tr>
  );
}

/* ---------- 实体 AI 补字段 ---------- */

export function AiFillFieldsButton({ entity }: { entity: Entity }) {
  const update = useLoom((s) => s.update);
  const [busy, setBusy] = useState(false);
  const emptyLabels = entity.fields.filter((f) => !f.value.trim() && (f.type ?? 'text') === 'text').map((f) => f.label);

  const run = async () => {
    const cfg = loadLlmConfig();
    if (cfg.provider !== 'ollama' && !cfg.apiKey) {
      await alertDialog('还没有配置 API Key。请先在「工具 → AI 设置」里完成配置。');
      return;
    }
    if (!emptyLabels.length) {
      await alertDialog('该实体没有空缺的文本字段(引用类字段不参与 AI 补写)。');
      return;
    }
    setBusy(true);
    try {
      const { system, user } = buildFieldFillPrompt(entity, emptyLabels);
      const output = await chatComplete(cfg, { system, user, maxTokens: 4096 });
      const fills = normalizeFieldFill(parseModelJson(output), emptyLabels);
      const entries = Object.entries(fills);
      update((p) => pushAiLog(p, {
        provider: cfg.provider, model: cfg.model, purpose: 'fields',
        inChars: user.length, outChars: output.length, ok: true,
      }));
      if (!entries.length) {
        await alertDialog('模型没有为任何字段给出内容(可能缺少足够依据)。');
        return;
      }
      const ok = await confirmDialog({
        message: `AI 建议填写 ${entries.length} 个空字段(只填空白,不覆盖已有内容):\n\n${entries.map(([k, v]) => `${k}:${v}`).join('\n')}`,
        confirmText: '应用',
      });
      if (!ok) return;
      update((p) => {
        const e = p.entities.find((x) => x.id === entity.id);
        if (!e) return;
        for (const [label, value] of entries) {
          const f = e.fields.find((x) => x.label === label && !x.value.trim());
          if (f) f.value = value;
        }
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      update((p) => pushAiLog(p, {
        provider: loadLlmConfig().provider, model: loadLlmConfig().model, purpose: 'fields',
        inChars: 0, outChars: 0, ok: false, error: message.slice(0, 200),
      }));
      await alertDialog(`AI 补字段失败:${message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className="ghost"
      style={{ fontSize: 11, padding: '2px 6px' }}
      disabled={busy}
      title="用 AI 按已有资料补写空缺的文本字段;结果需确认后才写入,只填空白不覆盖"
      onClick={run}
    >
      {busy ? 'AI 思考中…' : '✦ AI 补字段'}
    </button>
  );
}
