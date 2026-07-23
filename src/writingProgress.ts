import type {
  DocBlock, Document, Project, WritingCountMode, WritingDailyStat, WritingProgressState,
} from './types';

const BODY_TYPES = new Set(['paragraph', 'action', 'dialogue', 'quote', 'list']);
const MODES: WritingCountMode[] = ['cjk', 'characters', 'englishWords'];
const DAILY_LIMIT = 90;

function blockText(block: DocBlock, bodyOnly: boolean): string {
  if (bodyOnly && !BODY_TYPES.has(block.type)) return '';
  const parts = [block.text];
  if (!bodyOnly) {
    if (block.instruction) parts.push(block.instruction);
    if (block.condition) parts.push(block.condition);
    for (const choice of block.choices ?? []) parts.push(choice.label);
  }
  for (const item of block.items ?? []) parts.push(item);
  return parts.join('\n');
}

export function countWritingText(text: string, mode: WritingCountMode): number {
  if (mode === 'cjk') return text.match(/\p{Script=Han}/gu)?.length ?? 0;
  if (mode === 'englishWords') return text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)?.length ?? 0;
  return text.match(/\S/gu)?.length ?? 0;
}

export function countDocumentWriting(
  document: Document,
  mode: WritingCountMode = 'characters',
  bodyOnly = false,
): number {
  return document.blocks.reduce((total, block) => total + countWritingText(blockText(block, bodyOnly), mode), 0);
}

export function countProjectWriting(
  project: Project,
  mode: WritingCountMode = 'characters',
  bodyOnly = false,
): number {
  return project.documents.reduce((total, document) => total + countDocumentWriting(document, mode, bodyOnly), 0);
}

export function writingDateKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function emptyDaily(date: string): WritingDailyStat {
  return {
    date,
    cjk: 0,
    characters: 0,
    englishWords: 0,
    bodyCjk: 0,
    bodyCharacters: 0,
    bodyEnglishWords: 0,
  };
}

function countAll(document: Document): Omit<WritingDailyStat, 'date'> {
  return {
    cjk: countDocumentWriting(document, 'cjk'),
    characters: countDocumentWriting(document, 'characters'),
    englishWords: countDocumentWriting(document, 'englishWords'),
    bodyCjk: countDocumentWriting(document, 'cjk', true),
    bodyCharacters: countDocumentWriting(document, 'characters', true),
    bodyEnglishWords: countDocumentWriting(document, 'englishWords', true),
  };
}

export function recordWritingProgress(prev: Project, next: Project, timestamp = Date.now()): void {
  const prevIds = prev.documents.map((document) => document.id).sort();
  const nextIds = next.documents.map((document) => document.id).sort();
  if (prevIds.length !== nextIds.length || prevIds.some((id, index) => id !== nextIds[index])) return;

  const previous = new Map(prev.documents.map((document) => [document.id, countAll(document)]));
  const delta = emptyDaily(writingDateKey(timestamp));
  for (const document of next.documents) {
    const before = previous.get(document.id);
    if (!before) return;
    const after = countAll(document);
    delta.cjk += Math.max(0, after.cjk - before.cjk);
    delta.characters += Math.max(0, after.characters - before.characters);
    delta.englishWords += Math.max(0, after.englishWords - before.englishWords);
    delta.bodyCjk += Math.max(0, after.bodyCjk - before.bodyCjk);
    delta.bodyCharacters += Math.max(0, after.bodyCharacters - before.bodyCharacters);
    delta.bodyEnglishWords += Math.max(0, after.bodyEnglishWords - before.bodyEnglishWords);
  }
  if (delta.cjk + delta.characters + delta.englishWords === 0) return;

  next.writingProgress ??= {};
  const daily = [...(next.writingProgress.daily ?? [])];
  const existing = daily.find((item) => item.date === delta.date);
  if (existing) {
    existing.cjk += delta.cjk;
    existing.characters += delta.characters;
    existing.englishWords += delta.englishWords;
    existing.bodyCjk += delta.bodyCjk;
    existing.bodyCharacters += delta.bodyCharacters;
    existing.bodyEnglishWords += delta.bodyEnglishWords;
  } else {
    daily.push(delta);
  }
  next.writingProgress.daily = daily.sort((a, b) => a.date.localeCompare(b.date)).slice(-DAILY_LIMIT);
}

export function dailyStatValue(
  stat: WritingDailyStat | undefined,
  mode: WritingCountMode,
  bodyOnly: boolean,
): number {
  if (!stat) return 0;
  if (mode === 'cjk') return bodyOnly ? stat.bodyCjk : stat.cjk;
  if (mode === 'englishWords') return bodyOnly ? stat.bodyEnglishWords : stat.englishWords;
  return bodyOnly ? stat.bodyCharacters : stat.characters;
}

export function recentWritingSeries(
  progress: WritingProgressState | undefined,
  timestamp = Date.now(),
  days = 7,
): WritingDailyStat[] {
  const byDate = new Map((progress?.daily ?? []).map((stat) => [stat.date, stat]));
  const result: WritingDailyStat[] = [];
  const current = new Date(timestamp);
  current.setHours(12, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(current);
    day.setDate(current.getDate() - offset);
    const key = writingDateKey(day.getTime());
    result.push(byDate.get(key) ?? emptyDaily(key));
  }
  return result;
}

export function normalizeWritingProgress(project: Project): void {
  const progress = project.writingProgress;
  if (!progress || typeof progress !== 'object') {
    delete project.writingProgress;
    return;
  }
  if (!MODES.includes(progress.countMode ?? 'characters')) progress.countMode = 'characters';
  progress.bodyOnly = !!progress.bodyOnly;
  if (!Number.isFinite(progress.projectTarget) || (progress.projectTarget ?? 0) <= 0) delete progress.projectTarget;

  const validFolders = new Set(project.folders
    .filter((folder) => folder.module === 'document' && !!folder.documentRole)
    .map((folder) => folder.id));
  const targets: Record<string, number> = {};
  for (const [id, raw] of Object.entries(progress.folderTargets ?? {})) {
    if (validFolders.has(id) && Number.isFinite(raw) && raw > 0) targets[id] = Math.floor(raw);
  }
  progress.folderTargets = targets;

  const normalized = new Map<string, WritingDailyStat>();
  for (const stat of progress.daily ?? []) {
    if (!stat || !/^\d{4}-\d{2}-\d{2}$/.test(stat.date)) continue;
    const clean = emptyDaily(stat.date);
    for (const key of Object.keys(clean) as (keyof WritingDailyStat)[]) {
      if (key === 'date') continue;
      const value = stat[key];
      clean[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    }
    normalized.set(clean.date, clean);
  }
  progress.daily = [...normalized.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-DAILY_LIMIT);
}
