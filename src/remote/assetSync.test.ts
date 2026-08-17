import { describe, expect, it } from 'vitest';
import type { Asset, Project } from '../types';
import { planAssetSync, referencedAssets } from './assetSync';

function project(assets: Partial<Asset>[]): Project {
  return { assets: assets as Asset[] } as Project;
}

describe('资源同步计划', () => {
  it('只收有内容哈希的资源 —— R8 之前的老资源没有 hash,同步不了', () => {
    const refs = referencedAssets(project([
      { hash: 'aaa', ext: 'png' },
      { hash: undefined },
      { hash: 'bbb', ext: 'wav' },
    ]));
    expect(refs.map((r) => r.hash)).toEqual(['aaa', 'bbb']);
  });

  it('同一份字节被多个资源引用时只算一次', () => {
    const refs = referencedAssets(project([
      { hash: 'same', ext: 'png' },
      { hash: 'same', ext: 'png' },
    ]));
    expect(refs).toHaveLength(1);
  });

  it('本机有、远端无 → 上传;远端有、本机无 → 下载', () => {
    const refs = referencedAssets(project([
      { hash: 'only-local', ext: 'png' },
      { hash: 'only-remote', ext: 'png' },
      { hash: 'both', ext: 'png' },
    ]));
    const plan = planAssetSync(refs, new Set(['only-local', 'both']), new Set(['only-remote', 'both']));
    expect(plan.upload.map((r) => r.hash)).toEqual(['only-local']);
    expect(plan.download.map((r) => r.hash)).toEqual(['only-remote']);
  });

  it('两边都有的不动 —— 内容寻址意味着同哈希即同字节,无需比对', () => {
    const refs = referencedAssets(project([{ hash: 'x', ext: 'png' }]));
    const plan = planAssetSync(refs, new Set(['x']), new Set(['x']));
    expect(plan.upload).toHaveLength(0);
    expect(plan.download).toHaveLength(0);
  });

  it('两边都没有的既不传也不拉(字节已丢失,同步救不回)', () => {
    const refs = referencedAssets(project([{ hash: 'gone', ext: 'png' }]));
    const plan = planAssetSync(refs, new Set(), new Set());
    expect(plan.upload).toHaveLength(0);
    expect(plan.download).toHaveLength(0);
  });
});
