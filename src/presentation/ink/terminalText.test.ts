import { describe, expect, test } from 'bun:test'
import { resolveInputWindow, stripTerminalAnsi, terminalTextWidth } from './terminalText'

describe('terminal text geometry', () => {
  test('counts CJK characters as two terminal columns', () => {
    expect(terminalTextWidth('a你b')).toBe(4)
  })

  test('ignores ANSI styling and zero-width combining marks', () => {
    const styled = '\u001b[36ma你\u001b[0m'
    expect(stripTerminalAnsi(styled)).toBe('a你')
    expect(terminalTextWidth(styled)).toBe(3)
    expect(terminalTextWidth('e\u0301')).toBe(1)
  })

  test('places the cursor at the logical editing position', () => {
    expect(resolveInputWindow('ab你cd', 3, 20)).toMatchObject({
      cursorColumn: 4,
      beforeCursor: 'ab你',
      cursorCharacter: 'c',
      afterCursor: 'd',
    })
  })

  test('keeps long input visible around the cursor', () => {
    const inputWindow = resolveInputWindow('0123456789abcdef', 12, 8)
    expect(inputWindow.text.startsWith('…')).toBe(true)
    expect(inputWindow.cursorColumn).toBeLessThan(8)
  })
})
