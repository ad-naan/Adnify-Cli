import type { AppI18n } from '../../../application/i18n/AppI18n'

const INVALID_JSON_PREFIX = 'Invalid JSON in config file: '
const READ_CONFIG_PREFIX = 'Failed to read config file '

export function formatBootErrorMessage(i18n: AppI18n, error: unknown): string {
  const message = getErrorMessage(error)
  const configError = parseConfigError(message)

  if (configError?.kind === 'invalid-json') {
    return i18n.t('status.bootFailedConfigInvalid', { path: configError.path })
  }

  if (configError?.kind === 'read-failed') {
    return i18n.t('status.bootFailedConfigUnreadable', {
      path: configError.path,
      message: configError.message,
    })
  }

  return i18n.t('status.bootFailedGeneric', { message })
}

export function formatConfigErrorMessage(i18n: AppI18n, error: unknown): string {
  const message = getErrorMessage(error)
  const configError = parseConfigError(message)

  if (configError?.kind === 'invalid-json') {
    return i18n.t('status.configFileInvalid', { path: configError.path })
  }

  if (configError?.kind === 'read-failed') {
    return i18n.t('status.configFileUnreadable', {
      path: configError.path,
      message: configError.message,
    })
  }

  return i18n.t('status.configFailed', { message })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type ParsedConfigError =
  | { kind: 'invalid-json'; path: string }
  | { kind: 'read-failed'; path: string; message: string }

function parseConfigError(message: string): ParsedConfigError | null {
  if (message.startsWith(INVALID_JSON_PREFIX)) {
    return {
      kind: 'invalid-json',
      path: message.slice(INVALID_JSON_PREFIX.length).trim(),
    }
  }

  if (message.startsWith(READ_CONFIG_PREFIX)) {
    const separatorIndex = message.indexOf(': ', READ_CONFIG_PREFIX.length)
    if (separatorIndex > -1) {
      return {
        kind: 'read-failed',
        path: message.slice(READ_CONFIG_PREFIX.length, separatorIndex).trim(),
        message: message.slice(separatorIndex + 2).trim(),
      }
    }
  }

  return null
}
