import { useLoom } from '../store';
import { useNav } from '../search';
import { addAttachment, removeAttachment, getAttachments, formatSize } from '../util';
import type { Asset } from '../types';
import { ASSET_KIND_ICON, ASSET_KIND_LABEL } from '../types';
import Icon from './Icon';

/** 通用附件编辑器:挂在任意对象(实体/卡片/流程节点/文档块…)的 inspector 里 */
export default function AttachmentEditor({ ownerId }: { ownerId: string }) {
  const project = useLoom((s) => s.project);
  const update = useLoom((s) => s.update);
  const go = useNav((s) => s.go);
  const ids = getAttachments(project, ownerId);
  const attached = ids
    .map((id) => project.assets.find((a) => a.id === id))
    .filter((x): x is Asset => !!x);

  const remaining = project.assets.filter((a) => !ids.includes(a.id));

  const add = (assetId: string) => update((p) => { addAttachment(p, ownerId, assetId); });
  const remove = (assetId: string) => update((p) => { removeAttachment(p, ownerId, assetId); });

  return (
    <div className="field">
      <label>附件</label>
      {attached.length === 0 && <span className="hint" style={{ fontSize: 12 }}>挂接资源库里的图片/音频/视频</span>}
      <div className="ref-editor-multi">
        {attached.map((a) => (
          <div key={a.id} className="attach-row" title={`${ASSET_KIND_LABEL[a.kind]} · ${a.mime} · ${formatSize(a.size)}`}>
            {a.thumbnail
              ? <img src={a.thumbnail} className="attach-thumb" alt="" />
              : <span className="attach-thumb-empty"><Icon name={ASSET_KIND_ICON[a.kind]} size={14} /></span>}
            <button className="ghost attach-name" onClick={() => go({ tab: 'assets', assetId: a.id })} title="跳转到资源库">
              {a.name}
            </button>
            <span className="hint">{ASSET_KIND_LABEL[a.kind]}</span>
            <button className="ghost icon-btn" onClick={() => remove(a.id)} title="移除"><Icon name="trash" size={12} /></button>
          </div>
        ))}
        {remaining.length > 0 && (
          <select
            value=""
            onChange={(e) => { if (e.target.value) { add(e.target.value); e.currentTarget.value = ''; } }}
          >
            <option value="">＋ 添加附件</option>
            {remaining.map((a) => (
              <option key={a.id} value={a.id}>{a.name} · {ASSET_KIND_LABEL[a.kind]}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
