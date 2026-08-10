/**
 * 会话区滚动的纯计算部分。
 *
 * 与 React 分离，既能单独测，也让「偏移量该怎么变」这条规则只有一处定义。
 */

/** 距底部的行数偏移：0 = 贴着最新内容（跟随模式），正数 = 往上翻了多少行。 */
export interface ScrollGeometry {
  /** 内容总行数。 */
  totalRows: number
  /** 视口能显示的行数。 */
  visibleRows: number
}

/** 能往上翻的最大行数 —— 即超出视口的部分，内容比视口短时为 0。 */
export function maxScrollOffset(geometry: ScrollGeometry): number {
  return Math.max(0, geometry.totalRows - geometry.visibleRows)
}

/** 把任意偏移收进 [0, maxOffset]，用于翻页和内容变短后的越界回收。 */
export function clampScrollOffset(offset: number, geometry: ScrollGeometry): number {
  return Math.max(0, Math.min(offset, maxScrollOffset(geometry)))
}

/**
 * 取出当前应当渲染的行。
 *
 * offset 从底部起算，所以 offset=0 就是最后一屏。
 */
export function sliceVisibleRows<T>(rows: T[], offset: number, visibleRows: number): T[] {
  if (rows.length <= visibleRows) {
    return rows
  }

  // end 必须先夹住下界：负的 end 会让 slice 从尾部反向取，把会话区整个清空。
  const end = Math.max(visibleRows, rows.length - offset)
  return rows.slice(end - visibleRows, end)
}
