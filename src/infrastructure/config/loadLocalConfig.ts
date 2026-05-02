import { readFile } from 'node:fs/promises'
import type {
  ModelConfig,
  ModelProvider,
  ProvidersMap,
} from '../../domain/assistant/value-objects/ModelConfig'
import { resolveAppStorage } from '../storage/resolveAppStorage'

const VALID_PROVIDERS = new Set<ModelProvider>([
  'openai-compatible',
  'openai-responses',
  'anthropic',
  'google',
])

interface RawConfigFile {
  model?: {
    provider?: string
    apiKey?: string
    baseUrl?: string
    model?: string
    maxTokens?: number
    temperature?: number
    timeoutMs?: number
  }
  providers?: Record<
    string,
    {
      provider?: string
      apiKey?: string
      baseUrl?: string
      models?: string[]
    }
  >
}

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: 'openai-compatible',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  maxTokens: 4096,
  temperature: 0.7,
  timeoutMs: 60_000,
}

export interface LoadLocalConfigOptions {
  env?: Record<string, string | undefined>
  configPath?: string
}

function parseProvider(value: string | undefined): ModelProvider {
  if (value && VALID_PROVIDERS.has(value as ModelProvider)) {
    return value as ModelProvider
  }

  return 'openai-compatible'
}

async function readConfigFile(options: LoadLocalConfigOptions = {}): Promise<RawConfigFile> {
  const storage = options.configPath
    ? { configPath: options.configPath }
    : await resolveAppStorage({ env: options.env })

  try {
    const raw = await readFile(storage.configPath, 'utf-8')
    return JSON.parse(raw) as RawConfigFile
  } catch (error) {
    if (isMissingFileError(error)) {
      return {}
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${storage.configPath}`)
    }

    throw error instanceof Error
      ? new Error(`Failed to read config file ${storage.configPath}: ${error.message}`)
      : new Error(`Failed to read config file ${storage.configPath}: ${String(error)}`)
  }
}

export async function loadModelConfig(options: LoadLocalConfigOptions = {}): Promise<ModelConfig> {
  const fileConfig = await readConfigFile(options)
  const model = fileConfig.model ?? {}
  const env = options.env ?? process.env

  return {
    provider: parseProvider(env['ADNIFY_PROVIDER'] ?? model.provider),
    apiKey: env['ADNIFY_API_KEY'] ?? model.apiKey ?? DEFAULT_MODEL_CONFIG.apiKey,
    baseUrl: env['ADNIFY_BASE_URL'] ?? model.baseUrl ?? DEFAULT_MODEL_CONFIG.baseUrl,
    model: env['ADNIFY_MODEL'] ?? model.model ?? DEFAULT_MODEL_CONFIG.model,
    maxTokens: model.maxTokens ?? DEFAULT_MODEL_CONFIG.maxTokens,
    temperature: model.temperature ?? DEFAULT_MODEL_CONFIG.temperature,
    timeoutMs: model.timeoutMs ?? DEFAULT_MODEL_CONFIG.timeoutMs,
  }
}

export async function loadProviders(options: LoadLocalConfigOptions = {}): Promise<ProvidersMap> {
  const fileConfig = await readConfigFile(options)
  const raw = fileConfig.providers ?? {}
  const result: ProvidersMap = {}

  for (const [name, entry] of Object.entries(raw)) {
    if (entry.apiKey && entry.baseUrl) {
      result[name] = {
        provider: parseProvider(entry.provider),
        apiKey: entry.apiKey,
        baseUrl: entry.baseUrl,
        models: entry.models ?? [],
      }
    }
  }

  return result
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
