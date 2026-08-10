import { describe, expect, test } from 'bun:test'
import { clampScrollOffset, maxScrollOffset, sliceVisibleRows } from './viewportScrollMath'

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('maxScrollOffset', () => {
  test('is the amount of content above the viewport', () => {
    expect(maxScrollOffset({ totalRows: 100, visibleRows: 10 })).toBe(90)
  })

  test('is zero when the content fits', () => {
    expect(maxScrollOffset({ totalRows: 4, visibleRows: 10 })).toBe(0)
  })
})

describe('clampScrollOffset', () => {
  test('cannot scroll past the oldest row', () => {
    expect(clampScrollOffset(999, { totalRows: 20, visibleRows: 10 })).toBe(10)
  })

  test('cannot scroll below the bottom', () => {
    expect(clampScrollOffset(-5, { totalRows: 100, visibleRows: 10 })).toBe(0)
  })

  test('pulls a stale offset back in range when content shrinks', () => {
    // 清屏 / 会话重置后旧偏移越界，必须收回，否则视口停在一片空白上。
    expect(clampScrollOffset(80, { totalRows: 12, visibleRows: 10 })).toBe(2)
  })
})

describe('sliceVisibleRows', () => {
  test('shows the newest rows when following the bottom', () => {
    expect(sliceVisibleRows(rows(100), 0, 3)).toEqual([98, 99, 100])
  })

  test('walks backwards through history as the offset grows', () => {
    expect(sliceVisibleRows(rows(100), 10, 3)).toEqual([88, 89, 90])
  })

  test('shows the very first rows at the maximum offset', () => {
    expect(sliceVisibleRows(rows(100), 97, 3)).toEqual([1, 2, 3])
  })

  test('returns everything when the content fits', () => {
    expect(sliceVisibleRows(rows(2), 0, 10)).toEqual([1, 2])
  })

  test('never runs off the start of the buffer', () => {
    // 偏移越界时宁可少显示，也不能返回空数组让会话区整个空掉。
    expect(sliceVisibleRows(rows(5), 99, 3)).toEqual([1, 2, 3])
  })

  test('reaches the very first row at max offset', () => {
    // 滚动上限必须按正文高度算。按整个视口高度算会差一行，
    // 最早那行内容永远翻不到 —— 这个边界回归过一次。
    const total = 50
    const viewportRows = 10
    const bodyRows = viewportRows - 1
    const geometry = { totalRows: total, visibleRows: bodyRows }

    const atTop = sliceVisibleRows(rows(total), maxScrollOffset(geometry), bodyRows)

    expect(atTop[0]).toBe(1)
  })
})
