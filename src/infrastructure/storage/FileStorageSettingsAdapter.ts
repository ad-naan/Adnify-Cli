import { copyFile, cp, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  StorageSettingsSnapshot,
  StorageSettingsUpdateResult,
} from '../../application/dto/StorageSettingsSnapshot'
import type { StorageSettingsPort } from '../../application/ports/StorageSettingsPort'
import {
  normalizeStoragePath,
  resolveAppStorage,
  type ResolveAppStorageOptions,
} from './resolveAppStorage'
import { readStorageSettingsFile, writeStorageSettingsFile } from './storageSettingsFile'
import type { AnimationLevel } from '../../application/dto/UiPreferences'
import type { AppLocale } from '../../application/i18n/AppI18n'

const CONFIG_FILE = 'config.json'
const SESSIONS_DIR = 'sessions'

export class FileStorageSettingsAdapter implements StorageSettingsPort {
  constructor(private readonly options: ResolveAppStorageOptions = {}) {}

  async inspect(): Promise<StorageSettingsSnapshot> {
    const storage = await resolveAppStorage(this.options)
    const settings = await readStorageSettingsFile(storage.settingsPath)

    return {
      effectiveStorage: storage,
      settingsPath: storage.settingsPath,
      configuredDataRoot: normalizeStoragePath(settings.dataDirectory, this.options.platform) ?? null,
    }
  }

  async setDataDirectory(path: string): Promise<StorageSettingsUpdateResult> {
    const current = await resolveAppStorage(this.options)
    const settings = await readStorageSettingsFile(current.settingsPath)
    const nextDataRoot = normalizeStoragePath(path.trim(), this.options.platform)

    if (!nextDataRoot) {
      throw new Error('Storage path is required')
    }

    await writeStorageSettingsFile(current.settingsPath, {
      ...settings,
      dataDirectory: nextDataRoot,
    })

    const migration = await migrateStorageContents(
      current.dataRoot,
      nextDataRoot,
      this.options.platform,
    )
    const snapshot = await this.inspect()

    return {
      ...snapshot,
      ...migration,
      requiresRestart: true,
    }
  }

  async resetDataDirectory(): Promise<StorageSettingsUpdateResult> {
    const current = await resolveAppStorage(this.options)
    const settings = await readStorageSettingsFile(current.settingsPath)

    const { dataDirectory: _discardedDataDirectory, ...remainingSettings } = settings
    await writeStorageSettingsFile(current.settingsPath, remainingSettings)

    const snapshot = await this.inspect()

    return {
      ...snapshot,
      migratedConfig: false,
      migratedSessions: false,
      requiresRestart: true,
    }
  }

  async setLocale(locale: AppLocale): Promise<void> {
    const storage = await resolveAppStorage(this.options)
    const settings = await readStorageSettingsFile(storage.settingsPath)
    await writeStorageSettingsFile(storage.settingsPath, { ...settings, locale })
  }

  async setAnimationLevel(animationLevel: AnimationLevel): Promise<void> {
    const storage = await resolveAppStorage(this.options)
    const settings = await readStorageSettingsFile(storage.settingsPath)
    await writeStorageSettingsFile(storage.settingsPath, { ...settings, animationLevel })
  }
}

async function migrateStorageContents(
  currentDataRoot: string,
  nextDataRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<Pick<StorageSettingsUpdateResult, 'migratedConfig' | 'migratedSessions'>> {
  if (samePath(currentDataRoot, nextDataRoot, platform)) {
    return {
      migratedConfig: false,
      migratedSessions: false,
    }
  }

  await mkdir(nextDataRoot, { recursive: true })

  const sourceConfigPath = join(currentDataRoot, CONFIG_FILE)
  const targetConfigPath = join(nextDataRoot, CONFIG_FILE)
  const sourceSessionsPath = join(currentDataRoot, SESSIONS_DIR)
  const targetSessionsPath = join(nextDataRoot, SESSIONS_DIR)

  const configCanCopy = await pathExists(sourceConfigPath)
  const configAlreadyExists = await pathExists(targetConfigPath)
  let migratedConfig = false

  if (configCanCopy && !configAlreadyExists) {
    await copyFile(sourceConfigPath, targetConfigPath)
    migratedConfig = true
  }

  const sessionsCanCopy = await pathExists(sourceSessionsPath)
  const sessionsAlreadyExist = await pathExists(targetSessionsPath)
  let migratedSessions = false

  if (sessionsCanCopy && !sessionsAlreadyExist) {
    await cp(sourceSessionsPath, targetSessionsPath, { recursive: true })
    migratedSessions = true
  }

  return {
    migratedConfig,
    migratedSessions,
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function samePath(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normalizedLeft = normalizeStoragePath(left, platform)
  const normalizedRight = normalizeStoragePath(right, platform)

  if (!normalizedLeft || !normalizedRight) {
    return false
  }

  if (platform === 'win32') {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
  }

  return normalizedLeft === normalizedRight
}
