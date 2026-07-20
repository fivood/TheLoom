// 从示例项目 sampleProject() 导出引擎包 JSON,覆盖 sample_package.json
// 用法(从项目根目录):npx tsx examples/godot-demo/export-sample.mjs
import { writeFileSync } from 'node:fs';
const { sampleProject } = await import('../../src/sample.ts');
const { normalizeProject } = await import('../../src/util.ts');
const { buildEnginePackage } = await import('../../src/engine/package.ts');

const project = sampleProject();
normalizeProject(project);
const pkg = buildEnginePackage(project);
pkg.meta.exportedAt = 0;
pkg.meta.generator = 'godot-demo (sampleProject)';
writeFileSync('examples/godot-demo/sample_package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`导出:${pkg.meta.projectName} · ${pkg.flows.length} 流程 · ${pkg.entities.length} 实体`);
