import { useMemo, useState } from 'react';
import { useLoom } from '../store';
import { useNav } from '../search';
import { DOC_STATUS_LABEL, DOC_STATUS_ORDER } from '../types';
import {
  DEFAULT_PROJECT_QUERY,
  QUERY_FOLDER_MODULE,
  QUERY_OBJECT_LABEL,
  queryProject,
  type ProjectQuery,
  type QueryObjectType,
} from '../query';
import Icon from './Icon';

export default function QueryPanel({ onClose }: { onClose: () => void }) {
  const project = useLoom((state) => state.project);
  const go = useNav((state) => state.go);
  const [query, setQuery] = useState<ProjectQuery>(DEFAULT_PROJECT_QUERY);
  const results = useMemo(() => queryProject(project, query), [project, query]);
  const folderModule = QUERY_FOLDER_MODULE[query.objectType];
  const folders = project.folders.filter((folder) => !folderModule || folder.module === folderModule);
  const patch = <K extends keyof ProjectQuery>(key: K, value: ProjectQuery[K]) =>
    setQuery((current) => ({ ...current, [key]: value }));

  const selectResult = (nav: (typeof results)[number]['nav']) => {
    onClose();
    go(nav);
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette query-panel" onClick={(event) => event.stopPropagation()}>
        <div className="sync-head">
          <Icon name="search" size={14} />
          <span>组合查询</span>
          <span className="spacer" />
          <button className="ghost icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="query-controls">
          <label>
            对象类型
            <select
              value={query.objectType}
              onChange={(event) => setQuery((current) => ({
                ...current,
                objectType: event.target.value as QueryObjectType,
                folderId: 'any',
              }))}
            >
              {(Object.keys(QUERY_OBJECT_LABEL) as QueryObjectType[]).map((value) =>
                <option key={value} value={value}>{QUERY_OBJECT_LABEL[value]}</option>)}
            </select>
          </label>
          <label className="query-wide">
            全文包含
            <input value={query.text} onChange={(event) => patch('text', event.target.value)} placeholder="名称、正文、技术名…" />
          </label>
          <label>
            文件夹
            <select value={query.folderId} onChange={(event) => patch('folderId', event.target.value)}>
              <option value="any">全部文件夹</option>
              <option value="ungrouped">未分组</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          </label>
          <label>
            属性名
            <input value={query.attributeName} onChange={(event) => patch('attributeName', event.target.value)} placeholder="如 POV / 授权 / 动机" />
          </label>
          <label>
            属性值包含
            <input value={query.attributeValue} onChange={(event) => patch('attributeValue', event.target.value)} placeholder="如 塞梅尔维斯 / CC-BY" />
          </label>
          <label>
            标签
            <input
              value={query.tags.join(', ')}
              onChange={(event) => patch('tags', event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))}
              placeholder="多个标签用逗号分隔"
            />
          </label>
          <label>
            文档状态
            <select value={query.status} onChange={(event) => patch('status', event.target.value as ProjectQuery['status'])}>
              <option value="any">全部状态</option>
              {DOC_STATUS_ORDER.map((status) => <option key={status} value={status}>{DOC_STATUS_LABEL[status]}</option>)}
            </select>
          </label>
          <label>
            引用状态
            <select value={query.references} onChange={(event) => patch('references', event.target.value as ProjectQuery['references'])}>
              <option value="any">不限</option>
              <option value="referenced">被其他对象引用</option>
              <option value="unreferenced">未被引用</option>
            </select>
          </label>
          <button className="ghost query-reset" onClick={() => setQuery(DEFAULT_PROJECT_QUERY)}>重置条件</button>
        </div>
        <div className="query-summary">找到 {results.length} 个对象{results.length > 200 ? '，显示前 200 个' : ''}</div>
        <div className="query-results">
          {results.slice(0, 200).map((hit) => (
            <button key={`${hit.objectType}:${hit.id}`} className="query-result" onClick={() => selectResult(hit.nav)}>
              <span className="query-result-module">{hit.module}</span>
              <span className="query-result-main">
                <strong>{hit.title}</strong>
                <small>{hit.kind}{hit.snippet ? ` · ${hit.snippet}` : ''}</small>
              </span>
              <span className="query-result-refs">{hit.referenceCount > 0 ? `${hit.referenceCount} 引用` : '未引用'}</span>
            </button>
          ))}
          {results.length === 0 && <div className="empty-hint">没有对象同时满足这些条件</div>}
        </div>
      </div>
    </div>
  );
}
