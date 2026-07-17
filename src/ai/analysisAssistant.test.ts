import { describe, expect, it } from 'vitest';
import { sampleProject } from '../sample';
import type { Project } from '../types';
import { normalizeProject } from '../util';
import { buildAnalysisBlocks } from './analysis';
import { runNarrativeAnalysis } from './analysisAssistant';
import { MockLlmClient } from './mock';
import type { StructuredRequest } from './llm';

function baseProject(): Project {
  const p = structuredClone(sampleProject());
  p.flows = [{
    id: 'f1', name: '主线',
    nodes: [
      { id: 'n1', type: 'dialogue', position: { x: 0, y: 0 }, data: { title: '开场', text: '……我看到了。', speakerId: 'char1' } },
      { id: 'n2', type: 'hub', position: { x: 200, y: 0 }, data: { title: '抉择', text: '' } },
      { id: 'n3', type: 'dialogue', position: { x: 400, y: 0 }, data: { title: '结局甲', text: '完' } },
      { id: 'n4', type: 'dialogue', position: { x: 400, y: 90 }, data: { title: '孤岛', text: '到不了' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3', label: '走' },
      { id: 'e3', source: 'n2', target: 'n4', label: '永远走不到', condition: '1 > 2' },
    ],
  }];
  p.entities = [{
    id: 'char1', kind: 'character', name: '塞茉薇', summary: '', notes: '', fields: [], tags: [], color: '#565550',
  } as never];
  p.documents = [{
    id: 'd1', name: '第一场', category: '', blocks: [
      { id: 'b1', type: 'dialogue', text: '雨要停了。', speakerId: 'char1' },
    ], createdAt: 1, updatedAt: 1, povId: 'char1', timeLabel: '第一夜',
  } as never];
  p.units = [];
  p.foreshadows = [{
    id: 'fs1', title: '怀表', note: '', plants: [{ docId: 'd1' }], payoffs: [], createdAt: 1,
  } as never];
  return normalizeProject(p);
}

describe('buildAnalysisBlocks(本地统计)', () => {
  it('paths:覆盖率、终局与不可达节点', () => {
    const blocks = buildAnalysisBlocks(baseProject(), 'paths', 'f1');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].key).toBe('analysis:paths:f1');
    expect(blocks[0].text).toContain('节点覆盖率');
    expect(blocks[0].text).toContain('孤岛');
    expect(blocks[0].nav).toMatchObject({ tab: 'flow', flowId: 'f1' });
  });

  it('voice:跨流程与文档收集台词样本', () => {
    const blocks = buildAnalysisBlocks(baseProject(), 'voice', 'char1');
    expect(blocks[0].text).toContain('[流程·主线] ……我看到了。');
    expect(blocks[0].text).toContain('[文档·第一场] 雨要停了。');
  });

  it('foreshadow:状态与埋设/回收位置', () => {
    const blocks = buildAnalysisBlocks(baseProject(), 'foreshadow');
    expect(blocks[0].text).toContain('「怀表」[待回收]');
    expect(blocks[0].text).toContain('第一场');
    expect(blocks[0].text).toContain('(未回收)');
  });

  it('consistency:场景元数据与体检问题', () => {
    const blocks = buildAnalysisBlocks(baseProject(), 'consistency');
    const scenes = blocks.find((block) => block.key === 'analysis:consistency:scenes');
    expect(scenes?.text).toContain('POV=塞茉薇');
    expect(scenes?.text).toContain('第一夜');
  });

  it('缺少必选目标时报错', () => {
    expect(() => buildAnalysisBlocks(baseProject(), 'paths')).toThrow('流程');
  });
});

describe('runNarrativeAnalysis', () => {
  it('事实保留有效引用;无依据的事实降级为推断;未知引用被忽略', async () => {
    const project = baseProject();
    const client = new MockLlmClient([{
      type: 'structured',
      data: {
        summary: '主线只有一条可行路径,孤岛节点不可达。',
        findings: [
          { type: 'fact', text: '「孤岛」节点无法从任何路径到达。', citations: ['analysis:paths:f1'] },
          { type: 'fact', text: '玩家会觉得选择太少。', citations: [] },
          { type: 'inference', text: '抉择点只有一条出边,疑似分支未做完。', citations: ['analysis:paths:f1', 'ctx:nope'] },
          { type: 'suggestion', text: '给「抉择」补第二条出边通往「孤岛」。', citations: [] },
        ],
      },
      usage: { totalTokens: 210 },
    }]);

    const result = await runNarrativeAnalysis(client, project, 'paths', 'f1', null, '看看分支');
    expect(result.summary).toContain('孤岛');
    const [fact, downgraded, inference, suggestion] = result.findings;
    expect(fact.type).toBe('fact');
    expect(fact.downgraded).toBeUndefined();
    expect(fact.citations[0]).toMatchObject({ key: 'analysis:paths:f1', title: '路径测试 · 主线' });
    expect(downgraded).toMatchObject({ type: 'inference', downgraded: true });
    expect(inference.type).toBe('inference');
    expect(inference.citations).toHaveLength(1);
    expect(suggestion.type).toBe('suggestion');
    expect(result.ignoredCitationKeys).toEqual(['ctx:nope']);
    expect(result.usage?.totalTokens).toBe(210);

    const request = client.calls[0].request as StructuredRequest;
    expect(request.user).toContain('analysis_data');
    expect(request.user).toContain('看看分支');
    expect(request.system).toContain('fact');
    expect(request.system).toContain('不可信');
  });

});
