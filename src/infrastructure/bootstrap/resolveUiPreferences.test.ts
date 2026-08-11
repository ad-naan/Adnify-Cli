import { describe, expect, test } from 'bun:test'
import { resolveUiPreferences } from './resolveUiPreferences'

describe('resolveUiPreferences', () => {
  test('should enable full animation by default', () => {
    expect(resolveUiPreferences({})).toEqual({ animationLevel: 'full', permissionMode: 'workspace' })
  })

  test('should prefer the environment and otherwise use persisted settings', () => {
    expect(resolveUiPreferences({}, 'minimal', 'manual')).toEqual({ animationLevel: 'minimal', permissionMode: 'manual' })
    expect(resolveUiPreferences({ ADNIFY_ANIMATION_LEVEL: 'off', ADNIFY_PERMISSION_MODE: 'auto' }, 'full', 'plan')).toEqual({
      animationLevel: 'off',
      permissionMode: 'auto',
    })
  })
})
