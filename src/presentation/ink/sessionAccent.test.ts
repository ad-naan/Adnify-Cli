import { describe, expect, test } from 'bun:test'
import { sessionAccentColor } from './sessionAccent'

describe('sessionAccentColor', () => {
  test('returns a valid 6-digit hex color', () => {
    expect(/^#[0-9a-f]{6}$/.test(sessionAccentColor('session-abc', 'dark'))).toBe(true)
    expect(/^#[0-9a-f]{6}$/.test(sessionAccentColor('session-abc', 'light'))).toBe(true)
  })

  test('is deterministic for the same id and mode', () => {
    expect(sessionAccentColor('alpha', 'dark')).toBe(sessionAccentColor('alpha', 'dark'))
  })

  test('different ids generally map to different hues', () => {
    expect(sessionAccentColor('alpha', 'dark') === sessionAccentColor('beta', 'dark')).toBe(false)
  })

  test('light mode is deeper (darker) than dark mode for the same hue', () => {
    const perceived = (hex: string): number => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return 0.299 * r + 0.587 * g + 0.114 * b
    }
    expect(perceived(sessionAccentColor('gamma', 'light')) < perceived(sessionAccentColor('gamma', 'dark'))).toBe(true)
  })
})
