import { uid } from './util';
import { idbSet } from './webdb';

/**
 * 灵感库:跨项目的点子收件箱。
 *
 * 与项目内的风暴板是两件事:
 * - 风暴板是**空间画布**(位置、连线、颜色),服务于某一部作品的结构梳理;
 * - 灵感库是**扁平列表**,只有文字与时间,因为点子产生时还不知道属于哪部作品。
 *
 * 两者单向流动:灵感库 →(取用)→ 项目的风暴板 / 场景 / 大纲行。
 * **取用不删卡片**,只记一笔去向 —— 同一个点子可能在两部作品里长出不同东西。
 *
 * 存储独立于 Project(否则又被锁进单个项目),因此也不随项目 JSON 走,
 * 由外链网盘单独同步一个 inbox 对象。
 */

const KEY = 'theloom-inbox-v1';

export interface IdeaUse {
  projectId: string;
  projectName: string;
  at: number;
}

export interface IdeaCard {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  /** 被取用过的项目,只增不改;卡片本身保留 */
  usedIn?: IdeaUse[];
  /** 墓碑:删除不能直接抹掉记录,否则另一台设备会把它同步回来 */
  deletedAt?: number;
}

export function loadInbox(): IdeaCard[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((c): c is IdeaCard =>
      !!c && typeof (c as IdeaCard).id === 'string' && typeof (c as IdeaCard).text === 'string');
  } catch { return []; }
}

export function saveInbox(cards: IdeaCard[]): void {
  try {
    const json = JSON.stringify(cards);
    localStorage.setItem(KEY, json);
    // 与项目 JSON 同策略镜像进 IDB:localStorage 被浏览器清掉后,启动 hydration 会从 IDB 补回
    void idbSet(KEY, json);
  } catch { /* 配额满时静默 */ }
}

/**
 * 界面上看到的:排除墓碑,新的在前。
 * 同一毫秒内连记多条时 createdAt 相同,用存储顺序兜底(后写的更新),
 * 否则连续粘几条灵感顺序会乱。
 */
export function visibleIdeas(cards: IdeaCard[]): IdeaCard[] {
  return cards
    .map((c, i) => ({ c, i }))
    .filter((x) => !x.c.deletedAt)
    .sort((a, b) => (b.c.createdAt - a.c.createdAt) || (b.i - a.i))
    .map((x) => x.c);
}

export function addIdea(cards: IdeaCard[], text: string): IdeaCard[] {
  const t = text.trim();
  if (!t) return cards;
  const now = Date.now();
  return [...cards, { id: uid(), text: t, createdAt: now, updatedAt: now }];
}

export function editIdea(cards: IdeaCard[], id: string, text: string): IdeaCard[] {
  const t = text.trim();
  if (!t) return cards;
  return cards.map((c) => (c.id === id ? { ...c, text: t, updatedAt: Date.now() } : c));
}

/** 软删除:留墓碑,同步时才不会复活 */
export function removeIdea(cards: IdeaCard[], id: string): IdeaCard[] {
  const now = Date.now();
  return cards.map((c) => (c.id === id ? { ...c, deletedAt: now, updatedAt: now } : c));
}

/** 记一笔「这张卡被用到某项目」;同一项目只记一次 */
export function markUsed(cards: IdeaCard[], id: string, projectId: string, projectName: string): IdeaCard[] {
  return cards.map((c) => {
    if (c.id !== id) return c;
    const used = c.usedIn ?? [];
    if (used.some((u) => u.projectId === projectId)) return c;
    return { ...c, usedIn: [...used, { projectId, projectName, at: Date.now() }], updatedAt: Date.now() };
  });
}

/**
 * 合并两侧灵感库。
 *
 * 收件箱以追加为主,所以**按 id 取并集**即可 —— 两台设备各记各的点子都能留下,
 * 完全不需要「谁覆盖谁」的冲突判定。同一张卡两边都改过时取 updatedAt 较新的,
 * 墓碑同样参与比较,于是删除也能正确传播。
 */
export function mergeInbox(a: IdeaCard[], b: IdeaCard[]): IdeaCard[] {
  const byId = new Map<string, IdeaCard>();
  for (const card of [...a, ...b]) {
    const prev = byId.get(card.id);
    if (!prev || (card.updatedAt ?? 0) > (prev.updatedAt ?? 0)) byId.set(card.id, card);
  }
  return [...byId.values()].sort((x, y) => x.createdAt - y.createdAt);
}
