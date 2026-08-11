export type ModelProvider = 'openai-compatible' | 'openai-responses' | 'anthropic' | 'google'

export interface ModelConfig {
  provider: ModelProvider
  apiKey: string
  baseUrl: string
  model: string
  maxTokens: number
  /** Total input + output context capacity. Distinct from maxTokens, which limits one response. */
  contextWindowTokens?: number
  temperature: number
  timeoutMs: number
}

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000

export function resolveContextWindowTokens(config: Pick<ModelConfig, 'contextWindowTokens'>): number {
  return config.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS
}

export interface ProviderConfig {
  provider: ModelProvider
  apiKey: string
  baseUrl: string
  models: string[]
}

export interface ProvidersMap {
  [name: string]: ProviderConfig
}
