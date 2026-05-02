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
import type { ToolExecutorPort } from '../../application/ports/ToolExecutorPort'
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
    const request = capturedRequest as ModelRequest
    expect(request.messages[0]?.role).toBe('system')
    expect(request.messages[0]?.content).toContain('core system')
    expect(request.messages[0]?.content).toContain('agent instructions')
    expect(request.messages[0]?.content).toContain('当前模式：agent')
    expect(request.messages[0]?.content).toContain('Shell Runner [terminal] (dangerous)')
    expect(request.messages[0]?.content).toContain('adnify_tool_call')
    expect(request.messages[0]?.content).toContain('may be paused for approval')
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

  test('should pause dangerous tools until approval flow is implemented', async () => {
    let executed = false

    const gateway: ModelGatewayPort = {
      async *streamChat(): AsyncIterable<ModelStreamChunk> {
        yield {
          delta: '<adnify_tool_call name="shell-runner">{"argv":["git","status"]}</adnify_tool_call>',
          finishReason: 'stop',
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
      {
        execute: async () => {
          executed = true
          return { toolId: 'shell-runner', ok: true, content: 'should not run' }
        },
      },
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

    expect(executed).toBe(false)
    expect(transcripts).toHaveLength(2)
    expect(transcripts[1]).toContain('paused until an approval flow is implemented')
    expect(chunks.join('')).toContain('approval is required')
  })

  test('should pause file writes until approval flow is implemented', async () => {
    let executed = false

    const gateway: ModelGatewayPort = {
      async *streamChat(): AsyncIterable<ModelStreamChunk> {
        yield {
          delta:
            '<adnify_tool_call name="file-ops">{"action":"write","path":"src/example.ts","content":"export const a = 1","allowWrite":true}</adnify_tool_call>',
          finishReason: 'stop',
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
      {
        execute: async () => {
          executed = true
          return { toolId: 'file-ops', ok: true, content: 'should not run' }
        },
      },
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

    const chunks: string[] = []
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
      chunks.push(chunk.delta)
    }

    expect(executed).toBe(false)
    expect(transcripts).toHaveLength(2)
    expect(transcripts[1]).toContain('file-ops action "write"')
    expect(chunks.join('')).toContain('approval is required')
  })
})
