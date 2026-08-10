import { describe, expect, test } from 'bun:test'
import { collapseLines, resolveCollapseBudget } from './CollapsePolicy'

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`)

describe('collapseLines', () => {
  test('leaves short content untouched', () => {
    const result = collapseLines(lines(3), 10)

    expect(result.isCollapsed).toBe(false)
    expect(result.hiddenLines).toBe(0)
    expect(result.lines).toHaveLength(3)
  })

  test('keeps content that exactly fits', () => {
    const result = collapseLines(lines(10), 10)

    expect(result.isCollapsed).toBe(false)
    expect(result.lines).toHaveLength(10)
  })

  test('never exceeds the budget once the hint row is counted', () => {
    // 预算是含提示行的总额：给 10 行，正文最多 9 行，加提示行正好 10。
    const result = collapseLines(lines(100), 10)

    expect(result.lines).toHaveLength(9)
    expect(result.lines.length + 1).toBe(10)
  })

  test('counts every line it hid', () => {
    const result = collapseLines(lines(100), 10)

    // 91 行被藏起来，而不是 90 —— 第 10 行被提示行顶掉了，也算藏。
    expect(result.hiddenLines).toBe(91)
    expect(result.lines.length + result.hiddenLines).toBe(100)
  })

  test('hides everything when there is no room at all', () => {
    const result = collapseLines(lines(5), 0)

    expect(result.lines).toHaveLength(0)
    expect(result.hiddenLines).toBe(5)
    expect(result.isCollapsed).toBe(true)
  })

  test('does not report a collapse for empty content', () => {
    expect(collapseLines([], 0).isCollapsed).toBe(false)
    expect(collapseLines([], 10).isCollapsed).toBe(false)
  })

  test('shows a single body line when the budget is 1', () => {
    const result = collapseLines(lines(50), 1)

    expect(result.lines).toHaveLength(0)
    expect(result.hiddenLines).toBe(50)
  })
})

describe('resolveCollapseBudget', () => {
  test('uses the cap when there is plenty of room', () => {
    expect(resolveCollapseBudget(100, 40)).toBe(40)
  })

  test('yields to the terminal when it is short', () => {
    // 常量是上限不是定值 —— 矮终端里 40 行预览挤不下。
    expect(resolveCollapseBudget(6, 40)).toBe(6)
  })

  test('always leaves at least one row', () => {
    expect(resolveCollapseBudget(0, 40)).toBe(1)
    expect(resolveCollapseBudget(-5, 40)).toBe(1)
  })
})
