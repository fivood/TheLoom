import { useRef } from 'react';
import { uid, useLoom } from '../../store';
import { confirmDialog } from '../../dialog';
import type { VariableType } from '../../types';

const TYPE_LABEL: Record<VariableType, string> = {
  boolean: '布尔',
  number: '数值',
  string: '文本',
};

export default function Variables() {
  const variables = useLoom((s) => s.project.variables);
  const { addVariable, updateVariable, removeVariable, renameScriptIdentifier } = useLoom();
  // R6 重命名联动:聚焦时记住旧名,失焦时若改名则全项目脚本改写
  const focusName = useRef<string | null>(null);
  const commitRename = (next: string) => {
    const old = focusName.current;
    focusName.current = null;
    if (old && next && old !== next && /^[A-Za-z_]\w*$/.test(old) && /^[A-Za-z_]\w*$/.test(next)) {
      renameScriptIdentifier(old, next);
    }
  };

  return (
    <div className="pane-col">
      <div className="toolbar">
        <button
          className="primary"
          onClick={() => addVariable({ id: uid(), name: `var_${variables.length + 1}`, type: 'boolean', value: 'false', description: '' })}
        >＋ 新变量</button>
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
                    title="改名后,全项目脚本里的引用会自动跟着改"
                    onFocus={() => { focusName.current = v.name; }}
                    onBlur={(e) => commitRename(e.target.value)}
                    onChange={(e) => updateVariable(v.id, { name: e.target.value })}
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
