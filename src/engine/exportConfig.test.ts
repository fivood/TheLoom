import { describe, expect, it } from 'vitest';
import type { EngineExportConfig, Flow, FlowTest, Project } from '../types';
import { normalizeProject } from '../util';
import { buildEnginePackage, rulesFromConfig } from './package';
import { runExportGate } from './gate';
import { BASELINE_SCHEMA, baselineFileName, parseBaseline, serializeBaseline } from './baseline';

function project(flows: Flow[], extra: Partial<Project> = {}): Project {
  return {
    version: 1, name: 'R20 测试', flows, entities: [],
    brainstormNotes: [], brainstormEdges: [], outlineColumns: [], outlineRows: [],
    timelineTracks: [], timelinePoints: [], timelineEvents: [], maps: [],
    researchCards: [], researchCategories: [], variables: [],
    assets: [], documents: [], documentCategories: [], attachments: {}, folders: [],
    updatedAt: 0,
    ...extra,
  };
}

/** 一条 a → b 的干净流程 */
function okFlow(id: string, tech?: string): Flow {
  return {
    id, name: id, technicalName: tech,
    nodes: [
      { id: `${id}-a`, type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '', text: '开场' } },
      { id: `${id}-b`, type: 'dialogue', position: { x: 1, y: 0 }, data: { title: '', text: '结束' } },
    ],
    edges: [{ id: `${id}-e`, source: `${id}-a`, target: `${id}-b` }],
  };
}

/** 条件引用了未定义变量 → 脚本错误 */
function brokenFlow(id: string): Flow {
  return {
    id, name: id,
    nodes: [
      { id: `${id}-c`, type: 'condition', position: { x: 0, y: 0 }, data: { title: '', text: '不存在的变量 > 1' } },
      { id: `${id}-t`, type: 'dialogue', position: { x: 1, y: 0 }, data: { title: '', text: '真' } },
    ],
    edges: [{ id: `${id}-e`, source: `${id}-c`, target: `${id}-t`, sourceHandle: 'true' }],
  };
}

const config = (patch: Partial<EngineExportConfig> = {}): EngineExportConfig => ({
  id: 'cfg1', name: '默认导出', createdAt: 1, updatedAt: 1, ...patch,
});

describe('R20-1 导出配置规范化', () => {
  it('剔除无名 / 重复 id 的配置,清洗枚举与闸门开关', () => {
    const p = project([okFlow('f1')]);
    p.engineExportConfigs = [
      config({ id: 'a', name: '  正常  ', entities: 'referenced', gate: { script: true, audit: 'yes' as unknown as boolean } }),
      config({ id: 'a', name: '重复 id' }),
      config({ id: 'b', name: '   ' }),
      config({ id: 'c', name: '枚举非法', entities: 'oops' as unknown as 'all', includeLayout: 1 as unknown as boolean }),
    ];
    normalizeProject(p);

    const kept = p.engineExportConfigs!;
    expect(kept.map((c) => c.id)).toEqual(['a', 'c']);
    expect(kept[0].name).toBe('正常');
    expect(kept[0].entities).toBe('referenced');
    expect(kept[0].gate).toEqual({ script: true });
    expect(kept[1].entities).toBeUndefined();
    expect(kept[1].includeLayout).toBeUndefined();
  });

  it('流程被删后配置只剔除失效 id,不回落为「全部」', () => {
    const p = project([okFlow('f1')]);
    p.engineExportConfigs = [config({ flowIds: ['f1', '已删除的流程'] })];
    normalizeProject(p);
    expect(p.engineExportConfigs![0].flowIds).toEqual(['f1']);

    // 选中的流程全被删 → 保留空数组,导出范围不会静默变大
    p.flows = [];
    normalizeProject(p);
    expect(p.engineExportConfigs![0].flowIds).toEqual([]);
    expect(buildEnginePackage(p, rulesFromConfig(p.engineExportConfigs![0])).flows).toHaveLength(0);
  });

  it('flowIds 缺省 = 全部(新建流程自动纳入),给定数组 = 精确这些', () => {
    const p = project([okFlow('f1'), okFlow('f2')]);
    expect(buildEnginePackage(p, rulesFromConfig(config())).flows.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(buildEnginePackage(p, rulesFromConfig(config({ flowIds: ['f2'] }))).flows.map((f) => f.id)).toEqual(['f2']);
  });
});

describe('R20-1 增量基线文件', () => {
  it('文件名按配置 id,并过滤非法字符', () => {
    expect(baselineFileName('abc123')).toBe('baseline-abc123.json');
    expect(baselineFileName('../etc/passwd')).toBe('baseline-etcpasswd.json');
    expect(() => baselineFileName('///')).toThrow();
  });

  it('序列化往返;非基线 JSON 一律拒绝', () => {
    const baseline = {
      schema: BASELINE_SCHEMA as typeof BASELINE_SCHEMA,
      configId: 'cfg1', configName: '默认导出', schemaVersion: '1.1.0',
      exportedAt: 123, manifest: { 'flow:f1': 'abcd', 'entity:e1': 'ef01' },
    };
    expect(parseBaseline(serializeBaseline(baseline))).toEqual(baseline);
    expect(parseBaseline('{"schema":"theloom-package"}')).toBeNull();
    expect(parseBaseline('not json')).toBeNull();
    // manifest 里的非字符串值被丢弃,不会污染增量比较
    const dirty = parseBaseline(JSON.stringify({ ...baseline, manifest: { ok: 'x', bad: 42 } }));
    expect(dirty!.manifest).toEqual({ ok: 'x' });
  });
});

describe('R20-1 导出前闸门', () => {
  it('范围外流程的脚本错误不阻断导出', () => {
    const p = project([okFlow('good'), brokenFlow('bad')]);

    const all = runExportGate(p, config());
    expect(all.ok).toBe(false);
    expect(all.blocking.some((i) => i.source === 'script')).toBe(true);

    // 只导干净流程 → 坏流程的问题与本次交付无关
    const scoped = runExportGate(p, config({ flowIds: ['good'] }));
    expect(scoped.ok).toBe(true);
    expect(scoped.blocking).toHaveLength(0);
  });

  it('关掉某项检查后它不再阻断,并记入未检查清单', () => {
    const p = project([brokenFlow('bad')]);
    expect(runExportGate(p, config()).ok).toBe(false);

    const relaxed = runExportGate(p, config({ gate: { script: false, audit: false, paths: false, tests: false } }));
    expect(relaxed.ok).toBe(true);
    expect(relaxed.skipped).toEqual(['脚本检查', '高级体检', '路径测试', '回归测试']);
  });

  it('回归测试失败会阻断;目标流程不在包内时跳过该测试', () => {
    // 断言一个根本不存在的节点被访问过 → 这条测试必然失败
    const failing: FlowTest = {
      id: 't1', name: '必须走到结局', flowRef: 'target', seed: 1, choices: [],
      assertions: [{ kind: 'nodeVisited', node: '不存在的节点', expect: true }],
      updatedAt: 0,
    };
    const p = project([okFlow('f1', 'target'), okFlow('f2', 'other')], { flowTests: [failing] });

    const withTest = runExportGate(p, config());
    expect(withTest.ok).toBe(false);
    expect(withTest.testsRun).toBe(1);
    expect(withTest.failedTests.map((t) => t.name)).toEqual(['必须走到结局']);

    // 导出范围里没有 target 流程 → 这条测试不参与判定
    const other = runExportGate(p, config({ flowIds: ['f2'] }));
    expect(other.ok).toBe(true);
    expect(other.testsRun).toBe(0);
  });

  it('警告默认只报告;开 blockOnWarnings 后升级为阻断', () => {
    // 空对白是警告级问题
    const p = project([{
      id: 'f1', name: 'f1',
      nodes: [{ id: 'n1', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '', text: '' } }],
      edges: [],
    }]);

    const lenient = runExportGate(p, config());
    expect(lenient.warnings.length).toBeGreaterThan(0);
    expect(lenient.ok).toBe(true);

    const strict = runExportGate(p, config({ gate: { blockOnWarnings: true } }));
    expect(strict.ok).toBe(false);
    expect(strict.blocking.length).toBeGreaterThan(0);
  });
});
