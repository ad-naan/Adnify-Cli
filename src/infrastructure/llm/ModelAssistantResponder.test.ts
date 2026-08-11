/// <reference path="../../types/bun-test.d.ts" />
import { describe, expect, test } from 'bun:test'
import type { AssistantPromptSet } from '../../application/dto/AssistantPromptSet'
import { createAppI18n } from '../../application/i18n/AppI18n'
import type { CliConfigPort } from '../../application/ports/CliConfigPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'
import type {
  ModelGatewayPort,
  ModelRequest,
  ModelStreamChunk,
} from '../../application/ports/ModelGatewayPort'
import type {
  ToolExecutionRequest,
  ToolExecutorPort,
  ToolExecutionResult,
} from '../../application/ports/ToolExecutorPort'
import { AssistantProfile } from '../../domain/assistant/entities/AssistantProfile'
import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'
import { ConversationSession } from '../../domain/session/aggregates/ConversationSession'
import { ToolDescriptor } from '../../domain/tooling/entities/ToolDescriptor'
import { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'
import { ModelAssistantResponder } from './ModelAssistantResponder'



function createMockLogger(): LoggerPort {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

function createMockConfig(promptSet: AssistantPromptSet): CliConfigPort {
  return {
    getAssistantProfile: () =>
      new AssistantProfile({
        id: 'test',
        name: 'Test',
        author: 'test',
        tagline: 'test',
        description: 'test',
        defaultMode: 'agent',
      }),
    getAssistantPromptSet: () => promptSet,
    getModelConfig: () =>
      ({
        provider: 'openai-compatible',
        apiKey: 'x',
        baseUrl: 'https://example.com',
        model: 'test-model',
        maxTokens: 1000,
        temperature: 0,
        timeoutMs: 1000,
      }) satisfies ModelConfig,
    getProviders: () => ({}),
    switchModel: () => null,
    getToolCatalog: () => [],
    getLocalCommands: () => [],
    getStorage: () => ({
      dataRoot: '/workspace/.adnify',
      configPath: '/workspace/.adnify/config.json',
      sessionsDir: '/workspace/.adnify/sessions',
      source: 'default',
      isCustom: false,
    }),
  }
}

function createMockToolExecutor(): ToolExecutorPort {
  return {
    execute: async (request) => ({
      toolId: request.toolId,
      ok: true,
      content: `tool output for ${request.toolId}: ${request.input}`,
    }),
  }
}

describe('ModelAssistantResponder', () => {
  test('should compose system prompt from prompt set, workspace context, and tools', async () => {
    let capturedRequest: ModelRequest | null = null

    const gateway: ModelGatewayPort = {
      async *streamChat(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        capturedRequest = request
        yield { delta: 'done', finishReason: 'stop' }
      },
    }

    const promptSet: AssistantPromptSet = {
      core: 'core system',
      modes: {
        chat: 'chat instructions',
        agent: 'agent instructions',
        plan: 'plan instructions',
      },
    }

    const responder = new ModelAssistantResponder(
      gateway,
      {
        provider: 'openai-compatible',
        apiKey: 'x',
        baseUrl: 'https://example.com',
        model: 'test-model',
        maxTokens: 1000,
        temperature: 0,
        timeoutMs: 1000,
      },
      createMockConfig(promptSet),
      createMockToolExecutor(),
      createMockLogger(),
      createAppI18n('zh-CN'),
    )

    const session = ConversationSession.create({
      id: 'session-1',
      title: 'test',
      mode: 'agent',
      workspacePath: '/workspace',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    for await (const _chunk of responder.streamReply({
      prompt: 'implement feature',
      session,
      workspace: new WorkspaceContext({
        rootPath: '/workspace',
        isGitRepository: true,
        packageManager: 'bun',
        topLevelEntries: ['src', 'package.json'],
      }),
      toolCatalog: [
        new ToolDescriptor({
          id: 'shell-runner',
          name: 'Shell Runner',
          description: 'Run terminal commands',
          category: 'terminal',
          riskLevel: 'dangerous',
        }),
      ],
    })) {
      // consume
    }

    expect(capturedRequest).not.toBeNull()
    const request = capturedRequest as unknown as ModelRequest
    expect(request.messages[0]?.role).toBe('system')
    expect(request.messages[0]?.content).toContain('core system')
    expect(request.messages[0]?.content).toContain('agent instructions')
    expect(request.messages[0]?.content).toContain('当前模式：agent')
    expect(request.messages[0]?.content).toContain('Shell Runner [terminal] (dangerous)')
    expect(request.messages[0]?.content).toContain('adnify_tool_call')
    expect(request.messages[0]?.content).toContain('Risky actions pause for user approval')
    expect(request.messages[request.messages.length - 1]?.content).toBe('implement feature')
  })

  test('should execute tool calls before returning final answer', async () => {
    const capturedRequests: ModelRequest[] = []
    let invocation = 0

    const gateway: ModelGatewayPort = {
      async *streamChat(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        capturedRequests.push(request)
        invocation += 1

        if (invocation === 1) {
          yield {
            delta:
              '<adnify_tool_call name="search-index">{"query":"useCliController"}</adnify_tool_call>',
            finishReason: 'stop',
          }
          return
        }

        yield { delta: 'Final answer after using the tool.', finishReason: 'stop' }
      },
    }

    const responder = new ModelAssistantResponder(
      gateway,
      {
        provider: 'openai-compatible',
        apiKey: 'x',
        baseUrl: 'https://example.com',
        model: 'test-model',
        maxTokens: 1000,
        temperature: 0,
        timeoutMs: 1000,
      },
      createMockConfig({
        core: 'core system',
        modes: {
          chat: 'chat instructions',
          agent: 'agent instructions',
          plan: 'plan instructions',
        },
      }),
      createMockToolExecutor(),
      createMockLogger(),
      createAppI18n('en'),
    )

    const session = ConversationSession.create({
      id: 'session-2',
      title: 'test',
      mode: 'agent',
      workspacePath: '/workspace',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const chunks: string[] = []
    const transcripts: string[] = []
    for await (const chunk of responder.streamReply({
      prompt: 'find where the input controller lives',
      session,
      workspace: new WorkspaceContext({
        rootPath: '/workspace',
        isGitRepository: true,
        packageManager: 'bun',
        topLevelEntries: ['src', 'package.json'],
      }),
      toolCatalog: [],
    })) {
      if (chunk.transcript) {
        transcripts.push(chunk.transcript)
      }
      chunks.push(chunk.delta)
    }

    expect(chunks.join('')).toBe('Final answer after using the tool.')
    expect(transcripts).toHaveLength(2)
    expect(transcripts[0]).toContain('search-index')
    expect(transcripts[1]).toContain('tool output for search-index')
    expect(capturedRequests).toHaveLength(2)
    const secondRequest = capturedRequests[1] as ModelRequest
    expect(secondRequest.messages[secondRequest.messages.length - 1]?.content).toContain(
      'Tool result for search-index:',
    )
    expect(secondRequest.messages[secondRequest.messages.length - 1]?.content).toContain(
      'tool output for search-index',
    )
  })

  test('should pass dangerous tool calls through the executor for approval handling', async () => {
    const executedCalls: ToolExecutionRequest[] = []

    let streamInvocation = 0
    const gateway: ModelGatewayPort = {
      async *streamChat(): AsyncIterable<ModelStreamChunk> {
        streamInvocation += 1
        if (streamInvocation === 1) {
          yield {
            delta: '<adnify_tool_call name="shell-runner">{"argv":["git","status"]}</adnify_tool_call>',
            finishReason: 'stop',
          }
          return
        }
        yield { delta: 'Branch info retrieved.', finishReason: 'stop' }
      },
    }

    const toolExecutor: ToolExecutorPort = {
      async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
        executedCalls.push(request)
        return {
          toolId: request.toolId,
          ok: true,
          content: '## main\norigin/main',
        }
      },
    }

    const responder = new ModelAssistantResponder(
      gateway,
      {
        provider: 'openai-compatible',
        apiKey: 'x',
        baseUrl: 'https://example.com',
        model: 'test-model',
        maxTokens: 1000,
        temperature: 0,
        timeoutMs: 1000,
      },
      createMockConfig({
        core: 'core system',
        modes: {
          chat: 'chat instructions',
          agent: 'agent instructions',
          plan: 'plan instructions',
        },
      }),
      toolExecutor,
      createMockLogger(),
      createAppI18n('en'),
    )

    const session = ConversationSession.create({
      id: 'session-3',
      title: 'test',
      mode: 'agent',
      workspacePath: '/workspace',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const transcripts: string[] = []
    const chunks: string[] = []
    for await (const chunk of responder.streamReply({
      prompt: 'inspect the repository state',
      session,
      workspace: new WorkspaceContext({
        rootPath: '/workspace',
        isGitRepository: true,
        packageManager: 'bun',
        topLevelEntries: ['src', 'package.json'],
      }),
      toolCatalog: [
        new ToolDescriptor({
          id: 'shell-runner',
          name: 'Shell Runner',
          description: 'Run terminal commands',
          category: 'terminal',
          riskLevel: 'dangerous',
        }),
      ],
    })) {
      if (chunk.transcript) {
        transcripts.push(chunk.transcript)
      }
      chunks.push(chunk.delta)
    }

    // The executor was invoked with the shell-runner tool call
    expect(executedCalls).toHaveLength(1)
    expect(executedCalls[0]?.toolId).toBe('shell-runner')

    // Two transcript chunks: tool-start notice + tool-result output
    expect(transcripts).toHaveLength(2)
    expect(transcripts[0]).toContain('shell-runner')
    expect(transcripts[1]).toContain('## main')
  })

  test('should pass file write tool calls through the executor for approval handling', async () => {
    const executedCalls: ToolExecutionRequest[] = []

    let streamInvocation = 0
    const gateway: ModelGatewayPort = {
      async *streamChat(): AsyncIterable<ModelStreamChunk> {
        streamInvocation += 1
        if (streamInvocation === 1) {
          yield {
            delta:
              '<adnify_tool_call name="file-ops">{"action":"write","path":"src/example.ts","content":"export const a = 1","allowWrite":true}</adnify_tool_call>',
            finishReason: 'stop',
          }
          return
        }
        yield { delta: 'File created successfully.', finishReason: 'stop' }
      },
    }

    const toolExecutor: ToolExecutorPort = {
      async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
        executedCalls.push(request)
        return {
          toolId: request.toolId,
          ok: true,
          content: 'File written: src/example.ts',
        }
      },
    }

    const responder = new ModelAssistantResponder(
      gateway,
      {
        provider: 'openai-compatible',
        apiKey: 'x',
        baseUrl: 'https://example.com',
        model: 'test-model',
        maxTokens: 1000,
        temperature: 0,
        timeoutMs: 1000,
      },
      createMockConfig({
        core: 'core system',
        modes: {
          chat: 'chat instructions',
          agent: 'agent instructions',
          plan: 'plan instructions',
        },
      }),
      toolExecutor,
      createMockLogger(),
      createAppI18n('en'),
    )

    const session = ConversationSession.create({
      id: 'session-4',
      title: 'test',
      mode: 'agent',
      workspacePath: '/workspace',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const transcripts: string[] = []
    for await (const chunk of responder.streamReply({
      prompt: 'create a file',
      session,
      workspace: new WorkspaceContext({
        rootPath: '/workspace',
        isGitRepository: true,
        packageManager: 'bun',
        topLevelEntries: ['src', 'package.json'],
      }),
      toolCatalog: [
        new ToolDescriptor({
          id: 'file-ops',
          name: 'File Ops',
          description: 'Edit files',
          category: 'filesystem',
          riskLevel: 'careful',
        }),
      ],
    })) {
      if (chunk.transcript) {
        transcripts.push(chunk.transcript)
      }
    }

    // The executor was invoked for the file-ops write
    expect(executedCalls).toHaveLength(1)
    expect(executedCalls[0]?.toolId).toBe('file-ops')
    expect(executedCalls[0]?.input).toContain('write')
    expect(executedCalls[0]?.input).toContain('src/example.ts')

    // Tool executed and result shown in transcript
    expect(transcripts).toHaveLength(2)
    expect(transcripts[1]).toContain('File written')
  })

  test('should complete the full agent loop when tool execution succeeds', async () => {
    let invocation = 0
    let executed = false

    const gateway: ModelGatewayPort = {
      async *streamChat(): AsyncIterable<ModelStreamChunk> {
        invocation += 1

        if (invocation === 1) {
          yield {
            delta: '<adnify_tool_call name="shell-runner">{"argv":["git","status"]}</adnify_tool_call>',
            finishReason: 'stop',
          }
          return
        }

        yield { delta: 'Repository state reviewed.', finishReason: 'stop' }
      },
    }

    const toolExecutor: ToolExecutorPort = {
      async execute(): Promise<ToolExecutionResult> {
        executed = true
        return { toolId: 'shell-runner', ok: true, content: 'clean tree' }
      },
    }

    const responder = new ModelAssistantResponder(
      gateway,
      {
        provider: 'openai-compatible',
        apiKey: 'x',
        baseUrl: 'https://example.com',
        model: 'test-model',
        maxTokens: 1000,
        temperature: 0,
        timeoutMs: 1000,
      },
      createMockConfig({
        core: 'core system',
        modes: {
          chat: 'chat instructions',
          agent: 'agent instructions',
          plan: 'plan instructions',
        },
      }),
      toolExecutor,
      createMockLogger(),
      createAppI18n('en'),
    )

    const session = ConversationSession.create({
      id: 'session-5',
      title: 'test',
      mode: 'agent',
      workspacePath: '/workspace',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const chunks: string[] = []
    const transcripts: string[] = []
    for await (const chunk of responder.streamReply({
      prompt: 'inspect the repository state',
      session,
      workspace: new WorkspaceContext({
        rootPath: '/workspace',
        isGitRepository: true,
        packageManager: 'bun',
        topLevelEntries: ['src', 'package.json'],
      }),
      toolCatalog: [
        new ToolDescriptor({
          id: 'shell-runner',
          name: 'Shell Runner',
          description: 'Run terminal commands',
          category: 'terminal',
          riskLevel: 'dangerous',
        }),
      ],
    })) {
      if (chunk.transcript) {
        transcripts.push(chunk.transcript)
      }
      chunks.push(chunk.delta)
    }

    // Tool was executed
    expect(executed).toBe(true)
    // Final answer includes the model's second response
    expect(chunks.join('')).toBe('Repository state reviewed.')
    // Two transcript entries (tool start + tool result)
    expect(transcripts).toHaveLength(2)
    expect(transcripts[1]).toContain('clean tree')
  })
})

/**
 * 原生 function calling 路径。
 * 上面那批 fake 全靠 yield 字面 XML 驱动，覆盖的是 provider 不支持 tools 时的回退路径；
 * 这里的 fake 只 yield {toolCall}，正文为空 —— 这才是原生通道的真实形态。
 */
describe('ModelAssistantResponder native tool calls', () => {
  const PROMPT_SET: AssistantPromptSet = {
    core: 'core system',
    modes: { chat: 'chat instructions', agent: 'agent instructions', plan: 'plan instructions' },
  }

  const MODEL_CONFIG: ModelConfig = {
    provider: 'openai-compatible',
    apiKey: 'x',
    baseUrl: 'https://example.com',
    model: 'test-model',
    maxTokens: 1000,
    temperature: 0,
    timeoutMs: 1000,
  }

  const CATALOG = [
    new ToolDescriptor({
      id: 'shell-runner',
      name: 'Shell Runner',
      description: 'Run terminal commands',
      category: 'terminal',
      riskLevel: 'dangerous',
    }),
  ]

  function createSession(id: string): ConversationSession {
    return ConversationSession.create({
      id,
      title: 'test',
      mode: 'agent',
      workspacePath: '/workspace',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
  }

  function createWorkspace(): WorkspaceContext {
    return new WorkspaceContext({
      rootPath: '/workspace',
      isGitRepository: true,
      packageManager: 'bun',
      topLevelEntries: ['src', 'package.json'],
    })
  }

  function createResponder(
    gateway: ModelGatewayPort,
    toolExecutor: ToolExecutorPort,
  ): ModelAssistantResponder {
    return new ModelAssistantResponder(
      gateway,
      MODEL_CONFIG,
      createMockConfig(PROMPT_SET),
      toolExecutor,
      createMockLogger(),
      createAppI18n('en'),
    )
  }

  test('executes a tool call delivered through the native channel with no visible text', async () => {
    let invocation = 0
    const executedCalls: ToolExecutionRequest[] = []

    const gateway: ModelGatewayPort = {
      async *streamChat(): AsyncIterable<ModelStreamChunk> {
        invocation += 1

        if (invocation === 1) {
          // 原生调用的典型形态：delta 为空，工具调用走结构化字段。
          yield {
            delta: '',
            toolCall: {
              toolCallId: 'call-1',
              toolName: 'shell-runner',
              input: '{"argv":["git","status"]}',
            },
            usedNativeTools: true,
          }
          yield { delta: '', finishReason: 'stop', usedNativeTools: true }
          return
        }

        yield { delta: 'Repository state reviewed.', finishReason: 'stop', usedNativeTools: true }
      },
    }

    const toolExecutor: ToolExecutorPort = {
      async execute(request): Promise<ToolExecutionResult> {
        executedCalls.push(request)
        return { toolId: request.toolId, ok: true, content: 'clean tree' }
      },
    }

    const chunks: string[] = []
    for await (const chunk of createResponder(gateway, toolExecutor).streamReply({
      prompt: 'inspect the repository state',
      session: createSession('native-1'),
      workspace: createWorkspace(),
      toolCatalog: CATALOG,
    })) {
      chunks.push(chunk.delta)
    }

    expect(executedCalls).toHaveLength(1)
    expect(executedCalls[0]?.toolId).toBe('shell-runner')
    expect(executedCalls[0]?.input).toBe('{"argv":["git","status"]}')
    // 结构化调用不该有任何 XML 漏进可见正文。
    expect(chunks.join('')).toBe('Repository state reviewed.')
  })

  test('sends tool definitions with real JSON Schema to the gateway', async () => {
    let capturedRequest: ModelRequest | null = null

    const gateway: ModelGatewayPort = {
      async *streamChat(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        capturedRequest = request
        yield { delta: 'done', finishReason: 'stop', usedNativeTools: true }
      },
    }

    for await (const _chunk of createResponder(gateway, createMockToolExecutor()).streamReply({
      prompt: 'hello',
      session: createSession('native-2'),
      workspace: createWorkspace(),
      toolCatalog: CATALOG,
    })) {
      // consume
    }

    const request = capturedRequest as unknown as ModelRequest
    expect(request.tools).toHaveLength(1)
    const shell = request.tools?.[0]
    // name 必须是 id（shell-runner），不是展示名（Shell Runner）——
    // executor 是按 id 查表的，传展示名会导致工具找不到。
    expect(shell?.name).toBe('shell-runner')
    expect(shell?.inputSchema.required).toEqual(['argv'])
  })

  test('drops the XML protocol prose on the next turn once native tools are confirmed', async () => {
    const capturedRequests: ModelRequest[] = []
    let invocation = 0

    const gateway: ModelGatewayPort = {
      async *streamChat(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        capturedRequests.push(request)
        invocation += 1

        if (invocation === 1) {
          yield {
            delta: '',
            toolCall: { toolCallId: 'c1', toolName: 'shell-runner', input: '{"argv":["git","log"]}' },
            usedNativeTools: true,
          }
          return
        }

        yield { delta: 'Done.', finishReason: 'stop', usedNativeTools: true }
      },
    }

    const toolExecutor: ToolExecutorPort = {
      async execute(): Promise<ToolExecutionResult> {
        return { toolId: 'shell-runner', ok: true, content: 'log output' }
      },
    }

    const responder = createResponder(gateway, toolExecutor)
    const workspace = createWorkspace()

    for await (const _chunk of responder.streamReply({
      prompt: 'read the log',
      session: createSession('native-3'),
      workspace,
      toolCatalog: CATALOG,
    })) {
      // consume
    }

    // 第一轮还没有观察结果，保守地注入散文。
    expect(capturedRequests[0]?.messages[0]?.content).toContain('adnify_tool_call')
    // 工具目录本身在两种模式下都要保留。
    expect(capturedRequests[0]?.messages[0]?.content).toContain('Shell Runner [terminal]')

    // 系统提示每次 streamReply 只构建一次，所以生效点是下一次用户发言，
    // 而不是同一次调用的第二轮 —— 中途换系统提示会让 prompt 缓存全部失效。
    const before = capturedRequests.length
    for await (const _chunk of responder.streamReply({
      prompt: 'and now the diff',
      session: createSession('native-3b'),
      workspace,
      toolCatalog: CATALOG,
    })) {
      // consume
    }

    const nextTurn = capturedRequests[before]
    expect(nextTurn?.messages[0]?.content).not.toContain('adnify_tool_call')
    expect(nextTurn?.messages[0]?.content).toContain('Shell Runner [terminal]')
  })

  test('keeps the XML protocol prose when the gateway reports no native tools', async () => {
    let capturedRequest: ModelRequest | null = null

    const gateway: ModelGatewayPort = {
      async *streamChat(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        capturedRequest = request
        yield { delta: 'plain answer', finishReason: 'stop', usedNativeTools: false }
      },
    }

    for await (const _chunk of createResponder(gateway, createMockToolExecutor()).streamReply({
      prompt: 'hello',
      session: createSession('native-4'),
      workspace: createWorkspace(),
      toolCatalog: CATALOG,
    })) {
      // consume
    }

    const request = capturedRequest as unknown as ModelRequest
    expect(request.messages[0]?.content).toContain('adnify_tool_call')
  })

  test('records what the model called so history has no empty assistant turn', async () => {
    const capturedRequests: ModelRequest[] = []
    let invocation = 0

    const gateway: ModelGatewayPort = {
      async *streamChat(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        capturedRequests.push(request)
        invocation += 1

        if (invocation === 1) {
          yield {
            delta: '',
            toolCall: { toolCallId: 'c1', toolName: 'shell-runner', input: '{"argv":["git","diff"]}' },
            usedNativeTools: true,
          }
          return
        }

        yield { delta: 'Reviewed.', finishReason: 'stop', usedNativeTools: true }
      },
    }

    const toolExecutor: ToolExecutorPort = {
      async execute(): Promise<ToolExecutionResult> {
        return { toolId: 'shell-runner', ok: true, content: 'no changes' }
      },
    }

    for await (const _chunk of createResponder(gateway, toolExecutor).streamReply({
      prompt: 'check the diff',
      session: createSession('native-5'),
      workspace: createWorkspace(),
      toolCatalog: CATALOG,
    })) {
      // consume
    }

    const second = capturedRequests[1]
    expect(second).not.toBeUndefined()
    const replayed = second?.messages ?? []
    const assistantTurn = replayed[replayed.length - 2]
    expect(assistantTurn?.role).toBe('assistant')
    expect(assistantTurn?.role === 'assistant' ? assistantTurn.toolCalls?.[0] : undefined).toEqual({
      toolCallId: 'c1',
      toolName: 'shell-runner',
      input: '{"argv":["git","diff"]}',
    })
    const toolTurn = replayed[replayed.length - 1]
    expect(toolTurn?.role).toBe('tool')
    expect(toolTurn?.content).toContain('no changes')
  })

  test('requires a verification attempt after a successful file mutation', async () => {
    const capturedRequests: ModelRequest[] = []
    const executedCalls: ToolExecutionRequest[] = []
    let invocation = 0

    const gateway: ModelGatewayPort = {
      async *streamChat(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        capturedRequests.push(request)
        invocation += 1

        if (invocation === 1) {
          yield {
            delta: '',
            toolCall: {
              toolCallId: 'write-1',
              toolName: 'file-ops',
              input: '{"action":"write","path":"src/new.ts","content":"export {}","allowWrite":true}',
            },
            usedNativeTools: true,
          }
          return
        }
        if (invocation === 2) {
          yield { delta: 'Implemented.', finishReason: 'stop', usedNativeTools: true }
          return
        }
        if (invocation === 3) {
          yield {
            delta: '',
            toolCall: {
              toolCallId: 'verify-1',
              toolName: 'shell-runner',
              input: '{"argv":["npm","run","typecheck"]}',
            },
            usedNativeTools: true,
          }
          return
        }
        yield { delta: 'Implemented and verified.', finishReason: 'stop', usedNativeTools: true }
      },
    }

    const toolExecutor: ToolExecutorPort = {
      async execute(request): Promise<ToolExecutionResult> {
        executedCalls.push(request)
        return { toolId: request.toolId, ok: true, content: 'ok' }
      },
    }

    const fileTool = new ToolDescriptor({
      id: 'file-ops',
      name: 'File Ops',
      description: 'Edit files',
      category: 'filesystem',
      riskLevel: 'careful',
    })

    for await (const _chunk of createResponder(gateway, toolExecutor).streamReply({
      prompt: 'implement it',
      session: createSession('native-verify'),
      workspace: createWorkspace(),
      toolCatalog: [...CATALOG, fileTool],
    })) {
      // consume
    }

    expect(executedCalls.map((call) => call.toolId)).toEqual(['file-ops', 'shell-runner'])
    expect(capturedRequests).toHaveLength(4)
    expect(capturedRequests[2]?.messages.at(-1)?.content).toContain('have not attempted verification')
  })

  test('streams tool progress to the transcript before the final result', async () => {
    let invocation = 0

    const gateway: ModelGatewayPort = {
      async *streamChat(): AsyncIterable<ModelStreamChunk> {
        invocation += 1

        if (invocation === 1) {
          yield {
            delta: '',
            toolCall: {
              toolCallId: 'call-1',
              toolName: 'task',
              input: '{"tasks":[{"title":"Audit logging","instruction":"x"}]}',
            },
            usedNativeTools: true,
          }
          yield { delta: '', finishReason: 'stop', usedNativeTools: true }
          return
        }

        yield { delta: 'Summarised.', finishReason: 'stop', usedNativeTools: true }
      },
    }

    // 一个耗时工具：先推两条进度，再返回结果。
    const toolExecutor: ToolExecutorPort = {
      async execute(request): Promise<ToolExecutionResult> {
        request.onProgress?.({ toolId: request.toolId, message: '▸ started: Audit logging' })
        await new Promise((resolve) => setTimeout(resolve, 5))
        request.onProgress?.({ toolId: request.toolId, message: '✓ Audit logging (1/1)', ok: true })
        return { toolId: request.toolId, ok: true, content: 'found 12 logger calls' }
      },
    }

    const transcripts: string[] = []
    for await (const chunk of createResponder(gateway, toolExecutor).streamReply({
      prompt: 'audit the logging',
      session: createSession('progress-1'),
      workspace: createWorkspace(),
      toolCatalog: CATALOG,
    })) {
      if (chunk.transcript) {
        transcripts.push(chunk.transcript)
      }
    }

    const startedAt = transcripts.findIndex((entry) => entry.includes('▸ started: Audit logging'))
    const completedAt = transcripts.findIndex((entry) => entry.includes('✓ Audit logging (1/1)'))
    const resultAt = transcripts.findIndex((entry) => entry.includes('found 12 logger calls'))

    // 进度必须在结果之前上屏 —— 否则它就不是进度，只是事后总结。
    expect(startedAt).toBeGreaterThan(-1)
    expect(completedAt).toBeGreaterThan(startedAt)
    expect(resultAt).toBeGreaterThan(completedAt)
  })

  test('lets the model plan read-only, then resume execution for a complex task', async () => {
    let invocation = 0
    const executed: string[] = []
    const gateway: ModelGatewayPort = {
      async *streamChat(): AsyncIterable<ModelStreamChunk> {
        invocation += 1
        if (invocation === 1) {
          yield { delta: '', toolCall: { toolCallId: 'p1', toolName: 'workflow-phase', input: '{"phase":"plan","rationale":"cross-file migration"}' }, usedNativeTools: true }
          return
        }
        if (invocation === 2) {
          yield { delta: '', toolCall: { toolCallId: 'blocked', toolName: 'shell-runner', input: '{"argv":["npm","run","typecheck"]}' }, usedNativeTools: true }
          return
        }
        if (invocation === 3) {
          yield { delta: '', toolCall: { toolCallId: 'p2', toolName: 'workflow-phase', input: '{"phase":"execute","rationale":"plan is actionable"}' }, usedNativeTools: true }
          return
        }
        if (invocation === 4) {
          yield { delta: '', toolCall: { toolCallId: 'run', toolName: 'shell-runner', input: '{"argv":["npm","run","typecheck"]}' }, usedNativeTools: true }
          return
        }
        yield { delta: 'Planned and executed.', finishReason: 'stop', usedNativeTools: true }
      },
    }
    const toolExecutor: ToolExecutorPort = {
      async execute(request) {
        executed.push(request.toolId)
        return { toolId: request.toolId, ok: true, content: 'verified' }
      },
    }

    const phases: string[] = []
    for await (const chunk of createResponder(gateway, toolExecutor).streamReply({
      prompt: 'perform a complex migration',
      session: createSession('adaptive-phase'),
      workspace: createWorkspace(),
      toolCatalog: CATALOG,
    })) {
      if (chunk.workflowPhase) phases.push(chunk.workflowPhase)
    }

    expect(phases).toEqual(['plan', 'execute'])
    expect(executed).toEqual(['shell-runner'])
  })

  test('does not let AI promote an explicitly selected session plan mode', async () => {
    let invocation = 0
    const gateway: ModelGatewayPort = {
      async *streamChat(): AsyncIterable<ModelStreamChunk> {
        invocation += 1
        if (invocation === 1) {
          yield { delta: '', toolCall: { toolCallId: 'p1', toolName: 'workflow-phase', input: '{"phase":"execute","rationale":"start implementation"}' }, usedNativeTools: true }
          return
        }
        if (invocation === 2) {
          yield { delta: '', toolCall: { toolCallId: 'blocked', toolName: 'shell-runner', input: '{"argv":["npm","run","typecheck"]}' }, usedNativeTools: true }
          return
        }
        yield { delta: 'Execution remains disabled.', finishReason: 'stop', usedNativeTools: true }
      },
    }
    const executed: string[] = []
    const toolExecutor: ToolExecutorPort = {
      async execute(request) {
        executed.push(request.toolId)
        return { toolId: request.toolId, ok: true, content: 'unexpected' }
      },
    }
    const session = createSession('explicit-plan')
    session.switchMode('plan', new Date('2026-01-01T00:00:01.000Z'))
    const transcripts: string[] = []

    for await (const chunk of createResponder(gateway, toolExecutor).streamReply({
      prompt: 'plan only',
      session,
      workspace: createWorkspace(),
      toolCatalog: CATALOG,
    })) {
      if (chunk.transcript) transcripts.push(chunk.transcript)
    }

    expect(executed).toEqual([])
    expect(transcripts.join('\n')).toContain('cannot promote it to execution')
  })
})
