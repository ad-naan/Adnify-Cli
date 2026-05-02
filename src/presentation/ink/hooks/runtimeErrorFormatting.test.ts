import { describe, expect, test } from 'bun:test'
import { createAppI18n } from '../../../application/i18n/AppI18n'
import { formatBootErrorMessage, formatConfigErrorMessage } from './runtimeErrorFormatting'

describe('runtimeErrorFormatting', () => {
  test('formats invalid config json during boot with recovery guidance', () => {
    const i18n = createAppI18n('en')

    const result = formatBootErrorMessage(
      i18n,
      new Error('Invalid JSON in config file: E:/AdnifyData/config.json'),
    )

    expect(result).toContain('configuration file contains invalid JSON')
    expect(result).toContain('E:/AdnifyData/config.json')
    expect(result).toContain(':config init')
  })

  test('formats unreadable config file errors', () => {
    const i18n = createAppI18n('en')

    const result = formatConfigErrorMessage(
      i18n,
      new Error('Failed to read config file E:/AdnifyData/config.json: Access denied'),
    )

    expect(result).toContain('Could not read the configuration file')
    expect(result).toContain('E:/AdnifyData/config.json')
    expect(result).toContain('Access denied')
  })

  test('falls back to generic boot failure message', () => {
    const i18n = createAppI18n('en')

    const result = formatBootErrorMessage(i18n, new Error('Workspace bootstrap timeout'))

    expect(result).toBe('Boot failed: Workspace bootstrap timeout')
  })
})
