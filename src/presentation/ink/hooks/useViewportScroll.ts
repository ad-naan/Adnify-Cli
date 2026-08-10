import { useCallback, useEffect, useRef, useState } from 'react'
import { clampScrollOffset, maxScrollOffset } from './viewportScrollMath'

/**
 * 会话区的滚动位置。
 *
 * 会话区是固定视口，没有终端原生 scrollback 可依赖，所以「滚上去看历史」这件事
 * 必须由我们自己维护一个偏移量来实现。偏移量从底部起算：
 * 0 = 贴着最新内容（跟随模式），正数 = 往上翻了多少行。
 *
 * 跟随模式下新内容到达时视口自动跟着走；一旦用户往上翻就停止跟随，
 * 否则读到一半会被新输出拽回底部。
 *
 * 计算规则都在 viewportScrollMath 里，这里只负责把它接到 React 状态上。
 */
export interface ViewportScrollState {
  /** 距底部的行数偏移，0 表示跟随最新内容。 */
  offset: number
  /** 是否已经离开底部 —— 决定要不要提示「回到最新」。 */
  isScrolled: boolean
  /** 上方还有多少行没显示，用于提示条。 */
  hiddenAbove: number
  scrollUp: (lines: number) => void
  scrollDown: (lines: number) => void
  /** 回到底部并恢复自动跟随。 */
  scrollToBottom: () => void
}

export function useViewportScroll(
  totalRows: number,
  visibleRows: number,
): ViewportScrollState {
  const [offset, setOffset] = useState(0)

  // 回调里要读最新的几何量，但不该因为几何量变化就重建回调（否则按键处理函数每帧换新）。
  const geometryRef = useRef({ totalRows, visibleRows })
  geometryRef.current = { totalRows, visibleRows }

  const maxOffset = maxScrollOffset({ totalRows, visibleRows })

  // 内容变短（清屏、会话重置）时旧偏移可能越界，收回合法范围。
  useEffect(() => {
    setOffset((current) => Math.min(current, maxOffset))
  }, [maxOffset])

  const scrollUp = useCallback((lines: number) => {
    setOffset((current) => clampScrollOffset(current + lines, geometryRef.current))
  }, [])

  const scrollDown = useCallback((lines: number) => {
    setOffset((current) => clampScrollOffset(current - lines, geometryRef.current))
  }, [])

  const scrollToBottom = useCallback(() => {
    setOffset(0)
  }, [])

  // 渲染期再夹一次：内容刚变短、effect 还没跑的那一帧也不能越界。
  const safeOffset = Math.min(offset, maxOffset)

  return {
    offset: safeOffset,
    isScrolled: safeOffset > 0,
    hiddenAbove: Math.max(0, maxOffset - safeOffset),
    scrollUp,
    scrollDown,
    scrollToBottom,
  }
}
