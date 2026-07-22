import { describe, expect, it } from 'vitest';
import { buildEnginePackage } from './engine/package';
import { parseProjectData, readProjectWithRecovery, saveProjectWithRecovery } from './recovery';
import { simulateFlow } from './simulate';
import {
  assignDocumentFilenames, cardToMd, documentToMd, entityToMd, projectFromFolderFiles, projectToFolderJson,
} from './storage';
import {
  legacyRegressionProject, longNovelRegressionProject, puzzleGameRegressionProject,
} from './test-fixtures/regressionProjects';
import type { Project } from './types';
import { linearizeByFolders, normalizeProject } from './util';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function jsonRoundTrip(project: Project): Project {
  const restored = parseProjectData(JSON.stringify(project));
  if (!restored) throw new Error('项目 JSON 往返失败');
  return restored;
}

function folderRoundTrip(project: Project): Project {
  const files = assignDocumentFilenames(project.documents, project.folders);
  return projectFromFolderFiles({
    projectJson: projectToFolderJson(project),
    recoveredFromBackup: false,
    entities: project.entities.map((entity) => ({ name: `${entity.name}.md`, content: entityToMd(entity) })),
    research: project.researchCards.map((card) => ({ name: `${card.title}.md`, content: cardToMd(card) })),
    documents: [...files].map(([path, document]) => ({ name: path, content: documentToMd(document, project.entities) })),
    assets: [],
  }).project;
}

describe('R17-0 长篇回归样例', () => {
  it('JSON 保存重载后保持卷章顺序、引用和技术名', () => {
    const restored = jsonRoundTrip(longNovelRegressionProject());
    expect(linearizeByFolders(restored.documents, restored.folders, 'document').map((document) => document.id))
      .toEqual(['doc-platform', 'doc-locker', 'doc-tunnel']);
    expect(restored.documents.map((document) => document.technicalName))
      .toEqual(['v1c1_platform', 'v1c1_locker', 'v1c2_tunnel']);
    expect(restored.folders.slice(0, 3).map((folder) => folder.documentRole))
      .toEqual(['volume', 'chapter', 'chapter']);
    expect(restored.outlineRows.map((row) => [row.chapterFolderId, row.documentId]))
      .toEqual([['folder-chapter-1', undefined], [undefined, 'doc-tunnel']]);
    expect(restored.timelineEvents.map((event) => event.documentIds))
      .toEqual([['doc-locker'], ['doc-tunnel']]);
    expect(restored.arcs?.map((stage) => stage.docId)).toEqual(['doc-platform', 'doc-tunnel']);
    expect(restored.foreshadows?.[0].plants[0].docId).toBe('doc-locker');
    expect(restored.foreshadows?.[0].payoffs[0].docId).toBe('doc-tunnel');
    expect(restored.annotations?.[0].blockId).toBe('block-locker-1');
    expect(restored.docSnapshots?.[0].blocks[0].id).toBe('block-platform-1');
  });

  it('文件夹 Markdown 往返保持正文、元数据、引用和真实子目录', () => {
    const source = normalizeProject(longNovelRegressionProject());
    const paths = [...assignDocumentFilenames(source.documents, source.folders).keys()];
    expect(paths).toEqual([
      '第一卷/第一章 雾站/空站台.md',
      '第一卷/第一章 雾站/寄存柜.md',
      '第一卷/第二章 回声/隧道回声.md',
    ]);

    const restored = folderRoundTrip(source);
    expect(linearizeByFolders(restored.documents, restored.folders, 'document').map((document) => document.id))
      .toEqual(['doc-platform', 'doc-locker', 'doc-tunnel']);
    expect(restored.documents.find((document) => document.id === 'doc-platform')).toMatchObject({
      folderId: 'folder-chapter-1', order: 0, status: 'done', povId: 'entity-lin', locationId: 'entity-station',
    });
    expect(restored.entities.find((entity) => entity.id === 'entity-lin')).toMatchObject({
      technicalName: 'lin_mo', aliases: ['阿默'], folderId: 'folder-characters',
    });
    expect(restored.arcs?.map((stage) => stage.docId)).toEqual(['doc-platform', 'doc-tunnel']);
    expect(restored.foreshadows?.[0].plants[0].docId).toBe('doc-locker');
    expect(restored.folders.slice(0, 3).map((folder) => folder.documentRole))
      .toEqual(['volume', 'chapter', 'chapter']);
    expect(restored.outlineRows[0].chapterFolderId).toBe('folder-chapter-1');
    expect(restored.timelineEvents[0].documentIds).toEqual(['doc-locker']);
  });

  it('滚动保存后当前项目与恢复点都可读取', () => {
    const storage = new MemoryStorage();
    const first = normalizeProject(longNovelRegressionProject());
    saveProjectWithRecovery(storage, 'novel', first, 1_000);
    const second = structuredClone(first);
    second.documents[1].blocks[0].text = '第七码盘后藏着两张车票。';
    second.updatedAt = 2_000;
    saveProjectWithRecovery(storage, 'novel', second, 2_000);

    const restored = readProjectWithRecovery(storage, 'novel');
    expect(restored.project?.documents[1].blocks[0].text).toBe('第七码盘后藏着两张车票。');
    expect(restored.backup && parseProjectData(restored.backup.data)?.documents[1].blocks[0].text)
      .toBe('第七码盘后藏着一张被水泡皱的车票。');
  });
});

describe('R17-0 互动解谜回归样例', () => {
  it('路径遍历覆盖嵌套搜查、检定双分支与撤退结局', () => {
    const project = normalizeProject(puzzleGameRegressionProject());
    const report = simulateFlow(project.flows[0], project.variables, project.entities);
    expect(report.coverage).toBe(1);
    expect(report.unreachable).toEqual([]);
    expect(report.stuck).toEqual([]);
    expect(report.loops).toEqual([]);
    expect(report.ends.end).toBe(3);
  });

  it('引擎包保持技术名、嵌套节点、附件和流程文档关联', () => {
    const project = jsonRoundTrip(puzzleGameRegressionProject());
    const pkg = buildEnginePackage(project, { assets: 'referenced', entities: 'referenced' });
    expect(pkg.index.technicalNames.manor_intro).toMatchObject({ kind: 'flow', id: 'flow-manor' });
    expect(pkg.index.technicalNames.take_brass_key).toMatchObject({
      kind: 'node', id: 'node-clue', flowId: 'flow-manor',
    });
    expect(pkg.index.nodes['node-clue'].path).toEqual(['node-search']);
    expect(pkg.attachments['node-start']).toEqual(['asset-rain']);
    expect(pkg.assets.map((asset) => asset.technicalName)).toEqual(['sfx_hall_rain']);
    expect(project.flows[0].documentId).toBe('doc-manor-script');
    expect(project.documents[0].linkedFlowId).toBe('flow-manor');
  });
});

describe('R17-0 旧版升级回归样例', () => {
  it('缺失现代字段的旧项目升级后数据完整且迁移幂等', () => {
    const project = legacyRegressionProject();
    normalizeProject(project);
    const once = JSON.stringify(project);
    normalizeProject(project);

    expect(JSON.stringify(project)).toBe(once);
    expect(project.entities[0]).toMatchObject({ id: 'legacy-entity', technicalName: 'legacy_character' });
    expect(project.flows[0].nodes[0]).toMatchObject({ id: 'legacy-node', data: { technicalName: 'legacy_line' } });
    expect(project.documents[0].blocks[0].id).toBe('legacy-block');
    expect(project.templates).toHaveLength(1);
    expect(project.templates?.[0].fields.map((field) => field.label)).toEqual(['动机', '秘密']);
    expect(project.entities[0].fields.find((field) => field.label === '动机')?.value).toBe('守住旧车站');
    expect(project.entities[0].fields.find((field) => field.label === '秘密')?.value).toBe('');
    expect(project.units?.some((unit) => unit.text === '不要忘记我。')).toBe(true);
  });
});
