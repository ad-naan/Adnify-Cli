/**
 * 折叠：把过长的文本块压到能显示的高度，并说清楚藏了多少。
 *
 * 只处理「面向人的、按行的、受终端高度限制的」截断。
 * 面向模型的字符级截断（上下文窗口保护）是另一回事，不要合并到这里 ——
 * 那种截断的阈值取决于模型上下文预算，与终端多高毫无关系，
 * 混在一起会让「拉伸窗口」改变模型看到的内容。
 */

export interface CollapseResult {
  /** 实际显示的行。 */
  lines: string[]
  /** 被折叠掉的行数，0 表示没有折叠。 */
  hiddenLines: number
  /** 是否发生了折叠。 */
  isCollapsed: boolean
}

/**
 * 保留头部若干行，其余折叠。
 *
 * maxLines 是包含提示行在内的总预算 —— 调用方给多少行，返回就不超过多少行，
 * 这样调用方不必再为提示行单独留位置（那是最容易算错的地方）。
 */
export function collapseLines(lines: string[], maxLines: number): CollapseResult {
  if (maxLines <= 0) {
    return { lines: [], hiddenLines: lines.length, isCollapsed: lines.length > 0 }
  }

  if (lines.length <= maxLines) {
    return { lines, hiddenLines: 0, isCollapsed: false }
  }

  // 留一行给提示，所以正文只能占 maxLines - 1。
  const bodyLines = Math.max(0, maxLines - 1)

  return {
    lines: lines.slice(0, bodyLines),
    hiddenLines: lines.length - bodyLines,
    isCollapsed: true,
  }
}

/**
 * 根据可用高度决定折叠阈值。
 *
 * 常量在这里是「上限」而不是「定值」：终端矮的时候必须让步，
 * 终端高的时候也不该无限膨胀把别的面板挤掉。
 */
export function resolveCollapseBudget(availableRows: number, cap: number): number {
  return Math.max(1, Math.min(cap, availableRows))
}
