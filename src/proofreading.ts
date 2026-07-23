import type { DocBlock, Project } from './types';

export type ProofreadingCategory = 'duplicate' | 'punctuation' | 'width' | 'name';

export interface ProofreadingIssue {
  id: string;
  category: ProofreadingCategory;
  docId?: string;
  blockId?: string;
  entityId?: string;
  message: string;
  excerpt: string;
  suggestion: string;
}

const CATEGORY_LABEL: Record<ProofreadingCategory, string> = {
  duplicate: '重复词',
  punctuation: '连续标点',
  width: '全半角',
  name: '称谓 / 专名',
};

export { CATEGORY_LABEL as PROOFREADING_CATEGORY_LABEL };

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function issueId(category: ProofreadingCategory, location: string, value: string): string {
  return `proof-${category}-${hash(`${location}:${value}`)}`;
}

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 14);
  const end = Math.min(text.length, index + length + 18);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function blockText(block: DocBlock): string {
  const values = [block.text];
  for (const item of block.items ?? []) values.push(item);
  for (const choice of block.choices ?? []) values.push(choice.label);
  return values.filter(Boolean).join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pushMatches(
  issues: ProofreadingIssue[],
  category: ProofreadingCategory,
  documentId: string,
  blockId: string,
  text: string,
  regex: RegExp,
  message: (value: string) => string,
  suggestion: (value: string) => string,
): void {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const value = match[0];
    const location = `${documentId}:${blockId}:${match.index}`;
    issues.push({
      id: issueId(category, location, value),
      category,
      docId: documentId,
      blockId,
      message: message(value),
      excerpt: excerpt(text, match.index, value.length),
      suggestion: suggestion(value),
    });
    if (value.length === 0) regex.lastIndex++;
  }
}

function scanBlock(issues: ProofreadingIssue[], docId: string, block: DocBlock): void {
  if (block.type === 'condition' || block.type === 'instruction') return;
  const text = blockText(block);
  if (!text) return;

  pushMatches(
    issues, 'duplicate', docId, block.id, text,
    /([\p{Script=Han}]{2,4})\s*\1/gu,
    (value) => `疑似重复词「${value.replace(/\s/g, '')}」`,
    () => '确认是否误重复；如为叠词可标记已核对',
  );
  pushMatches(
    issues, 'duplicate', docId, block.id, text,
    /\b([A-Za-z]{2,})\s+\1\b/giu,
    (value) => `疑似英文重复词「${value}」`,
    () => '删除重复单词，或标记已核对',
  );
  pushMatches(
    issues, 'punctuation', docId, block.id, text,
    /[，。！？；：、,.!?;:]{2,}/gu,
    (value) => `连续标点「${value}」`,
    () => '确认语气后保留一个标点；刻意语气可标记已核对',
  );
  pushMatches(
    issues, 'width', docId, block.id, text,
    /[Ａ-Ｚａ-ｚ０-９　]+/gu,
    (value) => `发现全角字母、数字或空格「${value}」`,
    () => '统一转换为半角字母、数字或普通空格',
  );

  const halfWidth = /[,!?;:]/g;
  let match: RegExpExecArray | null;
  while ((match = halfWidth.exec(text))) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + 1);
    const previous = [...before].pop() ?? '';
    const next = [...after][0] ?? '';
    if (!/\p{Script=Han}/u.test(previous) && !/\p{Script=Han}/u.test(next)) continue;
    const value = match[0];
    issues.push({
      id: issueId('width', `${docId}:${block.id}:${match.index}`, value),
      category: 'width',
      docId,
      blockId: block.id,
      message: `中文语境中使用半角标点「${value}」`,
      excerpt: excerpt(text, match.index, 1),
      suggestion: `建议改为${({ ',': '，', '!': '！', '?': '？', ';': '；', ':': '：' } as Record<string, string>)[value]}`,
    });
  }
}

function scanNames(project: Project, issues: ProofreadingIssue[]): void {
  const ownership = new Map<string, { id: string; name: string }[]>();
  for (const entity of project.entities) {
    for (const form of [entity.name, ...(entity.aliases ?? [])]) {
      const key = form.trim().toLocaleLowerCase();
      if (!key) continue;
      ownership.set(key, [...(ownership.get(key) ?? []), { id: entity.id, name: entity.name }]);
    }
  }
  for (const [form, owners] of ownership) {
    const unique = [...new Map(owners.map((owner) => [owner.id, owner])).values()];
    if (unique.length < 2) continue;
    issues.push({
      id: issueId('name', 'project', `${form}:${unique.map((owner) => owner.id).join(',')}`),
      category: 'name',
      entityId: unique[0].id,
      message: `称谓「${form}」同时属于 ${unique.map((owner) => owner.name).join('、')}`,
      excerpt: unique.map((owner) => owner.name).join(' / '),
      suggestion: '在实体库中调整重复别名，避免角色识别歧义',
    });
  }

  const proseTypes = new Set(['paragraph', 'action', 'quote']);
  for (const document of project.documents) {
    const proseBlocks = document.blocks.filter((block) => proseTypes.has(block.type));
    const prose = proseBlocks.map(blockText).join('\n');
    if (!prose) continue;
    for (const entity of project.entities) {
      const forms = [...new Set([entity.name, ...(entity.aliases ?? [])].map((form) => form.trim()).filter((form) => form.length >= 2))];
      const used = forms.filter((form) => prose.includes(form));
      if (used.length > 1) {
        const anchor = proseBlocks.find((block) => used.some((form) => blockText(block).includes(form)));
        issues.push({
          id: issueId('name', document.id, `${entity.id}:${used.join('|')}`),
          category: 'name',
          docId: document.id,
          blockId: anchor?.id,
          entityId: entity.id,
          message: `「${entity.name}」在同一场景混用称谓：${used.join('、')}`,
          excerpt: used.join(' / '),
          suggestion: '确认叙述视角后统一称谓；对白中的有意昵称不在此检查范围',
        });
      }

      for (const form of forms.filter((value) => /[A-Za-z]/.test(value))) {
        const matches = prose.match(new RegExp(escapeRegExp(form), 'gi')) ?? [];
        const variants = [...new Set(matches)];
        if (variants.length < 2) continue;
        const anchor = proseBlocks.find((block) => variants.some((variant) => blockText(block).includes(variant)));
        issues.push({
          id: issueId('name', document.id, `${entity.id}:case:${variants.join('|')}`),
          category: 'name',
          docId: document.id,
          blockId: anchor?.id,
          entityId: entity.id,
          message: `专名大小写不一致：${variants.join('、')}`,
          excerpt: variants.join(' / '),
          suggestion: `建议统一为「${form}」`,
        });
      }
    }
  }
}

export function proofreadProject(project: Project): ProofreadingIssue[] {
  const issues: ProofreadingIssue[] = [];
  for (const document of project.documents) {
    for (const block of document.blocks) scanBlock(issues, document.id, block);
  }
  scanNames(project, issues);
  return [...new Map(issues.map((issue) => [issue.id, issue])).values()];
}
