import { readFile } from 'node:fs/promises'
import { atomicWriteFile } from './atomicWriteFile'
import type { RuntimeBudgetPatch } from '../../application/ports/RuntimeBudgetPort'

export interface StorageSettingsFile {
  dataDirectory?: string
  locale?: 'zh-CN' | 'en'
  animationLevel?: 'off' | 'minimal' | 'full'
  permissionMode?: 'manual' | 'workspace' | 'auto' | 'plan'
  runtimeBudget?: RuntimeBudgetPatch
  /** 用户扩展的 shell 命令白名单（仅命令名）。这些命令按 careful 处理，执行仍需审批。 */
  shellAllowlist?: string[]
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
  await atomicWriteFile(path, JSON.stringify(settings, null, 2) + '\n')
}
