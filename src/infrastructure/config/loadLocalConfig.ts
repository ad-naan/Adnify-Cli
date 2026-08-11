import { readFile } from 'node:fs/promises'
import type {
  ModelConfig,
  ModelProvider,
  ProvidersMap,
} from '../../domain/assistant/value-objects/ModelConfig'
import type { McpServerConfig } from '../mcp/McpClient'
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
    contextWindowTokens?: number
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
  mcpServers?: Record<
    string,
    {
      command?: string
      args?: string[]
      env?: Record<string, string>
    }
  >
}

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: 'openai-compatible',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  maxTokens: 4096,
  contextWindowTokens: 128_000,
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
    maxTokens: normalizeInteger(model.maxTokens, DEFAULT_MODEL_CONFIG.maxTokens, 1, 200_000),
    contextWindowTokens: normalizeInteger(
      env['ADNIFY_CONTEXT_WINDOW_TOKENS'] ? Number(env['ADNIFY_CONTEXT_WINDOW_TOKENS']) : model.contextWindowTokens,
      DEFAULT_MODEL_CONFIG.contextWindowTokens ?? 128_000,
      4_096,
      2_000_000,
    ),
    temperature: normalizeNumber(model.temperature, DEFAULT_MODEL_CONFIG.temperature, 0, 2),
    timeoutMs: normalizeInteger(model.timeoutMs, DEFAULT_MODEL_CONFIG.timeoutMs, 1_000, 600_000),
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

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(min, Math.min(max, value))
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.trunc(normalizeNumber(value, fallback, min, max))
}

/**
 * 从 config.json 加载 MCP server 配置。
 *
 * 格式示例：
 * ```json
 * {
 *   "mcpServers": {
 *     "filesystem": {
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
 *     }
 *   }
 * }
 * ```
 */
export async function loadMcpServers(
  options: LoadLocalConfigOptions = {},
): Promise<McpServerConfig[]> {
  const fileConfig = await readConfigFile(options)
  const raw = fileConfig.mcpServers ?? {}
  const result: McpServerConfig[] = []

  for (const [name, entry] of Object.entries(raw)) {
    if (entry.command) {
      result.push({
        name,
        command: entry.command,
        args: entry.args ?? [],
        env: entry.env,
      })
    }
  }

  return result
}
