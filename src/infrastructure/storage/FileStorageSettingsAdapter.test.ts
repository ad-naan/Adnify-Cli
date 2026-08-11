import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FileStorageSettingsAdapter } from './FileStorageSettingsAdapter'

describe('FileStorageSettingsAdapter', () => {
  test('should save a custom data directory and migrate config and sessions', async () => {
    const tempParent = join(process.cwd(), '.tmp')
    await mkdir(tempParent, { recursive: true })
    const root = await mkdtemp(join(tempParent, 'adnify-storage-'))
    const settingsEnvRoot = join(root, 'settings-env')
    const dataEnvRoot = join(root, 'data-env')
    await mkdir(settingsEnvRoot, { recursive: true })
    await mkdir(dataEnvRoot, { recursive: true })

    const isWin = process.platform === 'win32'
    const APP_NAME = isWin ? 'Adnify-Cli' : 'adnify-cli'
    const currentDataRoot = join(dataEnvRoot, APP_NAME)

    await mkdir(join(currentDataRoot, 'sessions'), { recursive: true })
    await writeFile(join(currentDataRoot, 'config.json'), '{"model":{"model":"gpt-5"}}\n', 'utf8')
    await writeFile(join(currentDataRoot, 'sessions', 'session-1.json'), '{"id":"session-1"}\n', 'utf8')

    const adapter = new FileStorageSettingsAdapter(
      isWin
        ? { env: { APPDATA: settingsEnvRoot, LOCALAPPDATA: dataEnvRoot }, platform: 'win32' }
        : { env: { XDG_CONFIG_HOME: settingsEnvRoot, XDG_DATA_HOME: dataEnvRoot }, platform: 'linux' },
    )

    const customDir = join(root, 'custom-data')
    const result = await adapter.setDataDirectory(customDir)

    expect(result.configuredDataRoot).toBe(customDir)
    expect(result.migratedConfig).toBe(true)
    expect(result.migratedSessions).toBe(true)

    const settingsRaw = await readFile(join(settingsEnvRoot, APP_NAME, 'settings.json'), 'utf8')
    expect(JSON.parse(settingsRaw)).toEqual({
      dataDirectory: customDir,
    })

    const copiedConfig = await readFile(join(customDir, 'config.json'), 'utf8')
    expect(copiedConfig).toContain('"gpt-5"')

    const copiedSession = await readFile(join(customDir, 'sessions', 'session-1.json'), 'utf8')
    expect(copiedSession).toContain('"session-1"')
  })

  test('should persist locale and animation without overwriting either preference', async () => {
    const tempParent = join(process.cwd(), '.tmp')
    await mkdir(tempParent, { recursive: true })
    const root = await mkdtemp(join(tempParent, 'adnify-preferences-'))
    const settingsEnvRoot = join(root, 'settings-env')
    const dataEnvRoot = join(root, 'data-env')
    await mkdir(settingsEnvRoot, { recursive: true })
    await mkdir(dataEnvRoot, { recursive: true })

    const isWin = process.platform === 'win32'
    const appName = isWin ? 'Adnify-Cli' : 'adnify-cli'
    const adapter = new FileStorageSettingsAdapter(
      isWin
        ? { env: { APPDATA: settingsEnvRoot, LOCALAPPDATA: dataEnvRoot }, platform: 'win32' }
        : { env: { XDG_CONFIG_HOME: settingsEnvRoot, XDG_DATA_HOME: dataEnvRoot }, platform: 'linux' },
    )

    await adapter.setLocale('zh-CN')
    await adapter.setAnimationLevel('full')

    const raw = await readFile(join(settingsEnvRoot, appName, 'settings.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual({ locale: 'zh-CN', animationLevel: 'full' })
  })
})
