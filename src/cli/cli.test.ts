import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EngineExportConfig, Project } from '../types';
import { parseArgs, pickConfig, EXIT } from './main';
import { syncToDirectory, SYNC_MANIFEST } from './sync';
import { loadProjectFromDir } from './loadProject';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'theloom-cli-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const config = (patch: Partial<EngineExportConfig> = {}): EngineExportConfig => ({
  id: 'c1', name: '默认', createdAt: 1, updatedAt: 1, ...patch,
});

function baseProject(): Project {
  return {
    version: 1, name: 'CLI 测试',
    flows: [{
      id: 'f1', name: '雨夜', technicalName: 'rain_night',
      nodes: [{ id: 'n1', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '', text: '雨' } }],
      edges: [],
    }],
    entities: [], brainstormNotes: [], brainstormEdges: [], outlineColumns: [], outlineRows: [],
    timelineTracks: [], timelinePoints: [], timelineEvents: [], maps: [],
    researchCards: [], researchCategories: [], variables: [],
    assets: [], documents: [], documentCategories: [], attachments: {}, folders: [],
    updatedAt: 1234,
  };
}

describe('CLI 参数解析', () => {
  it('解析常用参数与短选项', () => {
    const parsed = parseArgs(['export', '-p', '/proj', '-c', '我的配置', '-o', 'out.zip', '--clean', '--json']);
    expect(parsed).toMatchObject({ project: '/proj', config: '我的配置', out: 'out.zip', clean: true, json: true, gate: true });
  });

  it('--no-gate 关闭闸门;--flows 拆成数组', () => {
    const parsed = parseArgs(['export', '-p', '/proj', '--no-gate', '--flows', 'a, b ,c']);
    expect(parsed).toMatchObject({ gate: false, flows: ['a', 'b', 'c'] });
  });

  it('缺 --project、未知参数、未知命令都报错而不是硬跑', () => {
    expect(parseArgs(['export'])).toHaveProperty('error');
    expect(parseArgs(['export', '-p', '/x', '--nope'])).toHaveProperty('error');
    expect(parseArgs(['deploy'])).toHaveProperty('error');
    expect(parseArgs(['export', '-p'])).toHaveProperty('error');
    expect(parseArgs([])).toHaveProperty('help');
  });
});

describe('CLI 配置选取', () => {
  it('按名字选;没给名字用第一个;项目无配置时回落默认规则', () => {
    const p = baseProject();
    p.engineExportConfigs = [config({ id: 'a', name: '甲' }), config({ id: 'b', name: '乙' })];
    expect(pickConfig(p, '乙')).toMatchObject({ id: 'b' });
    expect(pickConfig(p)).toMatchObject({ id: 'a' });

    delete p.engineExportConfigs;
    const fallback = pickConfig(p);
    expect(fallback).toMatchObject({ name: '默认规则' });
    expect('error' in fallback).toBe(false);
  });

  it('名字不存在时报错并列出已有配置', () => {
    const p = baseProject();
    p.engineExportConfigs = [config({ name: '甲' })];
    const picked = pickConfig(p, '不存在');
    expect(picked).toHaveProperty('error');
    expect((picked as { error: string }).error).toContain('甲');
  });
});

describe('目录同步', () => {
  it('只写内容变了的文件;未变的跳过', () => {
    const dir = tempDir();
    const files = [
      { name: 'a.json', content: '{"x":1}' },
      { name: 'nested/b.txt', content: 'hello' },
    ];
    const first = syncToDirectory(dir, files, false);
    expect(first.written.sort()).toEqual(['a.json', 'nested/b.txt']);
    expect(first.skipped).toEqual([]);

    const second = syncToDirectory(dir, files, false);
    expect(second.written).toEqual([]);
    expect(second.skipped.sort()).toEqual(['a.json', 'nested/b.txt']);

    const changed = syncToDirectory(dir, [{ name: 'a.json', content: '{"x":2}' }, files[1]], false);
    expect(changed.written).toEqual(['a.json']);
    expect(changed.skipped).toEqual(['nested/b.txt']);
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('{"x":2}');
  });

  it('二进制内容按字节比较', () => {
    const dir = tempDir();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(syncToDirectory(dir, [{ name: 'x.bin', content: bytes }], false).written).toEqual(['x.bin']);
    expect(syncToDirectory(dir, [{ name: 'x.bin', content: bytes }], false).skipped).toEqual(['x.bin']);
    expect(syncToDirectory(dir, [{ name: 'x.bin', content: new Uint8Array([9]) }], false).written).toEqual(['x.bin']);
  });

  it('--clean 只删自己上次写过的文件,不碰目录里的其他东西', () => {
    const dir = tempDir();
    syncToDirectory(dir, [{ name: 'keep.txt', content: 'a' }, { name: 'stale.txt', content: 'b' }], false);
    // 引擎工程里本来就有的文件
    writeFileSync(join(dir, 'engine-own.cfg'), 'not ours');

    const result = syncToDirectory(dir, [{ name: 'keep.txt', content: 'a' }], true);
    expect(result.removed).toEqual(['stale.txt']);
    expect(readFileSync(join(dir, 'engine-own.cfg'), 'utf8')).toBe('not ours');
    // 清单记录本次产出,供下次 --clean 参照
    const manifest = JSON.parse(readFileSync(join(dir, SYNC_MANIFEST), 'utf8')) as { files: string[] };
    expect(manifest.files).toEqual(['keep.txt']);
  });

  it('不带 --clean 时陈旧文件保留', () => {
    const dir = tempDir();
    syncToDirectory(dir, [{ name: 'stale.txt', content: 'b' }], false);
    const result = syncToDirectory(dir, [{ name: 'other.txt', content: 'c' }], false);
    expect(result.removed).toEqual([]);
    expect(readFileSync(join(dir, 'stale.txt'), 'utf8')).toBe('b');
  });
});

describe('CLI 读项目文件夹', () => {
  it('读 project.json 与 entities/*.md,md 内容为准', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'project.json'), JSON.stringify(baseProject()));
    mkdirSync(join(dir, 'entities'));
    writeFileSync(join(dir, 'entities', '林晚.md'),
      '---\nloom: entity\nid: e1\nkind: character\ncreatedAt: 0\ntechnicalName: linwan\n---\n\n主角简介。\n');

    const { project } = loadProjectFromDir(dir);
    expect(project.name).toBe('CLI 测试');
    expect(project.flows).toHaveLength(1);
    expect(project.entities.map((e) => [e.name, e.technicalName])).toEqual([['林晚', 'linwan']]);
    expect(project.entities[0].summary).toBe('主角简介。');
  });

  it('project.json 损坏时回落 .bak 并标记', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'project.json'), '{broken');
    writeFileSync(join(dir, 'project.json.bak'), JSON.stringify(baseProject()));
    const loaded = loadProjectFromDir(dir);
    expect(loaded.recoveredFromBackup).toBe(true);
    expect(loaded.project.name).toBe('CLI 测试');
  });

  it('两份都不可用时明确报错', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'project.json'), '{broken');
    expect(() => loadProjectFromDir(dir)).toThrow(/project\.json/);
  });
});

describe('退出码约定', () => {
  it('各类失败有互不相同的码,便于 CI 分流', () => {
    const codes = Object.values(EXIT);
    expect(new Set(codes).size).toBe(codes.length);
    expect(EXIT.ok).toBe(0);
    expect(EXIT.auditFailed).not.toBe(EXIT.testsFailed);
  });
});
