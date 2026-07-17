import { useMemo, useState } from 'react';
import { useLoom } from '../store';
import { auditProject, projectStats } from '../audit';
import { useNav } from '../search';
import { ISSUE_SEVERITY_LABEL, type IssueSeverity } from '../issues';

export default function AuditPanel({ onClose }: { onClose: () => void }) {
  const project = useLoom((s) => s.project);
  const stats = useMemo(() => projectStats(project), [project]);
  const issues = useMemo(() => auditProject(project), [project]);
  const [severity, setSeverity] = useState<IssueSeverity | 'all'>('all');
  const visibleIssues = severity === 'all' ? issues : issues.filter((issue) => issue.severity === severity);
  const severityCounts = useMemo(() => ({
    error: issues.filter((issue) => issue.severity === 'error').length,
    warning: issues.filter((issue) => issue.severity === 'warning').length,
    info: issues.filter((issue) => issue.severity === 'info').length,
  }), [issues]);
  const go = useNav((s) => s.go);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette audit-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sync-head">
          <span>项目体检</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="audit-body">
          <div className="audit-section">
            <h4>字数统计</h4>
            <div className="audit-totals">
              流程 {stats.totalWords} 字 · {stats.totalNodes} 节点
              &nbsp;|&nbsp; 大纲 {stats.outlineWords} 字
              &nbsp;|&nbsp; 资料 {stats.researchWords} 字
              &nbsp;|&nbsp; 文档 {stats.documentWords} 字
              &nbsp;|&nbsp; 资源 {stats.assets} · 文档 {stats.documents}
            </div>
            <table className="var-table">
              <thead><tr><th>流程</th><th>节点</th><th>字数</th></tr></thead>
              <tbody>
                {stats.flows.map((f, i) => (
                  <tr key={i}><td>{f.name}</td><td>{f.nodes}</td><td>{f.words}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          {stats.speakers.length > 0 && (
            <div className="audit-section">
              <h4>按说话人</h4>
              <table className="var-table">
                <thead><tr><th>角色</th><th>台词条数</th><th>台词字数</th></tr></thead>
                <tbody>
                  {stats.speakers.map((s, i) => (
                    <tr key={i}><td>{s.name}</td><td>{s.lines}</td><td>{s.words}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="audit-section">
            <h4>问题检测({issues.length})</h4>
            {issues.length > 0 && (
              <div className="audit-filters">
                <button className={severity === 'all' ? 'active' : ''} onClick={() => setSeverity('all')}>全部 {issues.length}</button>
                {(['error', 'warning', 'info'] as IssueSeverity[]).map((level) => (
                  severityCounts[level] > 0 && (
                    <button key={level} className={severity === level ? 'active' : ''} onClick={() => setSeverity(level)}>
                      {ISSUE_SEVERITY_LABEL[level]} {severityCounts[level]}
                    </button>
                  )
                ))}
              </div>
            )}
            {issues.length === 0 && <div className="audit-ok">没有发现问题:无孤儿节点、无分支缺口、无未定义变量、无空对白、无悬挂附件、无重复技术名、无必填缺失、无损坏资产。</div>}
            {visibleIssues.map((it) => (
              <div
                key={it.id}
                className={`ref-item audit-issue-${it.severity}`}
                onClick={() => { if (it.nav) { go(it.nav); onClose(); } }}
                title={it.nav ? '点击定位' : undefined}
              >
                <span className="audit-severity">{ISSUE_SEVERITY_LABEL[it.severity]}</span>
                <span className="palette-kind">{it.kind}</span>
                <span className="ref-title">{it.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
