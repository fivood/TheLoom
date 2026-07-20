import { describe, expect, it } from 'vitest';
import { sampleProject } from './sample';
import { normalizeProject, uid } from './util';
import { searchProject } from './search';
import type { DocBlock, FlowNode } from './types';

/** 起点是 sample:清空 flows/documents 得到测试用的裸项目 */
function emptyProject() {
  const p = sampleProject();
  p.flows = [{ id: uid(), name: '测试流程', nodes: [], edges: [] }];
  p.documents = [];
  return p;
}

/**
 * 共享叙事单元:同一 unitId 出现在流程节点 + 文档块时,
 * 搜索结果应两处都携带 unitId,UI 层据此打⇄徽标提示是同一份内容。
 */
describe('searchProject 共享叙事单元标注', () => {
  it('unitId 从流程节点和文档块透传到 SearchHit', () => {
    const p = emptyProject();
    const unitId = uid();
    const flowNode: FlowNode = {
      id: uid(), type: 'dialogue',
      position: { x: 0, y: 0 },
      data: { title: '雨夜台词', text: '灯塔的光在雾里转了三圈。', unitId },
    };
    p.flows[0].nodes.push(flowNode);
    const block: DocBlock = { id: uid(), type: 'dialogue', text: '灯塔的光在雾里转了三圈。', unitId };
    p.documents.push({
      id: uid(), name: '开场', category: '正文',
      blocks: [block], notes: '', createdAt: Date.now(), updatedAt: Date.now(),
    });
    normalizeProject(p);

    const hits = searchProject(p, '灯塔');
    const flowHit = hits.find((h) => h.module === '流程');
    const docHit = hits.find((h) => h.module === '文档');
    expect(flowHit?.unitId).toBe(unitId);
    expect(docHit?.unitId).toBe(unitId);
  });

  it('文档多块命中时不设 unitId,避免误配', () => {
    const p = emptyProject();
    p.documents.push({
      id: uid(), name: '两处提到灯塔', category: '正文',
      blocks: [
        { id: uid(), type: 'action', text: '灯塔亮起', unitId: uid() },
        { id: uid(), type: 'action', text: '灯塔熄灭', unitId: uid() },
      ],
      notes: '', createdAt: Date.now(), updatedAt: Date.now(),
    });
    normalizeProject(p);
    const hit = searchProject(p, '灯塔').find((h) => h.module === '文档');
    expect(hit).toBeTruthy();
    expect(hit?.unitId).toBeUndefined();
  });
});
