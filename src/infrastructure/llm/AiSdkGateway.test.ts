/// <reference path="../../types/bun-test.d.ts" />
import { describe, expect, test } from 'bun:test'
import { APICallError, type LanguageModel } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { AiSdkGateway } from './AiSdkGateway'
import type { LoggerPort } from '../../application/ports/LoggerPort'
import type { ModelRequest, ModelStreamChunk } from '../../application/ports/ModelGatewayPort'
import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'

function createLogger(): LoggerPort {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
}

const CONFIG: ModelConfig = {
  provider: 'openai-compatible',
  apiKey: 'x',
  baseUrl: 'https://example.com',
  model: 'test-model',
  maxTokens: 1000,
  temperature: 0,
  timeoutMs: 5000,
}

const TOOLS: ModelRequest['tools'] = [
  {
    name: 'shell-runner',
    description: 'Run terminal commands',
    inputSchema: {
      type: 'object',
      properties: { argv: { type: 'array', items: { type: 'string' } } },
      required: ['argv'],
    },
  },
]

/** 组装一段 AI SDK 的流：正文 + 可选的一个工具调用。 */
function streamOf(options: { text?: string; toolCall?: { name: string; input: string } }) {
  const parts: unknown[] = [{ type: 'stream-start', warnings: [] }]

  if (options.text) {
    parts.push(
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: options.text },
      { type: 'text-end', id: 't1' },
    )
  }

  if (options.toolCall) {
    parts.push({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: options.toolCall.name,
      input: options.toolCall.input,
    })
  }

  parts.push({
    type: 'finish',
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  })

  return {
    stream: simulateReadableStream({ chunks: parts as never[] }),
  }
}

async function collect(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) {
    chunks.push(chunk)
  }
  return chunks
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    messages: [{ role: 'user', content: 'run git status' }],
    model: 'test-model',
    temperature: 0,
    maxTokens: 1000,
    tools: TOOLS,
    ...overrides,
  }
}

describe('AiSdkGateway native tools', () => {
  test('passes system instructions separately from conversation messages', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => streamOf({ text: 'ok' }) as never,
    })
    const gateway = new AiSdkGateway(CONFIG, createLogger(), () => model as unknown as LanguageModel)

    await collect(gateway.streamChat(request({
      messages: [
        { role: 'system', content: 'trusted host instructions' },
        { role: 'user', content: 'hello' },
      ],
      tools: [],
    })))

    const prompt = model.doStreamCalls[0]?.prompt ?? []
    expect(prompt[0]?.role).toBe('system')
    expect(prompt[0]?.content).toContain('trusted host instructions')
    expect(prompt.filter((message) => message.role === 'system')).toHaveLength(1)
  })

  test('surfaces a native tool call as a structured chunk', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () =>
        streamOf({ toolCall: { name: 'shell-runner', input: '{"argv":["git","status"]}' } }) as never,
    })

    const gateway = new AiSdkGateway(CONFIG, createLogger(), () => model as unknown as LanguageModel)
    const chunks = await collect(gateway.streamChat(request()))

    const toolChunk = chunks.find((chunk) => chunk.toolCall)
    expect(toolChunk?.toolCall?.toolName).toBe('shell-runner')
    expect(toolChunk?.toolCall?.input).toBe('{"argv":["git","status"]}')
    expect(toolChunk?.usedNativeTools).toBe(true)
  })

  test('passes the declared tools through to the provider', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => streamOf({ text: 'ok' }) as never,
    })

    const gateway = new AiSdkGateway(CONFIG, createLogger(), () => model as unknown as LanguageModel)
    await collect(gateway.streamChat(request()))

    const call = model.doStreamCalls[0]
    expect(call?.tools).toHaveLength(1)
    expect(call?.tools?.[0]?.name).toBe('shell-runner')
  })

  test('maps native call history to standard assistant and tool messages', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => streamOf({ text: 'done' }) as never,
    })
    const gateway = new AiSdkGateway(CONFIG, createLogger(), () => model as unknown as LanguageModel)

    await collect(gateway.streamChat(request({
      messages: [
        { role: 'user', content: 'inspect' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{
            toolCallId: 'call-history-1',
            toolName: 'shell-runner',
            input: '{"argv":["git","status"]}',
          }],
        },
        {
          role: 'tool',
          content: 'clean',
          toolCallId: 'call-history-1',
          toolName: 'shell-runner',
          ok: true,
        },
      ],
    })))

    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt)
    expect(prompt).toContain('call-history-1')
    expect(prompt).toContain('tool-call')
    expect(prompt).toContain('tool-result')
    expect(prompt).toContain('clean')
  })

  test('omits tools entirely when the caller declares none', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => streamOf({ text: 'plain' }) as never,
    })

    const gateway = new AiSdkGateway(CONFIG, createLogger(), () => model as unknown as LanguageModel)
    await collect(gateway.streamChat(request({ tools: [] })))

    // 空数组也不能传 —— 部分端点看到 tools 字段就走另一条代码路径。
    expect(model.doStreamCalls[0]?.tools ?? []).toHaveLength(0)
  })
})

describe('AiSdkGateway visible retries', () => {
  test('emits two retry updates and succeeds on the third total attempt', async () => {
    let providerCalls = 0
    const model = new MockLanguageModelV3({
      doStream: async () => {
        providerCalls += 1
        if (providerCalls < 3) {
          throw new APICallError({
            message: 'temporarily unavailable',
            url: 'https://example.com/v1/chat/completions',
            requestBodyValues: {},
            statusCode: 503,
            isRetryable: true,
          })
        }
        return streamOf({ text: 'recovered' }) as never
      },
    })
    const gateway = new AiSdkGateway(CONFIG, createLogger(), () => model as unknown as LanguageModel)

    const chunks = await collect(gateway.streamChat(request({ tools: [] })))

    expect(providerCalls).toBe(3)
    expect(chunks.filter((chunk) => chunk.retry).map((chunk) => chunk.retry?.attempt)).toEqual([1, 2])
    expect(chunks.map((chunk) => chunk.delta).join('')).toContain('recovered')
  })
})

/**
 * 缓存命中必须连工具调用一起重放。
 * 只重放文本的话表现是「同一个问题第二次问就不执行工具了」—— 静默、且极难定位。
 */
describe('AiSdkGateway cache replay', () => {
  test('replays tool calls on a cache hit, not just text', async () => {
    let providerCalls = 0
    const model = new MockLanguageModelV3({
      doStream: async () => {
        providerCalls += 1
        return streamOf({
          text: 'Checking the tree.',
          toolCall: { name: 'shell-runner', input: '{"argv":["git","status"]}' },
        }) as never
      },
    })

    const gateway = new AiSdkGateway(CONFIG, createLogger(), () => model as unknown as LanguageModel)

    const first = await collect(gateway.streamChat(request()))
    const second = await collect(gateway.streamChat(request()))

    // 第二次没有打到 provider —— 确实走了缓存。
    expect(providerCalls).toBe(1)

    const firstTool = first.find((chunk) => chunk.toolCall)?.toolCall
    const secondTool = second.find((chunk) => chunk.toolCall)?.toolCall
    expect(firstTool?.toolName).toBe('shell-runner')
    expect(secondTool?.toolName).toBe('shell-runner')
    expect(secondTool?.input).toBe(firstTool?.input)

    // 文本也要完整重放。
    expect(second.map((chunk) => chunk.delta).join('')).toContain('Checking the tree.')
  })

  test('clearCache forces the next request back to the provider', async () => {
    let providerCalls = 0
    const model = new MockLanguageModelV3({
      doStream: async () => {
        providerCalls += 1
        return streamOf({ text: 'hello' }) as never
      },
    })

    const gateway = new AiSdkGateway(CONFIG, createLogger(), () => model as unknown as LanguageModel)

    await collect(gateway.streamChat(request()))
    gateway.clearCache()
    await collect(gateway.streamChat(request()))

    expect(providerCalls).toBe(2)
  })
})

/**
 * openai-compatible 指向任意端点，其中不少不实现 tools 参数。
 * 撞上之后要降级到纯文本，并让调用方知道原生通道没走通。
 */
describe('AiSdkGateway unsupported-tools fallback', () => {
  function toolsRejectedError(): APICallError {
    return new APICallError({
      message: 'Unsupported parameter: tools is not supported by this model',
      url: 'https://example.com/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 400,
      responseBody: '{"error":{"message":"tools are not supported"}}',
    })
  }

  test('retries without tools and reports that native tools were not used', async () => {
    const seenTools: Array<number> = []
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        seenTools.push(options.tools?.length ?? 0)
        if ((options.tools?.length ?? 0) > 0) {
          throw toolsRejectedError()
        }
        return streamOf({ text: 'plain text answer' }) as never
      },
    })

    const gateway = new AiSdkGateway(CONFIG, createLogger(), () => model as unknown as LanguageModel)
    const chunks = await collect(gateway.streamChat(request()))

    // 第一次带 tools 被拒，第二次不带 tools 成功。
    expect(seenTools).toEqual([1, 0])
    expect(chunks.map((chunk) => chunk.delta).join('')).toContain('plain text answer')
    // 调用方靠这个字段决定要不要启用 XML 文本解析回退。
    expect(chunks.every((chunk) => chunk.usedNativeTools !== true)).toBe(true)
  })

  test('remembers the rejection so later turns skip the failed attempt', async () => {
    let attemptsWithTools = 0
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        if ((options.tools?.length ?? 0) > 0) {
          attemptsWithTools += 1
          throw toolsRejectedError()
        }
        return streamOf({ text: 'plain text answer' }) as never
      },
    })

    const gateway = new AiSdkGateway(CONFIG, createLogger(), () => model as unknown as LanguageModel)

    await collect(gateway.streamChat(request()))
    // 换一句话，避开缓存，确认走的是「记住了」而不是「命中缓存」。
    await collect(
      gateway.streamChat(request({ messages: [{ role: 'user', content: 'something else' }] })),
    )

    // 只在第一轮试探过一次，之后直接用纯文本。
    expect(attemptsWithTools).toBe(1)
  })

  test('does not fall back on a server error', async () => {
    let attempts = 0
    const model = new MockLanguageModelV3({
      doStream: async () => {
        attempts += 1
        throw new APICallError({
          message: 'Internal server error',
          url: 'https://example.com/v1/chat/completions',
          requestBodyValues: {},
          statusCode: 500,
          responseBody: 'upstream tool service crashed',
          // AI SDK 默认把 5xx 当可重试，会自己退避重试几轮。
          // 这里要验的是网关的 4xx/5xx 判定，不是 SDK 的重试策略，所以关掉。
          isRetryable: false,
        })
      },
    })

    const gateway = new AiSdkGateway(CONFIG, createLogger(), () => model as unknown as LanguageModel)

    // 5xx 是服务端故障。重试一次纯文本只会把真正的问题掩盖成「这个端点不支持工具」。
    await expect(collect(gateway.streamChat(request()))).rejects.toThrow()
    // 只试了一次 —— 没有偷偷去掉 tools 再跑一遍。
    expect(attempts).toBe(1)
  })
})
