import { useEffect, useState } from 'react';
import { useNav } from '../../search';
import RelationGraph from './RelationGraph';
import ArcBoard from './ArcBoard';
import ForeshadowLedger from './ForeshadowLedger';
import AppearanceGrid from './AppearanceGrid';
import SceneWall from './SceneWall';
import PacingChart from './PacingChart';
import WritingDashboard from './WritingDashboard';
import { useLoom } from '../../store';
import RevisionCenter from './RevisionCenter';

export type PlanningView = 'progress' | 'revision' | 'relations' | 'arcs' | 'foreshadow' | 'appearance' | 'wall' | 'pacing';

const VIEWS: { key: PlanningView; label: string; hint: string }[] = [
  { key: 'progress', label: '写作进度', hint: '目标、每日新增、修订进度与待办入口' },
  { key: 'revision', label: '修订校对', hint: '快照差异决策与中文一致性检查' },
  { key: 'relations', label: '关系图', hint: '实体间拖拽连线,标注人物关系' },
  { key: 'arcs', label: '角色弧线', hint: '角色发展阶段,可关联具体场景' },
  { key: 'foreshadow', label: '伏笔台账', hint: '追踪伏笔的埋设与回收' },
  { key: 'appearance', label: '登场统计', hint: '角色 × 章节的登场矩阵' },
  { key: 'wall', label: '卡片墙', hint: '按章节浏览场景卡片,可拖拽排序' },
  { key: 'pacing', label: '节奏图', hint: '逐场景字数与情节张力' },
];

export default function Planning() {
  const workspacePreset = useLoom((state) => state.project.workspacePreset);
  const [view, setView] = useState<PlanningView>(workspacePreset === 'novel' ? 'progress' : 'relations');
  const [navEntityId, setNavEntityId] = useState<string | null>(null);
  const [navForeshadowId, setNavForeshadowId] = useState<string | null>(null);

  const navSeq = useNav((s) => s.seq);
  useEffect(() => {
    const t = useNav.getState().target;
    if (t?.tab === 'planning') {
      if (t.planningView) setView(t.planningView);
      setNavEntityId(t.entityId ?? null);
      setNavForeshadowId(t.foreshadowId ?? null);
      useNav.getState().clear();
    }
  }, [navSeq]);

  const active = VIEWS.find((v) => v.key === view)!;

  return (
    <div className="pane-col">
      <div className="toolbar">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={view === v.key ? 'primary' : undefined}
            title={v.hint}
            onClick={() => {
              setView(v.key);
              useNav.getState().visit({ tab: 'planning', planningView: v.key }, `规划 · ${v.label}`);
            }}
          >{v.label}</button>
        ))}
        <span className="hint">{active.hint}</span>
      </div>
      {view === 'progress' && <WritingDashboard />}
      {view === 'revision' && <RevisionCenter />}
      {view === 'relations' && <RelationGraph />}
      {view === 'arcs' && <ArcBoard focusEntityId={navEntityId} onConsumeFocus={() => setNavEntityId(null)} />}
      {view === 'foreshadow' && <ForeshadowLedger focusId={navForeshadowId} onConsumeFocus={() => setNavForeshadowId(null)} />}
      {view === 'appearance' && <AppearanceGrid />}
      {view === 'wall' && <SceneWall />}
      {view === 'pacing' && <PacingChart />}
    </div>
  );
}
