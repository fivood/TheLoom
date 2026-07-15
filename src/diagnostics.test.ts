import { describe, expect, it } from 'vitest';
import { sampleProject } from './sample';
import {
  createDiagnosticReport, getStorageUsage, inspectProjectImport,
  readDiagnosticErrors, recordDiagnosticError,
} from './diagnostics';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('存储容量统计', () => {
  it('按 localStorage 的 UTF-16 字符估算占用', () => {
    const storage = new MemoryStorage();
    storage.setItem('ab', '中文');
    expect(getStorageUsage(storage)).toEqual({ bytes: 8, entries: 1, available: true });
  });
});

describe('项目导入预检', () => {
  it('发现重复 ID、断裂连线和悬挂附件', () => {
    const project = sampleProject();
    project.entities[1].id = project.entities[0].id;
    project.flows[0].edges.push({ id: 'broken-edge', source: 'missing', target: project.flows[0].nodes[0].id });
    project.attachments = { owner: ['missing-asset'] };

    const inspection = inspectProjectImport(JSON.stringify(project), 'project.json');
    const kinds = inspection.issues.map((issue) => issue.kind);
    expect(kinds).toContain('重复 ID');
    expect(kinds).toContain('断裂连线');
    expect(kinds).toContain('悬挂附件');
  });

  it('拒绝结构损坏的 JSON', () => {
    expect(() => inspectProjectImport('{"version":1}', 'bad.json')).toThrow('项目结构已经损坏');
  });
});

describe('诊断包', () => {
  it('记录有限数量的错误并且报告不包含项目正文', () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 25; index++) recordDiagnosticError(storage, 'test', new Error(`error-${index}`), '', index);
    expect(readDiagnosticErrors(storage)).toHaveLength(20);

    const project = sampleProject();
    project.researchCards[0].content = '绝密正文标记';
    const report = createDiagnosticReport(project, {
      storage: getStorageUsage(storage),
      saveStatus: 'saved', saveError: null, syncError: null,
      recoveryCreatedAt: null, quarantineCreatedAt: null, isDesktop: false,
    });
    expect(JSON.stringify(report)).not.toContain('绝密正文标记');
    expect(report.privacy).toContain('不包含');
  });
});
