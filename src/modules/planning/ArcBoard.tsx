import { useEffect, useMemo, useState } from 'react';
import { uid, useLoom } from '../../store';
import { confirmDialog } from '../../dialog';
import { useNav } from '../../search';
import { arcStagesOf, groupDocsByChapter } from '../../planning';
import { folderPath } from '../../util';

export default function ArcBoard({ focusEntityId, onConsumeFocus }: {
  focusEntityId: string | null;
  onConsumeFocus: () => void;
}) {
  const project = useLoom((s) => s.project);
  const { addArcStage, updateArcStage, removeArcStage, update } = useLoom();
  const go = useNav((s) => s.go);

  const characters = useMemo(
    () => project.entities.filter((e) => e.kind === 'character'),
    [project.entities],
  );
  const [selectedId, setSelectedId] = useState<string | null>(characters[0]?.id ?? null);

  useEffect(() => {
    if (focusEntityId) {
      setSelectedId(focusEntityId);
      onConsumeFocus();
    }
  }, [focusEntityId]);

  const selected = characters.find((e) => e.id === selectedId) ?? null;
  const stages = selected ? arcStagesOf(project, selected.id) : [];
  const chapters = useMemo(
    () => groupDocsByChapter(project.documents, project.folders),
    [project.documents, project.folders],
  );

  const stageCount = (entityId: string) => (project.arcs ?? []).filter((a) => a.entityId === entityId).length;

  const addStage = () => {
    if (!selected) return;
    addArcStage({
      id: uid(), entityId: selected.id, title: '', note: '',
      order: stages.length > 0 ? Math.max(...stages.map((s, i) => s.order ?? i)) + 1 : 0,
    });
  };

  // 移动阶段:先把该角色所有阶段的 order 物化为当前顺序,再交换
  const moveStage = (stageId: string, dir: -1 | 1) => {
    const i = stages.findIndex((s) => s.id === stageId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= stages.length) return;
    const orderedIds = stages.map((s) => s.id);
    [orderedIds[i], orderedIds[j]] = [orderedIds[j], orderedIds[i]];
    update((p) => {
      for (const a of p.arcs ?? []) {
        const idx = orderedIds.indexOf(a.id);
        if (idx >= 0) a.order = idx;
      }
    });
  };

  const docChapterLabel = (docId: string | undefined) => {
    if (!docId) return '';
    const doc = project.documents.find((d) => d.id === docId);
    if (!doc) return '';
    return doc.folderId ? folderPath(doc.folderId, project.folders) : '未分组';
  };

  return (
    <div className="planning-body">
      <aside className="planning-side">
        <div className="planning-side-title">角色({characters.length})</div>
        {characters.map((e) => (
          <button
            key={e.id}
            className={`planning-side-item ${e.id === selectedId ? 'active' : ''}`}
            onClick={() => setSelectedId(e.id)}
          >
            <span className="planning-side-face">{e.avatar ? <img src={e.avatar} alt="" /> : (e.emoji || '●')}</span>
            <span className="planning-side-name">{e.name}</span>
            {stageCount(e.id) > 0 && <span className="planning-side-count">{stageCount(e.id)}</span>}
          </button>
        ))}
        {characters.length === 0 && <div className="empty-hint">还没有角色实体</div>}
      </aside>

      <div className="planning-main">
        {selected ? (
          <>
            <div className="arc-head">
              <h3>{selected.name} 的弧线</h3>
              <button className="primary" onClick={addStage}>＋ 新阶段</button>
              <span className="hint">按顺序描述角色的变化轨迹,可关联到具体场景</span>
            </div>
            <div className="arc-stages">
              {stages.map((stage, i) => (
                <div key={stage.id} className="arc-stage">
                  <div className="arc-stage-head">
                    <span className="arc-stage-no">{i + 1}</span>
                    <input
                      className="arc-stage-title"
                      value={stage.title}
                      placeholder="阶段名,如「拒绝召唤」"
                      onChange={(e) => updateArcStage(stage.id, { title: e.target.value })}
                    />
                    <button className="ghost icon-btn" disabled={i === 0} title="上移" onClick={() => moveStage(stage.id, -1)}>↑</button>
                    <button className="ghost icon-btn" disabled={i === stages.length - 1} title="下移" onClick={() => moveStage(stage.id, 1)}>↓</button>
                    <button
                      className="ghost icon-btn"
                      title="删除阶段"
                      onClick={async () => {
                        if (await confirmDialog({ message: `删除阶段「${stage.title || `第 ${i + 1} 阶段`}」?`, danger: true, confirmText: '删除' })) {
                          removeArcStage(stage.id);
                        }
                      }}
                    >×</button>
                  </div>
                  <textarea
                    rows={2}
                    value={stage.note}
                    placeholder="这一阶段角色的状态、动机、转变…"
                    onChange={(e) => updateArcStage(stage.id, { note: e.target.value })}
                  />
                  <div className="arc-stage-scene">
                    <select
                      value={stage.docId ?? ''}
                      onChange={(e) => updateArcStage(stage.id, { docId: e.target.value || undefined })}
                    >
                      <option value="">(不关联场景)</option>
                      {chapters.map((ch) => (
                        <optgroup key={ch.key || 'none'} label={ch.label}>
                          {ch.docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {stage.docId && (
                      <>
                        <span className="arc-stage-chapter">{docChapterLabel(stage.docId)}</span>
                        <button className="ghost" style={{ fontSize: 12 }} onClick={() => go({ tab: 'documents', docId: stage.docId })}>
                          打开场景 →
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {stages.length === 0 && (
                <div className="empty-hint" style={{ padding: 24 }}>
                  还没有阶段。经典结构可以从「现状 → 触发 → 挣扎 → 转变 → 新常态」开始
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-hint" style={{ margin: 'auto', textAlign: 'center' }}>
            先在「实体」模块创建角色
            <div style={{ marginTop: 8 }}>
              <button className="primary" onClick={() => go({ tab: 'entities' })}>去创建角色 →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
