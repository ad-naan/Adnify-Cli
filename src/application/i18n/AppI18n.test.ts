import { describe, expect, test } from 'bun:test'
import { createAppI18n, resolveAppLocale, resolveAppLocaleFromEnv } from './AppI18n'

describe('AppI18n', () => {
  test('should resolve locale aliases', () => {
    expect(resolveAppLocale('zh')).toBe('zh-CN')
    expect(resolveAppLocale('zh_CN.UTF-8')).toBe('zh-CN')
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

  test('should use persisted locale when no explicit environment override exists', () => {
    expect(resolveAppLocaleFromEnv({ LANG: '' }, 'zh-CN')).toBe('zh-CN')
    expect(resolveAppLocaleFromEnv({ ADNIFY_LOCALE: 'en' }, 'zh-CN')).toBe('en')
  })

  test('should format translated templates', () => {
    const i18n = createAppI18n('en')
    expect(i18n.t('status.responseFailed', { message: 'boom' })).toBe('Response failed: boom')
  })

  test('should render the Chinese catalog when zh-CN is selected', () => {
    const i18n = createAppI18n('zh-CN')
    expect(i18n.t('conversation.transcriptTitle')).toBe('全屏记录')
    expect(i18n.t('status.hintControls')).toContain('滚动')
  })
})
