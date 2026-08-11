import { describe, expect, test } from 'bun:test'
import { resolveUiPreferences } from './resolveUiPreferences'

describe('resolveUiPreferences', () => {
  test('should enable full animation by default', () => {
    expect(resolveUiPreferences({})).toEqual({ animationLevel: 'full' })
  })

  test('should prefer the environment and otherwise use persisted settings', () => {
    expect(resolveUiPreferences({}, 'minimal')).toEqual({ animationLevel: 'minimal' })
    expect(resolveUiPreferences({ ADNIFY_ANIMATION_LEVEL: 'off' }, 'full')).toEqual({
      animationLevel: 'off',
    })
  })
})
