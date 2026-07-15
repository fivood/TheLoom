import { describe, expect, it } from 'vitest';
import { sampleProject } from './sample';
import {
  AUTO_BACKUP_INTERVAL_MS, clearProjectRecovery, parseProjectData, readProjectWithRecovery,
  readQuarantinedProject, readRecoveryBackup, saveProjectWithRecovery, storedProjectKey,
} from './recovery';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class RecoveryFailStorage extends MemoryStorage {
  failRecovery = false;

  setItem(key: string, value: string) {
    if (this.failRecovery && key.startsWith('theloom-recovery-v1-')) throw new Error('quota');
    super.setItem(key, value);
  }
}

describe('滚动自动备份', () => {
  it('保存前保留旧项目，并在十分钟内不覆盖恢复点', () => {
    const storage = new MemoryStorage();
    const first = sampleProject();
    first.name = '第一版';
    storage.setItem(storedProjectKey('slot'), JSON.stringify(first));

    const second = structuredClone(first);
    second.name = '第二版';
    saveProjectWithRecovery(storage, 'slot', second, 1_000);
    expect(parseProjectData(readRecoveryBackup(storage, 'slot')!.data)?.name).toBe('第一版');

    const third = structuredClone(second);
    third.name = '第三版';
    saveProjectWithRecovery(storage, 'slot', third, 1_000 + AUTO_BACKUP_INTERVAL_MS - 1);
    expect(parseProjectData(readRecoveryBackup(storage, 'slot')!.data)?.name).toBe('第一版');

    const fourth = structuredClone(third);
    fourth.name = '第四版';
    saveProjectWithRecovery(storage, 'slot', fourth, 1_000 + AUTO_BACKUP_INTERVAL_MS);
    expect(parseProjectData(readRecoveryBackup(storage, 'slot')!.data)?.name).toBe('第三版');
  });

  it('损坏当前存档时隔离原数据并载入有效恢复点', () => {
    const storage = new MemoryStorage();
    const first = sampleProject();
    first.name = '可恢复版本';
    storage.setItem(storedProjectKey('slot'), JSON.stringify(first));

    const second = structuredClone(first);
    second.name = '新版本';
    saveProjectWithRecovery(storage, 'slot', second, 1_000);
    storage.setItem(storedProjectKey('slot'), '{broken json');

    const result = readProjectWithRecovery(storage, 'slot', 2_000);
    expect(result.recovered).toBe(true);
    expect(result.project?.name).toBe('可恢复版本');
    expect(readQuarantinedProject(storage, 'slot')?.data).toBe('{broken json');
  });

  it('有效当前存档优先于恢复点', () => {
    const storage = new MemoryStorage();
    const first = sampleProject();
    storage.setItem(storedProjectKey('slot'), JSON.stringify(first));
    const second = structuredClone(first);
    second.name = '当前版本';
    saveProjectWithRecovery(storage, 'slot', second, 1_000);

    const result = readProjectWithRecovery(storage, 'slot');
    expect(result.recovered).toBe(false);
    expect(result.project?.name).toBe('当前版本');
  });

  it('删除项目时同时清理恢复数据', () => {
    const storage = new MemoryStorage();
    const first = sampleProject();
    storage.setItem(storedProjectKey('slot'), JSON.stringify(first));
    const second = structuredClone(first);
    second.name = '第二版';
    saveProjectWithRecovery(storage, 'slot', second, 1_000);
    storage.setItem(storedProjectKey('slot'), 'broken');
    readProjectWithRecovery(storage, 'slot', 2_000);

    clearProjectRecovery(storage, 'slot');
    expect(readRecoveryBackup(storage, 'slot')).toBeNull();
    expect(readQuarantinedProject(storage, 'slot')).toBeNull();
  });

  it('恢复点写入失败时仍保存当前项目并返回警告', () => {
    const storage = new RecoveryFailStorage();
    const first = sampleProject();
    first.name = '第一版';
    storage.setItem(storedProjectKey('slot'), JSON.stringify(first));
    storage.failRecovery = true;
    const second = structuredClone(first);
    second.name = '第二版';

    const result = saveProjectWithRecovery(storage, 'slot', second, 1_000);

    expect(result.backupError).toBe('quota');
    expect(parseProjectData(storage.getItem(storedProjectKey('slot'))!)?.name).toBe('第二版');
  });
});
