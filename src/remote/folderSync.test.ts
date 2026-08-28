import { describe, expect, it } from 'vitest';
import {
  assembleProjectFiles, fingerprint, groupRemoteProjects, isPushableName, planFolderPush, projectPrefix,
} from './folderSync';
import { projectFromFolderFiles, projectToFolderFiles, type FolderFile } from '../storage';
import { longNovelRegressionProject } from '../test-fixtures/regressionProjects';

const f = (relPath: string, content: string, base64?: boolean): FolderFile => ({ relPath, content, base64 });

describe('远端作品前缀', () => {
  it('一个作品一个目录;路径分隔符被替换掉,免得凭空多出层级', () => {
    expect(projectPrefix('老伦敦寻人记')).toBe('projects/老伦敦寻人记/');
    expect(projectPrefix('a/b')).toBe('projects/a_b/');
    expect(projectPrefix('')).toBe('projects//');
  });
});

describe('列举结果分组', () => {
  const obj = (key: string, size: number, at: number) => ({ key, size, etag: null, lastModified: at });

  it('按作品名归组,统计文件数、体积与最新修改时间', () => {
    const out = groupRemoteProjects([
      obj('甲/project.json', 100, 5),
      obj('甲/documents/一.md', 20, 9),
      obj('乙/project.json', 50, 3),
    ]);
    expect(out.map((p) => p.name)).toEqual(['甲', '乙']); // 按最新修改时间倒序
    expect(out[0]).toMatchObject({ fileCount: 2, bytes: 120, updatedAt: 9 });
  });

  it('顶层散落的对象不算作品', () => {
    expect(groupRemoteProjects([obj('说明.txt', 1, 1)])).toEqual([]);
  });
});

describe('推送计划', () => {
  const at = (key: string, lastModified = 0) => ({ key, size: 1, etag: null, lastModified });

  it('只上传指纹变了的,跳过没动的', () => {
    const files = [f('project.json', '{"a":1}'), f('documents/一.md', '正文')];
    const known = { 'project.json': fingerprint(files[0]) };
    const plan = planFolderPush(files, known, [at('project.json'), at('documents/一.md')]);
    expect(plan.upload.map((x) => x.relPath)).toEqual(['documents/一.md']);
  });

  it('远端有、本次不再产出的要删掉 —— 改名或删场景后的陈旧文件', () => {
    const files = [f('project.json', '{}')];
    const plan = planFolderPush(files, {}, [at('project.json'), at('documents/旧名.md')]);
    expect(plan.remove).toEqual(['documents/旧名.md']);
  });

  it('本地没有指纹记录时全量上传(换设备后第一次推)', () => {
    const files = [f('project.json', '{}'), f('entities/甲.md', 'x')];
    expect(planFolderPush(files, {}, []).upload).toHaveLength(2);
  });
});

describe('冲突判定(按文件)', () => {
  const at = (key: string, lastModified: number) => ({ key, size: 1, etag: null, lastModified });

  it('要覆盖的文件在上次同步之后被别处改过 → 拦下', () => {
    const files = [f('documents/一.md', '本机新内容')];
    const plan = planFolderPush(files, {}, [at('documents/一.md', 500)], 100);
    expect(plan.conflicts).toEqual(['documents/一.md']);
  });

  it('别处改的是我没动的文件 → 不算冲突,各改各的不该互相拦', () => {
    const files = [f('documents/一.md', 'A')];
    const known = { 'documents/一.md': fingerprint(files[0]) };
    const plan = planFolderPush(files, known, [at('documents/二.md', 500)], 100);
    expect(plan.conflicts).toEqual([]);
  });

  it('远端那份比上次同步还老 → 是我自己推的,不算冲突', () => {
    const files = [f('documents/一.md', '改过了')];
    const plan = planFolderPush(files, {}, [at('documents/一.md', 50)], 100);
    expect(plan.conflicts).toEqual([]);
  });

  it('没有上次同步时间(首次推)不做冲突判定', () => {
    const files = [f('documents/一.md', 'A')];
    expect(planFolderPush(files, {}, [at('documents/一.md', 999)], 0).conflicts).toEqual([]);
  });
});

describe('内容指纹', () => {
  it('同内容同指纹,改一个字就变', () => {
    expect(fingerprint(f('a', '正文'))).toBe(fingerprint(f('b', '正文')));
    expect(fingerprint(f('a', '正文'))).not.toBe(fingerprint(f('a', '正文。')));
  });

  it('文本与 base64 同串也要分开 —— 头像与同名文本不能互相顶替', () => {
    expect(fingerprint(f('a', 'AAA'))).not.toBe(fingerprint(f('a', 'AAA', true)));
  });

  it('长度进指纹,防止短串碰撞掩盖差异', () => {
    expect(fingerprint(f('a', 'x')).endsWith(':3')).toBe(true); // 't:' + 'x'
  });
});

describe('远端文件清单还原成 ProjectFiles', () => {
  it('按目录归位,project.json 单独拎出', () => {
    const files = assembleProjectFiles([
      { path: 'project.json', content: '{"version":1}' },
      { path: 'documents/一.md', content: 'A' },
      { path: 'entities/甲.md', content: 'B' },
      { path: 'research/丙.md', content: 'C' },
      { path: 'assets/entity-x.png', content: 'BASE64' },
    ]);
    expect(files.projectJson).toBe('{"version":1}');
    expect(files.documents).toEqual([{ name: '一.md', content: 'A' }]);
    expect(files.entities).toEqual([{ name: '甲.md', content: 'B' }]);
    expect(files.research).toEqual([{ name: '丙.md', content: 'C' }]);
    expect(files.assets).toEqual([{ name: 'entity-x.png', content: 'BASE64' }]);
  });

  it('documents 下的多级路径保留 —— 卷 / 章目录结构靠它还原', () => {
    const files = assembleProjectFiles([{ path: 'documents/第一卷/第一章/开场.md', content: 'X' }]);
    expect(files.documents).toEqual([{ name: '第一卷/第一章/开场.md', content: 'X' }]);
  });

  it('不认识的目录直接忽略,不让外部文件混进项目', () => {
    const files = assembleProjectFiles([{ path: '别的东西/x.md', content: 'X' }]);
    expect(files.documents.concat(files.entities, files.research, files.assets)).toEqual([]);
  });
});

describe('整程往返:项目 → 远端文件 → 项目', () => {
  /**
   * 这是这套同步成立的前提 —— 手机端拿到的是一堆散文件,能不能还原成
   * 和桌面端一模一样的项目。中间那步刻意模拟成「只有路径与文本」,
   * 与真从 S3 列举 + 下载拿到的东西同形。
   */
  it('卷章结构、场景正文、实体与资料卡都能还原', () => {
    const original = longNovelRegressionProject();
    const { files } = projectToFolderFiles(original);

    const wire = files.map((x) => ({ path: x.relPath, content: x.content }));
    const restored = projectFromFolderFiles(assembleProjectFiles(wire)).project;

    expect(restored.name).toBe(original.name);
    expect(restored.documents.map((d) => d.name).sort()).toEqual(original.documents.map((d) => d.name).sort());
    expect(restored.entities.map((e) => e.name).sort()).toEqual(original.entities.map((e) => e.name).sort());
    expect(restored.researchCards.map((c) => c.title).sort())
      .toEqual(original.researchCards.map((c) => c.title).sort());
    // 卷 / 章文件夹树要跟着回来,否则连续稿顺序就乱了
    expect(restored.folders.filter((f) => f.module === 'document').map((f) => f.name).sort())
      .toEqual(original.folders.filter((f) => f.module === 'document').map((f) => f.name).sort());

    const src = original.documents.find((d) => d.blocks.length > 0)!;
    const out = restored.documents.find((d) => d.name === src.name)!;
    expect(out.blocks.map((b) => b.text)).toEqual(src.blocks.map((b) => b.text));
  });

  it('还原后再推一次,指纹与首次一致 —— 不会因为往返本身产生虚假改动', () => {
    const original = longNovelRegressionProject();
    const first = projectToFolderFiles(original).files;
    const wire = first.map((x) => ({ path: x.relPath, content: x.content }));
    const restored = projectFromFolderFiles(assembleProjectFiles(wire)).project;
    const second = projectToFolderFiles(restored).files;

    const fp = (list: typeof first) => Object.fromEntries(list.map((x) => [x.relPath, fingerprint(x)]));
    const a = fp(first), b = fp(second);
    // project.json 里带 updatedAt 之类会变的字段,单独放过;md 必须逐字一致
    const mdKeys = Object.keys(a).filter((k) => k.endsWith('.md'));
    expect(mdKeys.length).toBeGreaterThan(0);
    for (const k of mdKeys) expect(b[k]).toBe(a[k]);
  });
});

describe('没起名的作品不许推', () => {
  it('空名与默认名都拦下 —— 两本都叫「未命名项目」会在远端互相覆盖', () => {
    expect(isPushableName('未命名项目')).toBe(false);
    expect(isPushableName('  未命名项目  ')).toBe(false);
    expect(isPushableName('')).toBe(false);
    expect(isPushableName('   ')).toBe(false);
  });

  it('起过名的放行', () => {
    expect(isPushableName('老伦敦寻人记')).toBe(true);
    expect(isPushableName('未命名项目 2')).toBe(true);
  });
});
