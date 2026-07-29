import { useMemo, useState } from 'react';
import { useLoom } from '../store';
import { useNav } from '../search';
import { confirmDialog, promptText } from '../dialog';
import { flowFingerprint, findTestFlow, isTestStale, runAllFlowTests, type FlowTestResult } from '../flowTest';
import type { FlowTest } from '../types';

/**
 * R19-4 场景化回归测试面板。
 *
 * 测试是从演出里录下来的(演出工具栏「⛿ 存为测试」),这里负责批量重跑、
 * 看覆盖率、补断言,以及提示哪些测试因为流程被改过而可能已过时。
 */
export default function FlowTestPanel({ onClose }: { onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const update = useLoom((s) => s.update);
  const go = useNav((s) => s.go);
  const tests = project.flowTests ?? [];
  const [results, setResults] = useState<FlowTestResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map((results ?? []).map((r) => [r.testId, r])),
    [results],
  );
  const summary = useMemo(() => {
    if (!results) return null;
    const pass = results.filter((r) => r.ok).length;
    const nodeRate = results.length === 0 ? 1
      : results.reduce((a, r) => a + r.coverage.nodeRate, 0) / results.length;
    const edgeRate = results.length === 0 ? 1
      : results.reduce((a, r) => a + r.coverage.edgeRate, 0) / results.length;
    return { pass, total: results.length, nodeRate, edgeRate };
  }, [results]);

  const runAll = () => {
    setRunning(true);
    // 让出一帧再跑:测试多时先把「运行中」画出来
    setTimeout(() => {
      setResults(runAllFlowTests(useLoom.getState().project));
      setRunning(false);
    }, 0);
  };

  /** 重跑后把当前流程内容记为基准,清掉「受影响」标记 */
  const acceptCurrent = (test: FlowTest) => {
    update((p) => {
      const t = (p.flowTests ?? []).find((x) => x.id === test.id);
      const flow = findTestFlow(p, test.flowRef);
      if (t && flow) { t.flowHash = flowFingerprint(flow); t.updatedAt = Date.now(); }
    });
  };

  const remove = async (test: FlowTest) => {
    if (!await confirmDialog({ message: `删除回归测试「${test.name}」?`, danger: true, confirmText: '删除' })) return;
    update((p) => {
      p.flowTests = (p.flowTests ?? []).filter((x) => x.id !== test.id);
      if (p.flowTests.length === 0) delete p.flowTests;
    });
  };

  const rename = async (test: FlowTest) => {
    const name = await promptText({ message: '测试名称', defaultValue: test.name, confirmText: '保存' });
    if (name === null || !name.trim()) return;
    update((p) => {
      const t = (p.flowTests ?? []).find((x) => x.id === test.id);
      if (t) { t.name = name.trim(); t.updatedAt = Date.now(); }
    });
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette audit-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <span>回归测试({tests.length})</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="audit-body">
          <div className="audit-filters" style={{ marginBottom: 8 }}>
            <button className="primary" disabled={running || tests.length === 0} onClick={runAll}>
              {running ? '运行中…' : '▶ 全部运行'}
            </button>
            {summary && (
              <span className="hint" style={{ fontSize: 12 }}>
                通过 {summary.pass}/{summary.total}
                &nbsp;·&nbsp; 节点覆盖 {Math.round(summary.nodeRate * 100)}%
                &nbsp;·&nbsp; 连线覆盖 {Math.round(summary.edgeRate * 100)}%
              </span>
            )}
          </div>

          {tests.length === 0 && (
            <div className="empty-hint" style={{ padding: '16px 0' }}>
              还没有回归测试。在流程「演出」里走一遍想固化的路线,点工具栏的
              「⛿ 存为测试」——种子、选择序列与事件响应都会记下来,之后流程一改就能重跑。
            </div>
          )}

          {tests.map((t) => {
            const r = byId.get(t.id);
            const stale = isTestStale(project, t);
            const open = openId === t.id;
            return (
              <div key={t.id} className="audit-section">
                <div className="kv-row" style={{ alignItems: 'center', gap: 8 }}>
                  <span className={`flowtest-badge ${r ? (r.ok ? 'pass' : 'fail') : 'idle'}`}>
                    {r ? (r.ok ? '通过' : '失败') : '未运行'}
                  </span>
                  <b style={{ flex: 1 }}>{t.name}</b>
                  {stale && (
                    <span className="flowtest-stale" title="目标流程在上次记录之后被改过,结果可能已过时">
                      受影响
                    </span>
                  )}
                  <span className="hint" style={{ fontSize: 11 }}>
                    {t.flowRef}{t.entryKey ? ` · ${t.entryKey}` : ''} · 种子 {t.seed}
                  </span>
                  <button className="ghost" style={{ fontSize: 11 }} onClick={() => setOpenId(open ? null : t.id)}>
                    {open ? '收起' : '详情'}
                  </button>
                  <button className="ghost" style={{ fontSize: 11 }} onClick={() => rename(t)}>改名</button>
                  <button className="ghost icon-btn" aria-label={`删除 ${t.name}`} onClick={() => remove(t)}>×</button>
                </div>

                {r?.error && (
                  <div className="ref-item audit-issue-error" style={{ marginTop: 6 }}>
                    <span className="palette-kind">回放中断</span>
                    <span className="ref-title">{r.error}</span>
                  </div>
                )}

                {r && r.results.map((a, i) => (
                  <div key={i} className={`ref-item ${a.ok ? '' : 'audit-issue-error'}`} style={{ marginTop: 4 }}>
                    <span className="audit-severity">{a.ok ? '✓' : '✗'}</span>
                    <span className="ref-title">{a.detail}</span>
                  </div>
                ))}

                {r && r.results.length === 0 && !r.error && (
                  <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
                    这条测试还没有断言 —— 它现在只验证「能跑完不报错」。
                  </div>
                )}

                {open && r && (
                  <div className="hint" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.8 }}>
                    覆盖:节点 {r.coverage.visitedNodes}/{r.coverage.totalNodes}
                    &nbsp;· 连线 {r.coverage.takenEdges}/{r.coverage.totalEdges}
                    &nbsp;· 步数 {r.steps}
                    <br />
                    选择序列:{t.choices.length > 0 ? t.choices.join(' → ') : '(无)'}
                    <br />
                    触发事件:{r.firedEvents.length > 0 ? r.firedEvents.map((f) => f.event).join('、') : '(无)'}
                    <br />
                    变量终值:{Object.entries(r.finalVars).map(([k, v]) => `${k}=${String(v)}`).join(', ') || '(无)'}
                    {stale && (
                      <>
                        <br />
                        <button className="ghost" style={{ fontSize: 11, marginTop: 4 }} onClick={() => acceptCurrent(t)}>
                          结果符合预期,以当前流程为新基准
                        </button>
                      </>
                    )}
                    {r.lastNodeId && (
                      <>
                        <br />
                        <button
                          className="ghost"
                          style={{ fontSize: 11, marginTop: 4 }}
                          onClick={() => {
                            const flow = findTestFlow(project, t.flowRef);
                            if (flow) { go({ tab: 'flow', flowId: flow.id, nodeId: r.lastNodeId }); onClose(); }
                          }}
                        >跳到结束节点</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
