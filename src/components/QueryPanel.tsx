import { useMemo, useState } from 'react';
import { uid, useLoom } from '../store';
import { useNav } from '../search';
import { DOC_STATUS_LABEL, DOC_STATUS_ORDER } from '../types';
import { alertDialog, confirmDialog, promptText } from '../dialog';
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
  const addSavedQuery = useLoom((state) => state.addSavedQuery);
  const updateSavedQuery = useLoom((state) => state.updateSavedQuery);
  const removeSavedQuery = useLoom((state) => state.removeSavedQuery);
  const go = useNav((state) => state.go);
  const [query, setQuery] = useState<ProjectQuery>(DEFAULT_PROJECT_QUERY);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const results = useMemo(() => queryProject(project, query), [project, query]);
  const savedQueries = project.savedQueries ?? [];
  const activeSaved = savedQueries.find((saved) => saved.id === activeSavedId);
  const activeChanged = activeSaved ? JSON.stringify(activeSaved.query) !== JSON.stringify(query) : false;
  const folderModule = QUERY_FOLDER_MODULE[query.objectType];
  const folders = project.folders.filter((folder) => !folderModule || folder.module === folderModule);
  const patch = <K extends keyof ProjectQuery>(key: K, value: ProjectQuery[K]) =>
    setQuery((current) => ({ ...current, [key]: value }));

  const selectResult = (nav: (typeof results)[number]['nav']) => {
    onClose();
    go(nav);
  };

  const applySaved = (id: string) => {
    const saved = savedQueries.find((item) => item.id === id);
    if (!saved) return;
    setActiveSavedId(id);
    setQuery(structuredClone(saved.query));
  };

  const saveNew = async () => {
    const value = await promptText({
      title: '保存查询',
      message: '为当前查询条件命名',
      placeholder: '如:待修订的主线章节',
      confirmText: '保存',
    });
    const name = value?.trim();
    if (!name) return;
    if (savedQueries.some((saved) => saved.name === name)) {
      await alertDialog(`已有名为「${name}」的查询`);
      return;
    }
    const now = Date.now();
    const id = uid();
    addSavedQuery({ id, name, query: structuredClone(query), createdAt: now, updatedAt: now });
    setActiveSavedId(id);
  };

  const updateActive = () => {
    if (!activeSaved) return;
    updateSavedQuery(activeSaved.id, { query: structuredClone(query) });
  };

  const renameActive = async () => {
    if (!activeSaved) return;
    const value = await promptText({
      title: '重命名查询',
      message: '查询名称',
      defaultValue: activeSaved.name,
      confirmText: '重命名',
    });
    const name = value?.trim();
    if (!name || name === activeSaved.name) return;
    if (savedQueries.some((saved) => saved.id !== activeSaved.id && saved.name === name)) {
      await alertDialog(`已有名为「${name}」的查询`);
      return;
    }
    updateSavedQuery(activeSaved.id, { name });
  };

  const deleteActive = async () => {
    if (!activeSaved || !await confirmDialog({
      message: `删除保存的查询「${activeSaved.name}」?\n\n只会删除查询条件,不会删除项目内容。`,
      confirmText: '删除',
      danger: true,
    })) return;
    removeSavedQuery(activeSaved.id);
    setActiveSavedId(null);
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
        <div className="query-saved">
          <div className="query-saved-list">
            {savedQueries.map((saved) => (
              <button
                key={saved.id}
                className={activeSavedId === saved.id ? 'active' : ''}
                onClick={() => applySaved(saved.id)}
                title={`套用「${saved.name}」`}
              >
                {saved.name}{activeSavedId === saved.id && activeChanged ? ' *' : ''}
              </button>
            ))}
            {savedQueries.length === 0 && <span>还没有保存的查询</span>}
          </div>
          <div className="query-saved-actions">
            <button className="ghost" onClick={saveNew}>保存当前</button>
            {activeSaved && <>
              <button className="ghost" disabled={!activeChanged} onClick={updateActive}>更新条件</button>
              <button className="ghost" onClick={renameActive}>重命名</button>
              <button className="ghost danger" onClick={deleteActive}>删除</button>
            </>}
          </div>
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
          <button
            className="ghost query-reset"
            onClick={() => {
              setQuery(DEFAULT_PROJECT_QUERY);
              setActiveSavedId(null);
            }}
          >
            重置条件
          </button>
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
