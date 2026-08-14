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
 */
export function nextNotePosition(notes: readonly PlacedNote[]): { x: number; y: number } {
  const placed = notes
    .filter((n) => n?.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y))
    .map((n) => n.position);

  const collides = (x: number, y: number): boolean => placed.some(
    (p) => Math.abs(p.x - x) < NOTE_WIDTH && Math.abs(p.y - y) < NOTE_HEIGHT,
  );

  for (let row = 0; ; row++) {
    for (let col = 0; col < NOTE_COLUMNS; col++) {
      const x = NOTE_ORIGIN.x + col * NOTE_COL_WIDTH;
      const y = NOTE_ORIGIN.y + row * NOTE_ROW_HEIGHT;
      if (!collides(x, y)) return { x, y };
    }
  }
}
