import { describe, expect, test } from 'bun:test'
import { createAppI18n, resolveAppLocale, resolveAppLocaleFromEnv } from './AppI18n'

describe('AppI18n', () => {
  test('should resolve locale aliases', () => {
    expect(resolveAppLocale('zh')).toBe('en')
    expect(resolveAppLocale('en-US')).toBe('en')
    expect(resolveAppLocale('fr-FR')).toBe('en')
  })

  test('should resolve locale from environment with ADNIFY_LOCALE priority', () => {
    expect(
      resolveAppLocaleFromEnv({
        ADNIFY_LOCALE: 'en-US',
        LANG: 'zh-CN',
      }),
    ).toBe('en')
  })

  test('should format translated templates', () => {
    const i18n = createAppI18n('en')
    expect(i18n.t('status.responseFailed', { message: 'boom' })).toBe('Response failed: boom')
  })
})
