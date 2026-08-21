import { describe, expect, test } from 'bun:test'
import { resolveUiPreferences } from './resolveUiPreferences'

describe('resolveUiPreferences', () => {
  test('should enable full animation by default', () => {
    expect(resolveUiPreferences({})).toEqual({
      animationLevel: 'full',
      permissionMode: 'workspace',
      themeAppearance: 'system',
      theme: 'dark',
    })
  })

  test('should prefer the environment and otherwise use persisted settings', () => {
    expect(resolveUiPreferences({}, 'minimal', 'manual')).toEqual({
      animationLevel: 'minimal',
      permissionMode: 'manual',
      themeAppearance: 'system',
      theme: 'dark',
    })
    expect(resolveUiPreferences({ ADNIFY_ANIMATION_LEVEL: 'off', ADNIFY_PERMISSION_MODE: 'auto' }, 'full', 'plan')).toEqual({
      animationLevel: 'off',
      permissionMode: 'auto',
      themeAppearance: 'system',
      theme: 'dark',
    })
  })

  test('resolves the theme from persisted appearance and terminal detection', () => {
    expect(resolveUiPreferences({ COLORFGBG: '0;15' }, null, null, 'system')).toMatchObject({
      themeAppearance: 'system',
      theme: 'light',
    })
    expect(resolveUiPreferences({}, null, null, 'light')).toMatchObject({
      themeAppearance: 'light',
      theme: 'light',
    })
    expect(resolveUiPreferences({ ADNIFY_THEME: 'dark', COLORFGBG: '0;15' })).toMatchObject({
      themeAppearance: 'dark',
      theme: 'dark',
    })
  })
})
