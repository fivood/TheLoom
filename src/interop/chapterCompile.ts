/**
 * R13-5 章节编译:按文件夹顺序拼接选中的文档,输出成品稿件。
 *
 * 三种输出格式:
 *   md   → 每篇文档以 `# 卷 / 章` + `## 文档名` 起,正文走 documentToMarkdown
 *   txt  → 纯文本,标题用中文分隔线包裹
 *   fdx  → Final Draft:每篇文档前插一条 Scene Heading(卷/章 · 场景),
 *          正文走 documentToParagraphs;所有文档合成一份 fdx
 *
 * 顺序按 `linearizeByFolders`(与 Navigator 树顺序一致)。
 */
import type { Document, Project } from '../types';
import { documentWordCount, folderPath, linearizeByFolders } from '../util';
import { documentToMarkdown } from '../export';
import {
  documentToParagraphs,
  paragraphsToFdx,
  type FdxParagraph,
} from './fdx';

export type CompileFormat = 'md' | 'txt' | 'fdx';

export interface CompileOptions {
  format: CompileFormat;
  /** 参与编译的文档 id 集合(空集 = 全部);顺序不由集合决定,仍走 folder 树顺序 */
  documentIds?: Set<string>;
  /** 在每篇文档前显示所在卷/章路径 */
  includeFolderPath?: boolean;
}

export interface CompileResult {
  content: string;
  mime: string;
  extension: 'md' | 'txt' | 'fdx';
  docCount: number;
  totalWords: number;
  /** 按顺序参与编译的文档,供 UI 显示 */
  documents: Document[];
}

/** 主入口 */
export function compileDocuments(project: Project, options: CompileOptions): CompileResult {
  const { format, documentIds, includeFolderPath = true } = options;
  const linear = linearizeByFolders(project.documents, project.folders, 'document');
  const filter = documentIds && documentIds.size > 0
    ? (d: Document) => documentIds.has(d.id)
    : () => true;
  const docs = linear.filter(filter);

  const totalWords = docs.reduce((sum, d) => sum + documentWordCount(d), 0);

  let content: string;
  let mime: string;
  let extension: 'md' | 'txt' | 'fdx';

  if (format === 'md') {
    content = docs.map((d) => renderDocMd(project, d, includeFolderPath)).join('\n\n');
    mime = 'text/markdown';
    extension = 'md';
  } else if (format === 'txt') {
    content = docs.map((d) => renderDocTxt(project, d, includeFolderPath)).join('\n\n');
    mime = 'text/plain';
    extension = 'txt';
  } else {
    const paragraphs: FdxParagraph[] = [];
    for (const d of docs) {
      if (includeFolderPath) {
        const head = fdxSceneHeading(project, d);
        if (head) paragraphs.push({ type: 'Scene Heading', text: head });
      }
      paragraphs.push(...documentToParagraphs(d, project.entities));
    }
    content = paragraphsToFdx(paragraphs, project.name);
    mime = 'application/xml';
    extension = 'fdx';
  }

  return { content, mime, extension, docCount: docs.length, totalWords, documents: docs };
}

function renderDocMd(project: Project, doc: Document, includeFolderPath: boolean): string {
  const path = includeFolderPath ? folderPath(doc.folderId, project.folders) : '';
  const heading = path ? `# ${path}\n\n## ${doc.name}` : `# ${doc.name}`;
  return `${heading}\n\n${documentToMarkdown(doc, project.entities).trim()}`;
}

function renderDocTxt(project: Project, doc: Document, includeFolderPath: boolean): string {
  const path = includeFolderPath ? folderPath(doc.folderId, project.folders) : '';
  const parts: string[] = [];
  if (path) parts.push(`—— ${path} ——`);
  parts.push(doc.name);
  parts.push('');
  for (const b of doc.blocks) {
    switch (b.type) {
      case 'heading':
      case 'subheading':
        parts.push(b.text);
        break;
      case 'dialogue': {
        const speaker = project.entities.find((e) => e.id === b.speakerId)?.name;
        parts.push(speaker ? `${speaker}:${b.text}` : b.text);
        break;
      }
      case 'quote':
        parts.push(b.text.split('\n').map((l) => `> ${l}`).join('\n'));
        break;
      case 'list':
        for (const item of b.items ?? []) if (item.trim()) parts.push(`• ${item}`);
        break;
      case 'choice':
        parts.push(b.text ? `选项:${b.text}` : '选项');
        for (const c of b.choices ?? []) if (c.label) parts.push(`  ▸ ${c.label}`);
        break;
      case 'condition':
        parts.push(`【条件】${b.condition ?? ''}`);
        break;
      case 'instruction':
        parts.push(`【指令】${b.instruction ?? ''}`);
        break;
      case 'note':
        parts.push(`// ${b.text}`);
        break;
      default:
        if (b.text) parts.push(b.text);
    }
  }
  return parts.join('\n').trim();
}

function fdxSceneHeading(project: Project, doc: Document): string {
  const path = folderPath(doc.folderId, project.folders);
  return path ? `${path} · ${doc.name}` : doc.name;
}
