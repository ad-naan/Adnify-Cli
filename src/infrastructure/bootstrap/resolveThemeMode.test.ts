import { describe, expect, test } from 'bun:test'
import {
  detectTerminalTheme,
  normalizeThemeAppearance,
  resolveThemeMode,
} from './resolveThemeMode'

describe('normalizeThemeAppearance', () => {
  test('recognizes light and dark', () => {
    expect(normalizeThemeAppearance('light')).toBe('light')
    expect(normalizeThemeAppearance('DARK')).toBe('dark')
    expect(normalizeThemeAppearance(' Light ')).toBe('light')
  })

  test('maps system/auto/unknown/empty to system', () => {
    expect(normalizeThemeAppearance('system')).toBe('system')
    expect(normalizeThemeAppearance('auto')).toBe('system')
    expect(normalizeThemeAppearance('')).toBe('system')
    expect(normalizeThemeAppearance(undefined)).toBe('system')
    expect(normalizeThemeAppearance('teal')).toBe('system')
  })
})

describe('detectTerminalTheme', () => {
  test('classifies a light background (COLORFGBG bg=15) as light', () => {
    expect(detectTerminalTheme({ COLORFGBG: '0;15' })).toBe('light')
  })

  test('classifies bg=7 as light and bg=0 as dark', () => {
    expect(detectTerminalTheme({ COLORFGBG: '15;7' })).toBe('light')
    expect(detectTerminalTheme({ COLORFGBG: '15;0' })).toBe('dark')
  })

  test('handles the three-field fg;default;bg form', () => {
    expect(detectTerminalTheme({ COLORFGBG: '0;default;15' })).toBe('light')
    expect(detectTerminalTheme({ COLORFGBG: '15;default;0' })).toBe('dark')
  })

  test('returns null when COLORFGBG is absent or unparseable', () => {
    expect(detectTerminalTheme({})).toBeNull()
    expect(detectTerminalTheme({ COLORFGBG: '' })).toBeNull()
    expect(detectTerminalTheme({ COLORFGBG: 'foo;bar' })).toBeNull()
  })
})

describe('resolveThemeMode', () => {
  test('explicit ADNIFY_THEME wins over everything', () => {
    expect(resolveThemeMode({ ADNIFY_THEME: 'light', COLORFGBG: '15;0' }, 'dark')).toBe('light')
    expect(resolveThemeMode({ ADNIFY_THEME: 'dark', COLORFGBG: '0;15' }, 'light')).toBe('dark')
  })

  test('persisted light/dark wins over terminal detection', () => {
    expect(resolveThemeMode({ COLORFGBG: '15;0' }, 'light')).toBe('light')
    expect(resolveThemeMode({ COLORFGBG: '0;15' }, 'dark')).toBe('dark')
  })

  test('system preference auto-detects from the terminal', () => {
    expect(resolveThemeMode({ COLORFGBG: '0;15' }, 'system')).toBe('light')
    expect(resolveThemeMode({ COLORFGBG: '15;0' }, 'system')).toBe('dark')
  })

  test('defaults to dark when nothing is detectable', () => {
    expect(resolveThemeMode({}, 'system')).toBe('dark')
    expect(resolveThemeMode({})).toBe('dark')
  })
})
