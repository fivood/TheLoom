import type { ImportInspection, StorageUsage } from '../diagnostics';
import { LOCAL_STORAGE_WARNING_BYTES } from '../diagnostics';
import { countSubNodes } from '../util';
import Icon from './Icon';

export default function ImportProjectDialog({ inspection, storageUsage, onCancel, onConfirm }: {
  inspection: ImportInspection;
  storageUsage: StorageUsage;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const project = inspection.project;
  const nodes = project.flows.reduce((total, flow) =>
    total + flow.nodes.length + flow.nodes.reduce((sum, node) => sum + countSubNodes(node.data.sub), 0), 0);
  const projectedBytes = storageUsage.bytes + inspection.storageBytes;
  const capacityWarning = storageUsage.available && projectedBytes >= LOCAL_STORAGE_WARNING_BYTES;

  return (
    <div className="palette-backdrop" onClick={onCancel}>
      <div className="palette import-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="sync-head">
          <span><Icon name="upload" size={14} /> 导入前检查</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onCancel}>×</button>
        </div>
        <div className="import-body">
          <div className="import-project-name">{project.name}</div>
          <div className="import-file-meta">{inspection.fileName} · {(inspection.fileBytes / 1024).toFixed(1)} KB</div>

          <div className="import-stats">
            <div><strong>{project.flows.length}</strong><span>流程</span></div>
            <div><strong>{nodes}</strong><span>节点</span></div>
            <div><strong>{project.entities.length}</strong><span>实体</span></div>
            <div><strong>{project.documents.length}</strong><span>文档</span></div>
            <div><strong>{project.assets.length}</strong><span>资源</span></div>
          </div>

          {capacityWarning && (
            <div className="import-warning">
              导入后浏览器本地数据预计超过 4 MB。建议先下载现有项目备份，或在桌面端使用项目文件夹。
            </div>
          )}

          <div className="import-check-result">
            <div className="import-check-title">
              {inspection.issues.length === 0 ? '结构检查通过' : `发现 ${inspection.issues.length} 项结构提醒`}
            </div>
            {inspection.issues.length === 0 ? (
              <div className="import-check-ok">没有发现重复 ID、断裂连线、悬挂附件或缺失引用。</div>
            ) : (
              <div className="import-issue-list">
                {inspection.issues.slice(0, 8).map((issue, index) => (
                  <div key={`${issue.kind}-${index}`}><span>{issue.kind}</span>{issue.message}</div>
                ))}
                {inspection.issues.length > 8 && <div>另有 {inspection.issues.length - 8} 项，导入后可在“项目体检”中继续处理。</div>}
              </div>
            )}
          </div>

          <div className="import-note">导入会创建一个新项目，不会覆盖当前项目或修改原文件。</div>
        </div>
        <div className="update-actions">
          <button className="ghost" onClick={onCancel}>取消</button>
          <button className="primary" onClick={onConfirm}>创建新项目并导入</button>
        </div>
      </div>
    </div>
  );
}
