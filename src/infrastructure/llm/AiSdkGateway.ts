import { streamText, type LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type {
  ModelGatewayPort,
  ModelRequest,
  ModelStreamChunk,
} from '../../application/ports/ModelGatewayPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'
import type { ModelConfig, ModelProvider } from '../../domain/assistant/value-objects/ModelConfig'
import { ResponseCache } from '../cache/ResponseCache'

function createLanguageModel(config: ModelConfig): LanguageModel {
  const providerFactories: Record<ModelProvider, () => LanguageModel> = {
    'openai-compatible': () =>
      createOpenAICompatible({
        name: 'custom',
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      }).chatModel(config.model),
    'openai-responses': () =>
      createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl }).responses(config.model),
    anthropic: () =>
      createAnthropic({ apiKey: config.apiKey, baseURL: config.baseUrl })(config.model),
    google: () =>
      createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: config.baseUrl })(config.model),
  }

  return providerFactories[config.provider]()
}

/**
 * 基于 Vercel AI SDK 的模型网关。
 * 统一支持 OpenAI / Anthropic / Google / OpenAI-compatible 多种 provider。
 */
export class AiSdkGateway implements ModelGatewayPort {
  private model: LanguageModel
  private readonly cache: ResponseCache<string>

  constructor(
    private config: ModelConfig,
    private readonly logger: LoggerPort,
  ) {
    this.model = createLanguageModel(config)
    this.cache = new ResponseCache<string>(32, 3 * 60 * 1000)
  }

  updateConfig(config: ModelConfig): void {
    this.config = config
    this.model = createLanguageModel(config)
    this.cache.clear()
  }

  clearCache(): void {
    this.cache.clear()
  }

  async *streamChat(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    // Check cache — if we've seen this exact request recently, replay it
    const cacheKey = ResponseCache.computeKey(
      request.messages,
      request.model,
      request.temperature,
      request.maxTokens,
    )

    const cached = this.cache.get(cacheKey)
    if (cached) {
      this.logger.debug('Gateway cache hit', { model: request.model, key: cacheKey })
      // Simulate streaming by yielding in chunks
      const chunkSize = 120
      for (let i = 0; i < cached.length; i += chunkSize) {
        yield { delta: cached.slice(i, i + chunkSize) }
      }
      yield { delta: '', finishReason: 'stop' }
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), this.config.timeoutMs)
    const forwardAbort = () => controller.abort(request.abortSignal?.reason ?? new Error('aborted'))

    request.abortSignal?.addEventListener('abort', forwardAbort)

    // Accumulate the full response for caching
    let fullText = ''
    let didStream = false

    try {
      const result = streamText({
        model: this.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: request.temperature ?? this.config.temperature,
        maxOutputTokens: request.maxTokens ?? this.config.maxTokens,
        abortSignal: controller.signal,
      })

      for await (const chunk of (await result).textStream) {
        didStream = true
        fullText += chunk
        yield { delta: chunk }
      }

      // Cache successful non-aborted responses
      if (fullText.trim()) {
        this.cache.set(cacheKey, fullText)
      }

      yield { delta: '', finishReason: 'stop' }
    } catch (error) {
      // If we partially streamed before failing, don't cache
      if (didStream && fullText) {
        this.logger.debug('Partial stream not cached due to error', { length: fullText.length })
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        if (request.abortSignal?.aborted) {
          throw new Error('Request aborted')
        }
        throw new Error(`Model API timeout after ${this.config.timeoutMs}ms`)
      }

      const message = error instanceof Error ? error.message : String(error)
      this.logger.error('AI SDK stream error', { error: message, provider: this.config.provider })
      throw error
    } finally {
      clearTimeout(timeout)
      request.abortSignal?.removeEventListener('abort', forwardAbort)
    }
  }
}
