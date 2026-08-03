import { describe, expect, it } from 'vitest';
import type { Flow, Project } from '../types';
import { buildEnginePackage } from './package';
import { buildBundleFiles, CHECKSUMS_FILE, LICENSES_FILE, licensesMarkdown, RUNTIME_FILE } from './bundle';
import type { ZipInputFile } from '../interop/zip';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function project(): Project {
  const flow: Flow = {
    id: 'f1', name: '第一幕', technicalName: 'act1',
    nodes: [{ id: 'n1', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '', text: '雨夜' } }],
    edges: [],
  };
  return {
    version: 1, name: '自包含测试', flows: [flow], entities: [],
    brainstormNotes: [], brainstormEdges: [], outlineColumns: [], outlineRows: [],
    timelineTracks: [], timelinePoints: [], timelineEvents: [], maps: [],
    researchCards: [], researchCategories: [], variables: [],
    assets: [
      {
        id: 'a1', name: '主题曲', kind: 'audio', mime: 'audio/wav', size: 4, tags: [], source: '作曲:某某',
        notes: '', createdAt: 0, hash: HASH_A, ext: 'wav', license: 'CC-BY 4.0',
      },
      {
        id: 'a2', name: '未标授权的图', kind: 'image', mime: 'image/png', size: 3, tags: [], source: '',
        notes: '', createdAt: 0, hash: HASH_B, ext: 'png',
      },
      {
        id: 'a3', name: '只有缩略图的老资源', kind: 'image', mime: 'image/png', size: 0, tags: [], source: '',
        notes: '', createdAt: 0,
      },
    ],
    documents: [], documentCategories: [], attachments: {}, folders: [],
    updatedAt: 0,
  };
}

const baseFiles: ZipInputFile[] = [
  { name: 'theloom-package.json', content: '{"schema":"theloom-package"}' },
  { name: 'README.md', content: '# 说明' },
];

const names = (files: ZipInputFile[]) => files.map((f) => f.name);

describe('R20-2 自包含引擎包', () => {
  it('默认(全关)只有数据包文件', async () => {
    const pkg = buildEnginePackage(project());
    const result = await buildBundleFiles(pkg, baseFiles, {
      bundle: {},
      readAssetBytes: async () => new Uint8Array([1, 2, 3]),
    });
    expect(names(result.files)).toEqual(['theloom-package.json', 'README.md']);
    expect(result.assetCount).toBe(0);
    expect(result.missingAssets).toEqual([]);
  });

  it('勾原文件后字节进 assets/,同一份字节只写一次', async () => {
    const p = project();
    // 两个资源指向同一份内容(内容寻址天然去重)
    p.assets[1].hash = HASH_A;
    p.assets[1].ext = 'wav';
    const pkg = buildEnginePackage(p);
    const reads: string[] = [];
    const result = await buildBundleFiles(pkg, baseFiles, {
      bundle: { assetFiles: true },
      readAssetBytes: async (asset) => { reads.push(asset.id); return new Uint8Array([1, 2, 3, 4]); },
    });

    expect(names(result.files)).toContain('assets/asset-aaaaaaaaaaaaaaaa.wav');
    expect(result.assetCount).toBe(1);
    expect(result.assetBytes).toBe(4);
    // 第二个资源命中同名文件,不重复读也不重复写
    expect(reads).toEqual(['a1']);
    // 没有 hash 的老资源如实报告
    expect(result.missingAssets).toEqual([
      { id: 'a3', name: '只有缩略图的老资源', fileName: '', reason: '从未保存原文件' },
    ]);
  });

  it('原文件读不到时报告为丢失,不静默跳过', async () => {
    const pkg = buildEnginePackage(project());
    const result = await buildBundleFiles(pkg, baseFiles, {
      bundle: { assetFiles: true },
      readAssetBytes: async (asset) => (asset.id === 'a1' ? new Uint8Array([9]) : null),
    });
    expect(result.assetCount).toBe(1);
    expect(result.missingAssets.map((m) => [m.name, m.reason])).toEqual([
      ['未标授权的图', '原文件丢失'],
      ['只有缩略图的老资源', '从未保存原文件'],
    ]);
  });

  it('运行库源码为空时不写空文件', async () => {
    const pkg = buildEnginePackage(project());
    const withRuntime = await buildBundleFiles(pkg, baseFiles, {
      bundle: { runtime: true },
      readAssetBytes: async () => null,
      runtimeSource: 'export class FlowRuntime {}',
    });
    expect(names(withRuntime.files)).toContain(RUNTIME_FILE);

    const without = await buildBundleFiles(pkg, baseFiles, {
      bundle: { runtime: true },
      readAssetBytes: async () => null,
      runtimeSource: '',
    });
    expect(names(without.files)).not.toContain(RUNTIME_FILE);
  });

  it('校验清单覆盖包内所有文件但不含自身,哈希为真实 SHA-256', async () => {
    const pkg = buildEnginePackage(project());
    // 掺一个标准测试向量文件:"abc" 的 SHA-256 是公认常量,能证明算的是真 SHA-256
    const withVector = [...baseFiles, { name: 'vector.txt', content: 'abc' }];
    const result = await buildBundleFiles(pkg, withVector, {
      bundle: { assetFiles: true, checksums: true },
      readAssetBytes: async () => new Uint8Array([1]),
    });

    const checksums = result.files.find((f) => f.name === CHECKSUMS_FILE)!;
    const parsed = JSON.parse(String(checksums.content)) as { files: Record<string, string> };
    const listed = Object.keys(parsed.files).sort();
    const expected = names(result.files).filter((n) => n !== CHECKSUMS_FILE).sort();
    expect(listed).toEqual(expected);
    expect(parsed.files[CHECKSUMS_FILE]).toBeUndefined();
    expect(parsed.files['vector.txt'])
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // 二进制条目也进表(Uint8Array 与文本走同一条哈希路径)
    expect(parsed.files['assets/asset-aaaaaaaaaaaaaaaa.wav']).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.files[LICENSES_FILE]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('授权表列出全部资源,并点名未标授权的', () => {
    const md = licensesMarkdown(buildEnginePackage(project()));
    expect(md).toContain('| 主题曲 | audio | asset-aaaaaaaaaaaaaaaa.wav | CC-BY 4.0 | 作曲:某某 |');
    expect(md).toContain('未标授权的图');
    // 无授权的两个资源被点名提示
    expect(md).toContain('2 个资源未标注授权');
  });
});
