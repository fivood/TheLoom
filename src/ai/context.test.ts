import { describe, expect, it } from 'vitest';
import { sampleProject } from '../sample';
import { DEFAULT_PROJECT_QUERY } from '../query';
import { buildAiContextBundle, fingerprintValue } from './context';

describe('AI 受控上下文包', () => {
  it('生成稳定来源引用、稳定指纹和发送前摘要', async () => {
    const project = sampleProject();
    const entity = project.entities[0];
    entity.avatar = 'data:image/png;base64,SECRET_BINARY';
    const first = await buildAiContextBundle(project, {
      primary: { tab: 'entities', entityId: entity.id },
    });
    const second = await buildAiContextBundle(project, {
      primary: { tab: 'entities', entityId: entity.id },
    });

    expect(first.projectFingerprint).toBe(second.projectFingerprint);
    expect(first.contextFingerprint).toBe(second.contextFingerprint);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].sourceRef).toMatchObject({
      key: `entity:${entity.id}`,
      id: entity.id,
      nav: { tab: 'entities', entityId: entity.id },
    });
    expect(first.items[0].trust).toBe('untrusted-project-content');
    expect(first.items[0].text).not.toContain('SECRET_BINARY');
    expect(first.summary).toMatchObject({
      objectCount: 1,
      modules: ['实体'],
      containsAiConsultation: false,
    });
  });

  it('项目正文变化会改变项目与上下文指纹，二进制预览变化不会', async () => {
    const project = sampleProject();
    const entity = project.entities[0];
    const baseline = await buildAiContextBundle(project, {
      primary: { tab: 'entities', entityId: entity.id },
    });

    entity.avatar = 'data:image/png;base64,CHANGED';
    const binaryChanged = await buildAiContextBundle(project, {
      primary: { tab: 'entities', entityId: entity.id },
    });
    expect(binaryChanged.projectFingerprint).toBe(baseline.projectFingerprint);

    entity.notes += '\n新增事实';
    const bodyChanged = await buildAiContextBundle(project, {
      primary: { tab: 'entities', entityId: entity.id },
    });
    expect(bodyChanged.projectFingerprint).not.toBe(baseline.projectFingerprint);
    expect(bodyChanged.contextFingerprint).not.toBe(baseline.contextFingerprint);
  });

  it('只扩展一跳显式引用并去重，当前对象优先于引用对象', async () => {
    const project = sampleProject();
    const document = project.documents[0];
    const entity = project.entities[0];
    document.povId = entity.id;
    document.blocks[0].speakerId = entity.id;

    const bundle = await buildAiContextBundle(project, {
      primary: { tab: 'documents', docId: document.id },
      selected: [{ tab: 'entities', entityId: entity.id }],
      includeReferences: true,
    });

    expect(bundle.items[0].sourceRef.key).toBe(`document:${document.id}`);
    expect(bundle.items.filter((item) => item.sourceRef.key === `entity:${entity.id}`)).toHaveLength(1);
    expect(bundle.items.find((item) => item.sourceRef.key === `entity:${entity.id}`)?.relation).toBe('selected');
    expect(bundle.summary.modules).toEqual(expect.arrayContaining(['文档', '实体']));
  });

  it('复用保存查询并按字符预算确定性裁剪', async () => {
    const project = sampleProject();
    const query = { ...DEFAULT_PROJECT_QUERY, objectType: 'all' as const };
    const first = await buildAiContextBundle(project, {
      query,
      charBudget: 700,
      perItemLimit: 220,
    });
    const second = await buildAiContextBundle(project, {
      query,
      charBudget: 700,
      perItemLimit: 220,
    });

    expect(first.usedChars).toBeLessThanOrEqual(700);
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.omittedCount).toBeGreaterThan(0);
    expect(first.items.some((item) => item.truncated)).toBe(true);
    expect(first.items.map((item) => item.sourceRef.key)).toEqual(
      second.items.map((item) => item.sourceRef.key),
    );
    expect(first.contextFingerprint).toBe(second.contextFingerprint);
  });

  it('规范化对象键顺序后计算 SHA-256', async () => {
    expect(await fingerprintValue({ b: 2, a: 1 })).toBe(await fingerprintValue({ a: 1, b: 2 }));
    expect(await fingerprintValue({ a: 2 })).not.toBe(await fingerprintValue({ a: 1 }));
  });
});
