import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { RuntimeBudgetPatch } from '../../application/ports/RuntimeBudgetPort'

export interface StorageSettingsFile {
  dataDirectory?: string
  locale?: 'zh-CN' | 'en'
  animationLevel?: 'off' | 'minimal' | 'full'
  permissionMode?: 'manual' | 'workspace' | 'auto' | 'plan'
  theme?: 'light' | 'dark' | 'system'
  runtimeBudget?: RuntimeBudgetPatch
}

export async function readStorageSettingsFile(path: string): Promise<StorageSettingsFile> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as StorageSettingsFile
  } catch {
    return {}
  }
}

export async function writeStorageSettingsFile(
  path: string,
  settings: StorageSettingsFile,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}
