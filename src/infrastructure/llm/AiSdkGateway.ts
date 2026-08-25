import {
  APICallError,
  jsonSchema,
  streamText,
  type LanguageModel,
  type ModelMessage as AiModelMessage,
  type ToolSet,
} from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type {
  ModelGatewayPort,
  ModelRequest,
  ModelStreamChunk,
  ModelToolCall,
  ModelToolDefinition,
} from '../../application/ports/ModelGatewayPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'
import type { ModelConfig, ModelProvider } from '../../domain/assistant/value-objects/ModelConfig'
import { ResponseCache } from '../cache/ResponseCache'
import type { RuntimeBudgetPort } from '../../application/ports/RuntimeBudgetPort'
import { MutableRuntimeBudget } from '../runtime/MutableRuntimeBudget'

/**
 * 缓存的完整响应。
 * 必须连工具调用一起缓存：只存文本的话，命中缓存的那一轮会把工具调用静默丢掉，
 * 表现成"同一个问题第二次问就不干活了"。
 */
interface CachedResponse {
  text: string
  toolCalls: ModelToolCall[]
}

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
  private readonly cache: ResponseCache<CachedResponse>
  /**
   * 已确认不支持原生 tools 的 provider+model 组合。
   * openai-compatible 指向的是任意端点，其中相当一部分不实现 tools 参数；
   * 记下来避免每一轮都先撞一次 400 再回退。
   */
  private readonly nativeToolsUnsupported = new Set<string>()

  /**
   * 模型构造函数的注入点。
   * 生产路径永远用默认的 `createLanguageModel`；测试用它换成 MockLanguageModelV3，
   * 这样缓存重放、回退探测这些分支不需要真实 API key 也能验证。
   */
  private readonly createModel: (config: ModelConfig) => LanguageModel

  constructor(
    private config: ModelConfig,
    private readonly logger: LoggerPort,
    createModel: (config: ModelConfig) => LanguageModel = createLanguageModel,
    private readonly runtimeBudget: RuntimeBudgetPort = new MutableRuntimeBudget(),
  ) {
    this.createModel = createModel
    this.model = this.createModel(config)
    this.cache = new ResponseCache<CachedResponse>(32, 3 * 60 * 1000)
  }

  updateConfig(config: ModelConfig): void {
    this.config = config
    this.model = this.createModel(config)
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
      request.tools?.map((t) => ({ name: t.name })),
    )

    const cached = this.cache.get(cacheKey)
    if (cached) {
      this.logger.debug('Gateway cache hit', { model: request.model, key: cacheKey })
      // Simulate streaming by yielding in chunks
      const chunkSize = 120
      for (let i = 0; i < cached.text.length; i += chunkSize) {
        yield { delta: cached.text.slice(i, i + chunkSize) }
      }
      // 工具调用必须一起重放。漏掉这一步，缓存命中的那轮就只会输出文本、不执行工具。
      for (const toolCall of cached.toolCalls) {
        yield { delta: '', toolCall, usedNativeTools: true }
      }
      yield { delta: '', finishReason: 'stop' }
      return
    }

    const wantsTools = (request.tools?.length ?? 0) > 0
    const useNativeTools = wantsTools && !this.nativeToolsUnsupported.has(this.capabilityKey())

    try {
      yield* this.streamWithRetries(request, cacheKey, useNativeTools)
    } catch (error) {
      // provider 不认 tools 参数：记下来，改用纯文本重跑一次。
      // 调用方看到 usedNativeTools 为 false，会自己启用 XML 文本解析回退。
      if (useNativeTools && isUnsupportedToolsError(error)) {
        this.nativeToolsUnsupported.add(this.capabilityKey())
        this.logger.debug('Provider rejected native tools; falling back to text protocol', {
          provider: this.config.provider,
          model: request.model,
        })
        yield* this.streamWithRetries(request, cacheKey, false)
        return
      }

      throw error
    }
  }

  /** provider 能力按 provider+baseUrl+model 记录 —— 同一个 provider 换个端点结论可能完全不同。 */
  private capabilityKey(): string {
    return `${this.config.provider}::${this.config.baseUrl}::${this.config.model}`
  }

  private async *streamWithRetries(
    request: ModelRequest,
    cacheKey: string,
    useNativeTools: boolean,
  ): AsyncIterable<ModelStreamChunk> {
    const { maxModelRetries, retryBaseDelayMs } = this.runtimeBudget.get()
    for (let attempt = 0; attempt <= maxModelRetries; attempt += 1) {
      let emittedContent = false
      try {
        for await (const chunk of this.streamOnce(request, cacheKey, useNativeTools)) {
          if (chunk.delta || chunk.toolCall) emittedContent = true
          yield chunk
        }
        return
      } catch (error) {
        if (emittedContent || attempt >= maxModelRetries || !isRetryableModelError(error)) {
          throw error
        }

        const retryAttempt = attempt + 1
        const delayMs = retryBaseDelayMs * 2 ** attempt
        const reason = error instanceof Error ? error.message : String(error)
        this.logger.warn('Retrying model request', {
          attempt: retryAttempt,
          maxRetries: maxModelRetries,
          delayMs,
          reason,
        })
        yield {
          delta: '',
          retry: { attempt: retryAttempt, maxRetries: maxModelRetries, delayMs, reason },
        }
        await abortableDelay(delayMs, request.abortSignal)
      }
    }
  }

  private async *streamOnce(
    request: ModelRequest,
    cacheKey: string,
    useNativeTools: boolean,
  ): AsyncIterable<ModelStreamChunk> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), this.config.timeoutMs)
    const forwardAbort = () => controller.abort(request.abortSignal?.reason ?? new Error('aborted'))

    request.abortSignal?.addEventListener('abort', forwardAbort)

    // Accumulate the full response for caching
    let fullText = ''
    let didStream = false
    const toolCalls: ModelToolCall[] = []

    try {
      const system = request.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n') || undefined
      const messages = request.messages.filter((message) => message.role !== 'system')
      const result = streamText({
        model: this.model,
        system,
        messages: messages.map(toAiModelMessage),
        maxRetries: 0,
        // The gateway owns retries and status reporting; SDK's default handler writes into Ink.
        onError: () => {},
        temperature: request.temperature ?? this.config.temperature,
        maxOutputTokens: request.maxTokens ?? this.config.maxTokens,
        abortSignal: controller.signal,
        ...(useNativeTools ? { tools: buildToolSet(request.tools ?? []) } : {}),
      })

      // 必须用 fullStream 而不是 textStream：textStream 会丢弃所有 tool-call part，
      // 只加 tools 却不换流，结果是"模型看起来什么都没输出"。
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          didStream = true
          fullText += part.text
          yield { delta: part.text, usedNativeTools: useNativeTools }
          continue
        }

        if (part.type === 'tool-call') {
          didStream = true
          const toolCall: ModelToolCall = {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            // input 在 ToolExecutorPort 那侧是 string，各 handler 自己 parseJsonObject。
            input: typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {}),
          }
          toolCalls.push(toolCall)
          yield { delta: '', toolCall, usedNativeTools: true }
          continue
        }

        if (part.type === 'error') {
          throw part.error
        }
      }

      // Cache successful non-aborted responses
      if (fullText.trim() || toolCalls.length > 0) {
        this.cache.set(cacheKey, { text: fullText, toolCalls })
      }

      yield { delta: '', finishReason: 'stop', usedNativeTools: useNativeTools }
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

function isRetryableModelError(error: unknown): boolean {
  return APICallError.isInstance(error) && error.isRetryable === true
}

async function abortableDelay(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) throw new Error('Request aborted')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Request aborted'))
    }
    abortSignal?.addEventListener('abort', onAbort, { once: true })
    setTimeout(() => abortSignal?.removeEventListener('abort', onAbort), delayMs)
  })
}

function toAiModelMessage(message: import('../../application/ports/ModelGatewayPort').ModelMessage): AiModelMessage {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        output: message.ok
          ? { type: 'text', value: message.content }
          : { type: 'error-text', value: message.content },
      }],
    }
  }

  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: [
        ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
        ...message.toolCalls.map((call) => ({
          type: 'tool-call' as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: parseToolInput(call.input),
        })),
      ],
    }
  }

  return { role: message.role, content: message.content }
}

function parseToolInput(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    return { raw: input }
  }
}

/**
 * 转成 AI SDK 的工具集合。
 * 刻意不带 execute —— 执行留在 LocalToolExecutor，那里才有审批流程。
 * 给了 execute，SDK 会自动跑工具，审批面板就被绕过去了。
 */
function buildToolSet(definitions: ModelToolDefinition[]): ToolSet {
  const tools: ToolSet = {}

  for (const definition of definitions) {
    tools[definition.name] = {
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
    }
  }

  return tools
}

/**
 * 判断错误是不是"这个端点不支持 tools"。
 * 合规的 provider 会抛 UnsupportedFunctionalityError，但指向任意端点的
 * openai-compatible 更常见的是直接回一个 400 —— 两种都要认。
 */
function isUnsupportedToolsError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    // 只在 4xx 时回退。5xx 是服务端故障，重试一次纯文本只会掩盖真正的问题。
    const status = error.statusCode ?? 0
    if (status < 400 || status >= 500) {
      return false
    }

    const haystack = `${error.message} ${error.responseBody ?? ''}`.toLowerCase()
    return (
      haystack.includes('tool') ||
      haystack.includes('function') ||
      haystack.includes('not supported') ||
      haystack.includes('unsupported')
    )
  }

  const name = error instanceof Error ? error.name : ''
  if (name === 'AI_UnsupportedFunctionalityError') {
    return true
  }

  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('does not support tools') || message.includes('tools are not supported')
}
