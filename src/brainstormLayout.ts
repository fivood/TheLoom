/** 只读位置,所以项目里的 BrainNote 与画布上的 React Flow 节点都能直接传进来 */
export interface PlacedNote {
  position: { x: number; y: number };
}

/**
 * 便签自动摆放。
 *
 * 原来新便签一律落在 `80 + random()*120` —— 所有便签挤在同一个 120×120 的方框里,
 * 手机快记连着记几条,到桌面风暴板上就是一摞叠在一起、要一张张拖开才看得见的纸。
 * 这里改成占格排布:把已有便签映射到网格,新便签放进第一个空格。
 */

/** 便签宽 210px(.sticky-note),留出间距后的格宽 */
export const NOTE_COL_WIDTH = 230;
/** 便签高度随内容变化,按常见的两三行留 */
export const NOTE_ROW_HEIGHT = 130;
/** 画布左上留白 */
export const NOTE_ORIGIN = { x: 80, y: 80 };
/** 每行的格数,超过就换行,避免无限向右长 */
export const NOTE_COLUMNS = 5;

/** 便签实际占的矩形,判重叠用;高度按常见的两三行估 */
const NOTE_WIDTH = 210;
const NOTE_HEIGHT = 100;

/**
 * 给下一张便签找一个不与现有便签重叠的位置。
 *
 * 按行优先扫描格点,返回第一个「真的没压住任何便签」的位置。
 * 这里比对的是各便签的真实坐标而不是把它们吸附到格上 —— 历史便签(或用户手动拖过的)
 * 并不落在格点上,只按格子记占用会算出一个离它 190px 的位置,而便签宽 210px,照样叠。
 *
 * `origin` 是开始扫描的位置,默认画布左上角。**调用方应传当前视口的左上角** ——
 * 固定从 (80,80) 起扫的话,板子铺开以后新便签会落在屏幕外(左上角那几格往往还空着),
 * 点了没反应,看着就像「加不上便签了」。
 */
export function nextNotePosition(
  notes: readonly PlacedNote[],
  origin: { x: number; y: number } = NOTE_ORIGIN,
): { x: number; y: number } {
  const placed = notes
    .filter((n) => n?.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y))
    .map((n) => n.position);

  const collides = (x: number, y: number): boolean => placed.some(
    (p) => Math.abs(p.x - x) < NOTE_WIDTH && Math.abs(p.y - y) < NOTE_HEIGHT,
  );

  for (let row = 0; ; row++) {
    for (let col = 0; col < NOTE_COLUMNS; col++) {
      const x = origin.x + col * NOTE_COL_WIDTH;
      const y = origin.y + row * NOTE_ROW_HEIGHT;
      if (!collides(x, y)) return { x, y };
    }
  }
}

/** 带 id 的便签,供放射布局用 */
export interface LinkedNote extends PlacedNote {
  id: string;
}
export interface NoteLink {
  source: string;
  target: string;
}

/** 放射布局每加深一层的半径增量 */
export const RING_STEP = 250;
/** 便签横着排更省地方,所以 x 方向拉宽一点 */
const RING_X_STRETCH = 1.4;

/**
 * 放射(思维导图)布局:以某张便签为中心,按连线的层级一圈圈往外摊开。
 *
 * 风暴板上的连线表达的是「由此想到」的联想关系,不是流程顺序,所以左→右的层级排布
 * 读起来别扭 —— 中心 + 同心圆才是这种关系的自然形状。
 * 与根不连通的便签(还没连上的散点)统一落到最外圈下方的网格里,不参与放射。
 */
export function mindmapLayout(
  notes: readonly LinkedNote[],
  links: readonly NoteLink[],
  rootId?: string,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (notes.length === 0) return out;

  const adj = new Map<string, string[]>();
  for (const n of notes) adj.set(n.id, []);
  for (const l of links) {
    if (!adj.has(l.source) || !adj.has(l.target) || l.source === l.target) continue;
    adj.get(l.source)!.push(l.target);
    adj.get(l.target)!.push(l.source);
  }

  // 没指定中心就选连线最多的那张;并列时取更靠前的,保证同一块板每次整理结果一致
  const root = rootId && adj.has(rootId)
    ? rootId
    : notes.reduce((best, n) => (adj.get(n.id)!.length > adj.get(best.id)!.length ? n : best), notes[0]).id;

  // 每个便签占一段角度,子便签在父便签的角度段内均分 —— 每条分支各占一个扇区,
  // 而不是「同一层的都摊到整圈上」;后者会让不同分支的连线互相穿越。
  // ponytail: 扇区按分支数均分,不按子树大小加权;分支粗细悬殊时窄扇区会挤,
  // 真挤到看不清再按子树节点数分配角度。
  interface Sector { a0: number; a1: number; depth: number }
  const sectors = new Map<string, Sector>([[root, { a0: 0, a1: Math.PI * 2, depth: 0 }]]);
  const order = [root];
  const seen = new Set([root]);
  for (let i = 0; i < order.length; i++) {
    const { a0, a1, depth } = sectors.get(order[i])!;
    const kids = adj.get(order[i])!.filter((k) => !seen.has(k));
    for (const k of kids) seen.add(k);
    const step = (a1 - a0) / Math.max(1, kids.length);
    kids.forEach((k, j) => {
      sectors.set(k, { a0: a0 + j * step, a1: a0 + (j + 1) * step, depth: depth + 1 });
      order.push(k);
    });
  }

  const perDepth = new Map<number, number>();
  let maxDepth = 0;
  for (const { depth } of sectors.values()) {
    perDepth.set(depth, (perDepth.get(depth) ?? 0) + 1);
    maxDepth = Math.max(maxDepth, depth);
  }

  const center = { x: 700, y: 480 };
  for (const [id, { a0, a1, depth }] of sectors) {
    if (depth === 0) { out.set(id, center); continue; }
    // 同一圈上的便签不能挤在一起,圈太小就按张数把半径撑开
    const r = Math.max(depth * RING_STEP, (perDepth.get(depth)! * NOTE_COL_WIDTH) / (2 * Math.PI));
    const a = (a0 + a1) / 2 - Math.PI / 2;
    out.set(id, {
      x: Math.round(center.x + Math.cos(a) * r * RING_X_STRETCH),
      y: Math.round(center.y + Math.sin(a) * r),
    });
  }

  const baseY = center.y + (maxDepth + 1) * RING_STEP + NOTE_ROW_HEIGHT;
  let i = 0;
  for (const n of notes) {
    if (out.has(n.id)) continue;
    out.set(n.id, {
      x: NOTE_ORIGIN.x + (i % NOTE_COLUMNS) * NOTE_COL_WIDTH,
      y: baseY + Math.floor(i / NOTE_COLUMNS) * NOTE_ROW_HEIGHT,
    });
    i++;
  }
  return out;
}
