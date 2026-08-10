import type { AppI18n } from '../i18n/AppI18n'
import {
  collapseLines,
  resolveCollapseBudget,
  type CollapseResult,
} from '../../domain/presentation/services/CollapsePolicy'

/**
 * 折叠 + 生成提示行。
 *
 * 折叠的算术在 domain 里，这里只负责把结果配上本地化文案 ——
 * 「藏了多少行」这句话是用户区分「内容被收起来」和「内容没了」的唯一依据，
 * 所以任何折叠都必须带上它，不能只截断不说明。
 */
export interface CollapsedBlock {
  lines: string[]
  hiddenLines: number
  isCollapsed: boolean
}

export function collapseBlock(
  content: string,
  maxLines: number,
  i18n: AppI18n,
  contentWidth = Number.POSITIVE_INFINITY,
): CollapsedBlock {
  const result = collapseLines(content.split('\n'), maxLines)

  if (!result.isCollapsed) {
    return { lines: result.lines, hiddenLines: 0, isCollapsed: false }
  }

  return {
    lines: [...result.lines, formatHiddenHint(result, i18n, contentWidth)],
    hiddenLines: result.hiddenLines,
    isCollapsed: true,
  }
}

/** 供调用方直接拿到「按可用高度折叠」的结果，避免每处自己算预算。 */
export function collapseBlockToFit(
  content: string,
  availableRows: number,
  cap: number,
  i18n: AppI18n,
  contentWidth?: number,
): CollapsedBlock {
  return collapseBlock(content, resolveCollapseBudget(availableRows, cap), i18n, contentWidth)
}

function formatHiddenHint(
  result: CollapseResult,
  i18n: AppI18n,
  contentWidth: number,
): string {
  const full = result.hiddenLines === 1
    ? i18n.t('collapse.hiddenOne')
    : i18n.t('collapse.hidden', { count: result.hiddenLines })

  if (full.length <= contentWidth) {
    return full
  }

  const short = i18n.t('collapse.hiddenShort', { count: result.hiddenLines })
  return short.length <= contentWidth ? short : '…'
}
