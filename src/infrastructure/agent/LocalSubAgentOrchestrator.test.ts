import { describe, expect, test } from 'bun:test'
import type { ModelGatewayPort, ModelRequest, ModelStreamChunk } from '../../application/ports/ModelGatewayPort'
import type { ToolExecutorPort } from '../../application/ports/ToolExecutorPort'
import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'
import { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'
import { LocalSubAgentOrchestrator } from './LocalSubAgentOrchestrator'

const config: ModelConfig = {
  provider: 'openai-compatible',
  apiKey: 'test',
  baseUrl: 'https://example.test/v1',
  model: 'test-model',
  maxTokens: 4096,
  temperature: 0.7,
  timeoutMs: 60_000,
}

const workspace = new WorkspaceContext({
  rootPath: '/workspace',
  isGitRepository: true,
  packageManager: 'bun',
  topLevelEntries: ['src'],
})

function createOptions(toolExecutor?: ToolExecutorPort) {
  let id = 0
  return {
    idGenerator: { next: () => `task-${++id}` },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    toolExecutor,
  }
}

function sequenceGateway(
  responses: Array<(request: ModelRequest) => AsyncIterable<ModelStreamChunk>>,
  seen: ModelRequest[],
): ModelGatewayPort {
  let index = 0
  return {
    streamChat(request) {
      seen.push(request)
      const response = responses[index++]
      if (!response) throw new Error('No mock response configured')
      return response(request)
    },
  }
}

async function* nativeTool(toolName: string, input: string): AsyncIterable<ModelStreamChunk> {
  yield { delta: '', toolCall: { toolCallId: 'call-1', toolName, input }, usedNativeTools: true }
}

async function* text(content: string): AsyncIterable<ModelStreamChunk> {
  yield { delta: content }
}

describe('LocalSubAgentOrchestrator', () => {
  test('lets an isolated worker search the workspace and then return evidence', async () => {
    const seen: ModelRequest[] = []
    const executed: string[] = []
    const executor: ToolExecutorPort = {
      execute: async (request) => {
        executed.push(request.toolId)
        return { toolId: request.toolId, ok: true, content: 'src/main.ts:10 createRuntime' }
      },
    }
    const gateway = sequenceGateway([
      () => nativeTool('search-index', '{"query":"createRuntime"}'),
      () => text('Conclusion: runtime is created in src/main.ts:10.'),
    ], seen)
    const orchestrator = new LocalSubAgentOrchestrator(gateway, config, createOptions(executor))
    const tasks = orchestrator.createTasks([
      { title: 'Trace runtime', instruction: 'Find runtime creation.', role: 'explore' },
    ])

    await orchestrator.runBatch(tasks, { maxConcurrency: 1, workspace })

    expect(tasks[0]?.status).toBe('completed')
    expect(tasks[0]?.result).toContain('src/main.ts:10')
    expect(executed).toEqual(['search-index'])
    expect(seen[0]?.tools?.map((tool) => tool.name)).toEqual([
      'workspace-read', 'search-index', 'glob-search', 'file-ops',
    ])
    expect(seen[1]?.messages.at(-1)?.content).toContain('src/main.ts:10 createRuntime')
  })

  test('blocks file mutation requests before they reach the shared executor', async () => {
    const seen: ModelRequest[] = []
    let executionCount = 0
    const executor: ToolExecutorPort = {
      execute: async (request) => {
        executionCount += 1
        return { toolId: request.toolId, ok: true, content: 'unexpected' }
      },
    }
    const gateway = sequenceGateway([
      () => nativeTool('file-ops', '{"action":"write","path":"src/x.ts","content":"x"}'),
      () => text('Conclusion: write access is unavailable.'),
    ], seen)
    const orchestrator = new LocalSubAgentOrchestrator(gateway, config, createOptions(executor))
    const tasks = orchestrator.createTasks([{ title: 'Unsafe', instruction: 'Try a write.' }])

    await orchestrator.runBatch(tasks, { maxConcurrency: 1, workspace })

    expect(executionCount).toBe(0)
    expect(seen[1]?.messages.at(-1)?.content).toContain('read or list')
    expect(tasks[0]?.status).toBe('completed')
  })

  test('schedules high-priority work before low-priority work', async () => {
    const starts: string[] = []
    const gateway: ModelGatewayPort = {
      async *streamChat(request) {
        yield { delta: `done: ${request.messages.at(-1)?.content}` }
      },
    }
    const orchestrator = new LocalSubAgentOrchestrator(gateway, config, createOptions())
    const tasks = orchestrator.createTasks([
      { title: 'Low', instruction: 'low', priority: 'low' },
      { title: 'High', instruction: 'high', priority: 'high' },
    ])

    await orchestrator.runBatch(tasks, {
      maxConcurrency: 1,
      workspace,
      onTaskStart: (_id, title) => starts.push(title),
    })

    expect(starts).toEqual(['High', 'Low'])
  })

  test('cancels pending work without calling the model when already aborted', async () => {
    let calls = 0
    const gateway: ModelGatewayPort = {
      async *streamChat() {
        calls += 1
        yield { delta: 'unexpected' }
      },
    }
    const controller = new AbortController()
    controller.abort()
    const orchestrator = new LocalSubAgentOrchestrator(gateway, config, createOptions())
    const tasks = orchestrator.createTasks([{ title: 'Cancelled', instruction: 'stop' }])

    await orchestrator.runBatch(tasks, {
      maxConcurrency: 1,
      workspace,
      abortSignal: controller.signal,
    })

    expect(calls).toBe(0)
    expect(tasks[0]?.status).toBe('cancelled')
  })
})
