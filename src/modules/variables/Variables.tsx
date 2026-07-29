import { useRef, useState } from 'react';
import { uid, useLoom } from '../../store';
import { confirmDialog } from '../../dialog';
import type { ExternalEvent, VariableType } from '../../types';

/** 稳定的空数组:selector 里返回 `?? []` 会因新引用触发无限重渲染 */
const NO_EVENTS: ExternalEvent[] = [];

const TYPE_LABEL: Record<VariableType, string> = {
  boolean: '布尔',
  number: '数值',
  string: '文本',
};

export default function Variables() {
  const [tab, setTab] = useState<'vars' | 'events'>('vars');
  const variables = useLoom((s) => s.project.variables);
  const eventsRaw = useLoom((s) => s.project.externalEvents);
  const events = eventsRaw ?? NO_EVENTS;
  const { addVariable, updateVariable, removeVariable, renameScriptIdentifier } = useLoom();
  /** 名称输入聚焦时的原名,blur 时做脚本重命名联动 */
  const focusName = useRef<string | undefined>(undefined);

  if (tab === 'events') return <ExternalEvents onBack={() => setTab('vars')} />;

  return (
    <div className="pane-col">
      <div className="toolbar">
        <button
          className="primary"
          onClick={() => addVariable({ id: uid(), name: `var_${variables.length + 1}`, type: 'boolean', value: 'false', description: '' })}
        >＋ 新变量</button>
        <button
          onClick={() => setTab('events')}
          title="管理外部事件声明:流程用「外部事件」节点请求宿主引擎播动画 / 切场景 / 启动谜题"
        >⚡ 外部事件{events.length > 0 ? `(${events.length})` : ''}</button>
        <span className="hint">全局变量可在流程的「条件分支」和「指令」节点中引用,用于追踪剧情状态</span>
      </div>
      <div className="pad-wrap">
        <table className="var-table">
          <thead>
            <tr>
              <th style={{ width: 200 }}>变量名</th>
              <th style={{ width: 110 }}>类型</th>
              <th style={{ width: 160 }}>默认值</th>
              <th>说明</th>
              <th style={{ width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {variables.map((v) => (
              <tr key={v.id}>
                <td>
                  <input
                    value={v.name}
                    style={{ fontFamily: 'Consolas, monospace' }}
                    onChange={(e) => updateVariable(v.id, { name: e.target.value })}
                    onFocus={() => { focusName.current = v.name; }}
                    onBlur={() => {
                      if (focusName.current && v.name && focusName.current !== v.name) {
                        renameScriptIdentifier(focusName.current, v.name);
                      }
                      focusName.current = undefined;
                    }}
                  />
                </td>
                <td>
                  <select value={v.type} onChange={(e) => updateVariable(v.id, { type: e.target.value as VariableType })}>
                    {(Object.keys(TYPE_LABEL) as VariableType[]).map((t) => (
                      <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {v.type === 'boolean' ? (
                    <select value={v.value} onChange={(e) => updateVariable(v.id, { value: e.target.value })}>
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </select>
                  ) : (
                    <input value={v.value} onChange={(e) => updateVariable(v.id, { value: e.target.value })} />
                  )}
                </td>
                <td>
                  <input value={v.description} onChange={(e) => updateVariable(v.id, { description: e.target.value })} placeholder="这个变量追踪什么?" />
                </td>
                <td>
                  <button
                    className="ghost icon-btn"
                    onClick={async () => { if (await confirmDialog({ message: `删除变量 ${v.name}?`, danger: true, confirmText: '删除' })) removeVariable(v.id); }}
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {variables.length === 0 && <div className="empty-hint">还没有变量</div>}
      </div>
    </div>
  );
}

/**
 * R19-3 外部事件声明表。
 * 事件是「流程请求宿主引擎做一件事」的契约:技术名由宿主分发,参数在这里
 * 声明类型,导出引擎包时会生成对应的字面量联合与载荷类型。
 * 放在变量模块下 —— 两者都是项目级声明,不值得再占一个顶层 tab。
 */
function ExternalEvents({ onBack }: { onBack: () => void }) {
  const eventsRaw = useLoom((s) => s.project.externalEvents);
  const events = eventsRaw ?? NO_EVENTS;
  const update = useLoom((s) => s.update);

  const patch = (fn: (list: ExternalEvent[]) => ExternalEvent[]) => {
    update((p) => {
      const next = fn([...(p.externalEvents ?? [])]);
      if (next.length > 0) p.externalEvents = next;
      else delete p.externalEvents;
    });
  };
  const patchOne = (id: string, changes: Partial<ExternalEvent>) =>
    patch((list) => list.map((e) => (e.id === id ? { ...e, ...changes } : e)));

  return (
    <div className="pane-col">
      <div className="toolbar">
        <button onClick={onBack}>← 变量</button>
        <button
          className="primary"
          onClick={() => patch((list) => [...list, {
            id: uid(), name: `event_${list.length + 1}`, params: [],
          }])}
        >＋ 新事件</button>
        <span className="hint">
          流程用「外部事件」节点声明式地请求引擎做事(播动画 / 切场景 / 启动谜题),
          不直接执行引擎代码;导出时会为宿主生成事件名与参数类型
        </span>
      </div>
      <div className="pad-wrap">
        {events.length === 0 && (
          <div className="empty-hint">
            还没有外部事件。先在这里声明事件名与参数,流程里的「外部事件」节点才能选到它。
          </div>
        )}
        {events.map((ev) => (
          <div key={ev.id} className="audit-section">
            <div className="kv-row" style={{ alignItems: 'center', gap: 6 }}>
              <input
                style={{ width: 200, fontFamily: 'Consolas, monospace' }}
                value={ev.name}
                placeholder="事件技术名"
                onChange={(e) => patchOne(ev.id, { name: e.target.value })}
              />
              <input
                style={{ width: 160 }}
                value={ev.label ?? ''}
                placeholder="显示名(可选)"
                onChange={(e) => patchOne(ev.id, { label: e.target.value || undefined })}
              />
              <input
                style={{ flex: 1 }}
                value={ev.description ?? ''}
                placeholder="这个事件让引擎做什么?"
                onChange={(e) => patchOne(ev.id, { description: e.target.value || undefined })}
              />
              <select
                value={ev.returnType ?? ''}
                title="宿主回值的类型;仅「等待宿主返回值」模式下有意义"
                onChange={(e) => patchOne(ev.id, { returnType: (e.target.value || undefined) as VariableType | undefined })}
              >
                <option value="">无返回值</option>
                {(Object.keys(TYPE_LABEL) as VariableType[]).map((t) => (
                  <option key={t} value={t}>返回{TYPE_LABEL[t]}</option>
                ))}
              </select>
              <button
                className="ghost icon-btn"
                aria-label={`删除事件 ${ev.name}`}
                onClick={async () => {
                  if (await confirmDialog({ message: `删除外部事件 ${ev.name}?引用它的节点会在体检里报错。`, danger: true, confirmText: '删除' })) {
                    patch((list) => list.filter((x) => x.id !== ev.id));
                  }
                }}
              >×</button>
            </div>
            <div style={{ paddingLeft: 12, marginTop: 6 }}>
              {(ev.params ?? []).map((prm, i) => (
                <div key={i} className="kv-row" style={{ alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <input
                    style={{ width: 180, fontFamily: 'Consolas, monospace' }}
                    value={prm.name}
                    placeholder="参数名"
                    onChange={(e) => patchOne(ev.id, {
                      params: (ev.params ?? []).map((q, j) => (j === i ? { ...q, name: e.target.value } : q)),
                    })}
                  />
                  <select
                    value={prm.type}
                    onChange={(e) => patchOne(ev.id, {
                      params: (ev.params ?? []).map((q, j) => (j === i ? { ...q, type: e.target.value as VariableType } : q)),
                    })}
                  >
                    {(Object.keys(TYPE_LABEL) as VariableType[]).map((t) => (
                      <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                    ))}
                  </select>
                  <input
                    style={{ width: 160 }}
                    value={prm.default ?? ''}
                    placeholder="默认值(可选)"
                    onChange={(e) => patchOne(ev.id, {
                      params: (ev.params ?? []).map((q, j) => (j === i ? { ...q, default: e.target.value || undefined } : q)),
                    })}
                  />
                  <button
                    className="ghost icon-btn"
                    aria-label="删除参数"
                    onClick={() => patchOne(ev.id, { params: (ev.params ?? []).filter((_, j) => j !== i) })}
                  >×</button>
                </div>
              ))}
              <button
                className="ghost"
                style={{ fontSize: 11 }}
                onClick={() => patchOne(ev.id, { params: [...(ev.params ?? []), { name: '', type: 'string' as VariableType }] })}
              >＋ 参数</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
