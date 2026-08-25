import { readFile } from 'node:fs/promises'
import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'
import { resolveAppStorage } from '../storage/resolveAppStorage'
import { atomicWriteFile } from '../storage/atomicWriteFile'

export async function writeModelConfig(config: ModelConfig): Promise<void> {
  const storage = await resolveAppStorage()

  let existing: Record<string, unknown> = {}
  try {
    const raw = await readFile(storage.configPath, 'utf-8')
    existing = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // no existing config
  }

  existing['model'] = {
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    maxTokens: config.maxTokens,
    contextWindowTokens: config.contextWindowTokens,
    temperature: config.temperature,
    timeoutMs: config.timeoutMs,
  }

  await atomicWriteFile(storage.configPath, JSON.stringify(existing, null, 2) + '\n')
}
