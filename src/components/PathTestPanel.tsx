import { useMemo } from 'react';
import { useLoom } from '../store';
import { useNav } from '../search';
import Icon from './Icon';
import type { Flow } from '../types';
import { simulateFlow, type SimNodeRef } from '../simulate';

/**
 * R7 路径测试报告:批量遍历当前流程的全部分支,
 * 给出覆盖率与三类结构问题(不可达 / 卡死 / 死循环),问题可点击直达节点。
 * 遍历是确定性枚举(检定按成功/失败双分支),同一流程报告永远一致。
 */
export default function PathTestPanel({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const go = useNav((s) => s.go);

  const report = useMemo(
    () => simulateFlow(flow, project.variables, project.entities),
    [flow, project.variables, project.entities],
  );

  const jump = (ref: SimNodeRef) => {
    onClose();
    go({ tab: 'flow', flowId: flow.id, path: ref.path, nodeId: ref.nodeId });
  };

  const issueGroup = (
    label: string, kind: string, refs: SimNodeRef[], bad: boolean, hint: string,
  ) => refs.length > 0 && (
    <div className="field">
      <label>{label}({refs.length})</label>
      <div className="hint" style={{ fontSize: 11, marginBottom: 4 }}>{hint}</div>
      {refs.map((r) => (
        <div key={r.nodeId} className={`pathtest-issue-row${bad ? ' bad' : ''}`} onClick={() => jump(r)} title="点击定位到节点">
          <span className="pathtest-issue-kind">{kind}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
          <span className="hint" style={{ fontSize: 10 }}>{r.kind}{r.path.length > 0 ? ` · 子流程内` : ''}</span>
        </div>
      ))}
    </div>
  );

  const pct = Math.round(report.coverage * 100);
  const clean = report.unreachable.length === 0 && report.stuck.length === 0 && report.loops.length === 0;

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette sync-panel" onClick={(e) => e.stopPropagation()} style={{ width: 620, maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
        <div className="sync-head">
          <Icon name="check" size={14} />
          <span>路径测试 · {flow.name}</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="sync-body" style={{ overflowY: 'auto' }}>
          <div className="pathtest-summary">
            <span className="pathtest-coverage" style={{ color: pct === 100 ? 'var(--diff-add-strong)' : pct < 70 ? 'var(--danger)' : 'var(--text)' }}>
              {pct}%
            </span>
            <span className="hint">节点覆盖 {report.visitedCount} / {report.totalNodes}</span>
            <span className="hint">展开 {report.pathCount} 条路径{report.pathsTruncated ? '(达到上限,报告为下界)' : ''}</span>
          </div>
          <table className="var-table" style={{ marginTop: 8 }}>
            <tbody>
              <tr><td>自然结束</td><td>{report.ends.end}</td></tr>
              <tr><td>合流(与其他路径状态一致,停止展开)</td><td>{report.ends.merged}</td></tr>
              {report.ends.stuck > 0 && <tr style={{ color: 'var(--danger)' }}><td>卡死(选项全被过滤)</td><td>{report.ends.stuck}</td></tr>}
              {report.ends.loop > 0 && <tr style={{ color: 'var(--danger)' }}><td>死循环</td><td>{report.ends.loop}</td></tr>}
              {report.ends.truncated > 0 && <tr><td>超长截断(超过步数上限)</td><td>{report.ends.truncated}</td></tr>}
            </tbody>
          </table>

          {clean && (
            <div className="player-tip" style={{ marginTop: 10 }}>
              ✓ 没有发现结构问题:所有节点可达,没有死循环,也没有会把玩家困住的分支。
            </div>
          )}

          {issueGroup('不可达节点', '不可达', report.unreachable, true,
            '任何路径都走不到这些节点:检查连线、条件表达式或变量初值。')}
          {issueGroup('无出口卡死', '卡死', report.stuck, true,
            '这些节点有出边,但存在一条路径让所有出边都被条件 / 一次性过滤掉,玩家会被困住;考虑加 fallback 兜底分支。')}
          {issueGroup('死循环', '循环', report.loops, true,
            '存在一条路径回到完全相同的状态(变量 / 一次性选项都没变化),会无限打转;在环上加状态变化或出口。')}

          <div className="hint" style={{ fontSize: 11, marginTop: 8 }}>
            遍历为确定性枚举:条件按变量实际走向,检定同时探索成功与失败,一次性选项与 fallback 遮蔽按演出规则处理。
            同一流程与变量初值,报告完全可复现。
          </div>
          <div className="sync-actions">
            <button className="primary" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  );
}
