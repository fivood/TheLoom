/**
 * 《老伦敦寻人记》示例的小说通道验收(R22-1)
 *
 *   npx tsx examples/old-london/verify.mts
 *
 * 走的是产品里真实的那几条通道,不是另写一套检查:
 *   连续稿顺序(linearizeByFolders)、章节编译、DOCX 成稿(含导出后重解析自检)、
 *   写作进度统计、项目 JSON 备份往返。
 * 任一项不达标以非零退出码结束。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectFromDir } from '../../src/cli/loadProject';
import { linearizeByFolders, documentWordCount, normalizeProject } from '../../src/util';
import { compileDocuments } from '../../src/interop/chapterCompile';
import { exportProjectToDocx, planDocxManuscript, verifyDocxExport } from '../../src/interop/docxExport';
import { auditProject } from '../../src/audit';
import type { Project } from '../../src/types';

const here = dirname(fileURLToPath(import.meta.url));
const failures: string[] = [];
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${detail ? ` · ${detail}` : ''}`);
  if (!pass) failures.push(label);
};

const project: Project = loadProjectFromDir(join(here, 'project')).project;

console.log('[1] 项目加载与规范化');
ok('从文件夹读回项目', project.documents.length === 12, `${project.documents.length} 个场景`);
ok('卷章结构完整', project.folders.filter((f) => f.documentRole === 'volume').length === 1
  && project.folders.filter((f) => f.documentRole === 'chapter').length === 4,
  `${project.folders.length} 个文件夹`);
ok('实体与技术名', project.entities.length === 15 && project.entities.some((e) => e.technicalName === 'semmelweis'));
ok('伏笔全部有埋设与回收', (project.foreshadows ?? []).every((f) => f.plants.length > 0 && f.payoffs.length > 0),
  `${project.foreshadows?.length ?? 0} 条`);
// 规范化必须幂等:再跑一次不应该改变内容
const before = JSON.stringify(project);
normalizeProject(project);
ok('normalizeProject 幂等', JSON.stringify(project) === before);

console.log('[2] 连续稿阅读顺序');
const ordered = linearizeByFolders(project.documents, project.folders);
const titles = ordered.map((d) => d.name);
ok('场景按卷章树序排列', titles[0] === '白色地狱的走廊' && titles[titles.length - 1] === '感谢我的仁慈吧',
  `${titles[0]} → … → ${titles[titles.length - 1]}`);
ok('顺序无遗漏', ordered.length === project.documents.length);
const words = project.documents.reduce((sum, d) => sum + documentWordCount(d), 0);
ok('全书字数在预期量级', words > 8000 && words < 20000, `${words} 字`);

console.log('[3] 章节编译');
for (const format of ['md', 'txt', 'fdx'] as const) {
  const result = compileDocuments(project, { format, includeFolderPath: true });
  ok(`编译为 ${format}`, result.docCount === 12 && result.content.length > 5000,
    `${result.docCount} 篇 / ${result.content.length} 字符`);
}
const md = compileDocuments(project, { format: 'md', includeFolderPath: true });
ok('编译保持树序', md.content.indexOf('白色地狱的走廊') < md.content.indexOf('感谢我的仁慈吧'));

console.log('[4] DOCX 成稿(两套预设,含导出后重解析自检)');
for (const preset of ['submission', 'editorial'] as const) {
  const options = {
    preset,
    title: project.name,
    author: '示例',
    includeSceneTitles: preset === 'editorial',
    includeNotes: preset === 'editorial',
    includeAnnotations: preset === 'editorial',
    includeRevision: preset === 'editorial',
    now: Date.UTC(2026, 7, 3),
  };
  const plan = planDocxManuscript(project, options);
  const result = await exportProjectToDocx(project, options);
  const verification = await verifyDocxExport(result.blob, plan);
  ok(`${preset} 预设导出`, verification.valid,
    `${verification.volumeCount} 卷 / ${verification.chapterCount} 章 / ${verification.sceneCount} 场景 / `
    + `${verification.paragraphCount} 段 / ${(result.blob.size / 1024).toFixed(0)} KB`
    + (verification.valid ? '' : ' · ' + verification.issues.join(';')));
  writeFileSync(join(here, 'dist', `老伦敦寻人记-${preset}.docx`),
    Buffer.from(await result.blob.arrayBuffer()));
}

console.log('[5] 体检');
const issues = auditProject(project);
const errors = issues.filter((i) => i.severity === 'error');
ok('无错误级问题', errors.length === 0,
  errors.length ? errors.slice(0, 3).map((i) => `${i.kind}:${i.message}`).join(' | ') : `${issues.length} 条提示/警告`);

console.log('[6] 项目 JSON 备份往返');
const roundTripped = JSON.parse(JSON.stringify(project)) as Project;
normalizeProject(roundTripped);
ok('JSON 往返后场景数不变', roundTripped.documents.length === project.documents.length);
ok('JSON 往返后流程不变',
  JSON.stringify(roundTripped.flows) === JSON.stringify(project.flows));
ok('JSON 往返后伏笔引用不丢',
  JSON.stringify(roundTripped.foreshadows) === JSON.stringify(project.foreshadows));

// 完整备份 JSON:既是「项目备份」这条通道的产物,也供浏览器实测导入
writeFileSync(join(here, 'dist', '老伦敦寻人记.loom.json'), JSON.stringify(project, null, 2));
console.log('  → dist/老伦敦寻人记.loom.json');

console.log('');
if (failures.length > 0) {
  console.error(`✗ 小说通道验收未通过:${failures.length} 项`);
  for (const f of failures) console.error(`    · ${f}`);
  process.exit(1);
}
console.log('✓ 小说通道验收全部通过');
