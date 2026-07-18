import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { sampleProject } from '../sample';
import type { Project } from '../types';
import { fingerprintValue } from './context';
import type { AiProposal, AiProposalOperation } from './proposal';

function stubLocalStorage() {
  const memory = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, String(value)); },
    removeItem: (key: string) => { memory.delete(key); },
    clear: () => { memory.clear(); },
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() { return memory.size; },
  });
}

async function makeProposal(
  project: Project,
  operation: AiProposalOperation,
): Promise<AiProposal> {
  return {
    version: 1,
    id: 'store-proposal',
    task: 'content-edit',
    summary: '执行门测试',
    baselineProjectFingerprint: await fingerprintValue(project),
    contextSourceKeys: [],
    evidenceSourceKeys: [],
    operations: [operation],
    confirmations: [],
  };
}

function base(id: string, confidence = 0.9) {
  return { id, reason: '测试安全应用', confidence };
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
  vi.unstubAllGlobals();
});

describe('AI 提案 store 执行门', () => {
  it('通过验证的操作合并为独立撤销步骤', { timeout: 30000 }, async () => {
    stubLocalStorage();
    vi.resetModules();
    const { useLoom } = await import('../store');
    useLoom.getState().replaceProject(sampleProject());
    useLoom.getState().update((project) => { project.name += ' 用户编辑'; });
    const beforeAi = useLoom.getState().project;
    const document = beforeAi.documents[0];
    const block = document.blocks[0];
    const originalText = block.text;
    const raw = await makeProposal(beforeAi, {
      kind: 'update_document_block_text',
      ...base('text-1'),
      documentId: document.id,
      blockId: block.id,
      text: `${block.text}\nAI 修订`,
    });

    const result = await useLoom.getState().applyAiProposal(raw);

    expect(result).toMatchObject({ applied: true, reason: 'applied' });
    expect(useLoom.getState().project.documents[0].blocks[0].text).toContain('AI 修订');
    useLoom.getState().undo();
    expect(useLoom.getState().project.documents[0].blocks[0].text).toBe(originalText);
    expect(useLoom.getState().project.name).toContain('用户编辑');
  });

  it('warning 必须显式确认后才能应用', async () => {
    stubLocalStorage();
    vi.resetModules();
    const { useLoom } = await import('../store');
    useLoom.getState().replaceProject(sampleProject());
    const project = useLoom.getState().project;
    const document = project.documents[0];
    const block = document.blocks[0];
    const raw = await makeProposal(project, {
      kind: 'update_document_block_text',
      ...base('text-1', 0.2),
      documentId: document.id,
      blockId: block.id,
      text: `${block.text}\n低信心修订`,
    });

    const held = await useLoom.getState().applyAiProposal(raw);
    expect(held).toMatchObject({ applied: false, reason: 'warning-confirmation-required' });
    expect(useLoom.getState().project.documents[0].blocks[0].text).toBe(block.text);

    const applied = await useLoom.getState().applyAiProposal(raw, { confirmWarnings: true });
    expect(applied).toMatchObject({ applied: true, reason: 'applied' });
  }, 20_000);

  it('dry-run 期间项目变化会在提交前被竞态门阻止', async () => {
    stubLocalStorage();
    vi.resetModules();
    const { useLoom } = await import('../store');
    useLoom.getState().replaceProject(sampleProject());
    const project = useLoom.getState().project;
    const document = project.documents[0];
    const block = document.blocks[0];
    const raw = await makeProposal(project, {
      kind: 'update_document_block_text',
      ...base('text-1'),
      documentId: document.id,
      blockId: block.id,
      text: `${block.text}\n不应应用`,
    });

    const pending = useLoom.getState().applyAiProposal(raw);
    useLoom.getState().update((current) => { current.name += ' 并发编辑'; });
    const result = await pending;

    expect(result).toMatchObject({ applied: false, reason: 'project-changed' });
    expect(useLoom.getState().project.name).toContain('并发编辑');
    expect(useLoom.getState().project.documents[0].blocks[0].text).toBe(block.text);
  });
});
