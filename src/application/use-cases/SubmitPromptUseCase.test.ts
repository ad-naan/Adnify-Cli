import { describe, expect, test } from 'bun:test'
import { AssistantProfile } from '../../domain/assistant/entities/AssistantProfile'
import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'
import { ConversationSession } from '../../domain/session/aggregates/ConversationSession'
import { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'
import type { AssistantPromptSet } from '../dto/AssistantPromptSet'
import { createAppI18n } from '../i18n/AppI18n'
import type {
  PendingToolApproval,
  AssistantReply,
  AssistantResponderPort,
  AssistantStreamChunk,
} from '../ports/AssistantResponderPort'
import type { CliConfigPort } from '../ports/CliConfigPort'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { LoggerPort } from '../ports/LoggerPort'
import type { SessionRepositoryPort } from '../ports/SessionRepositoryPort'
import type { WorkspaceContextPort } from '../ports/WorkspaceContextPort'
import { SubmitPromptUseCase } from './SubmitPromptUseCase'

function createMockLogger(): LoggerPort {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

function createMockClock(time: Date): ClockPort {
  return { now: () => time }
}

let idCounter = 0
function createMockIdGenerator(): IdGeneratorPort {
  idCounter = 0
  return { next: () => `id-${++idCounter}` }
}

function createMockWorkspace(): WorkspaceContextPort {
  return {
    inspect: async () =>
      new WorkspaceContext({
        rootPath: '/test/workspace',
        isGitRepository: true,
        packageManager: 'bun',
        topLevelEntries: ['src', 'package.json'],
      }),
  }
}

function createMockConfig(): CliConfigPort {
  const promptSet: AssistantPromptSet = {
    core: 'core prompt',
    modes: {
      chat: 'chat prompt',
      agent: 'agent prompt',
      plan: 'plan prompt',
    },
  }

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
        apiKey: '',
        baseUrl: 'http://localhost',
        model: 'test',
        maxTokens: 100,
        temperature: 0,
        timeoutMs: 5000,
      }) satisfies ModelConfig,
    getProviders: () => ({}),
    switchModel: () => null,
    getToolCatalog: () => [],
    getLocalCommands: () => [],
    getStorage: () => ({
      dataRoot: '/tmp/adnify',
      configPath: '/tmp/adnify/config.json',
      sessionsDir: '/tmp/adnify/sessions',
      source: 'default',
      isCustom: false,
    }),
  }
}

function createMockResponder(reply: string): AssistantResponderPort {
  return {
    generateReply: async (): Promise<AssistantReply> => ({ content: reply }),
    async *streamReply(): AsyncIterable<AssistantStreamChunk> {
      yield { kind: 'text', delta: reply, done: false }
      yield { kind: 'text', delta: '', done: true }
    },
    async *streamApprovalDecision(): AsyncIterable<AssistantStreamChunk> {
      yield { kind: 'text', delta: '', done: true }
    },
  }
}

function createMockSessionRepo(): SessionRepositoryPort & { sessions: Map<string, ConversationSession> } {
  const sessions = new Map<string, ConversationSession>()
  return {
    sessions,
    save: async (session) => {
      sessions.set(session.id, session.clone())
    },
    findById: async (id) => sessions.get(id)?.clone() ?? null,
    listByWorkspace: async (workspacePath, limit = 20) =>
      [...sessions.values()]
        .filter((session) => session.workspacePath === workspacePath)
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .slice(0, limit)
        .map((session) => session.clone()),
  }
}

describe('SubmitPromptUseCase', () => {
  test('execute should append user and assistant messages', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-1',
      title: 'test',
      mode: 'agent',
      workspacePath: '/test/workspace',
      createdAt: new Date('2026-01-01'),
    })
    await repo.save(session)

    const useCase = new SubmitPromptUseCase(
      repo,
      createMockWorkspace(),
      createMockResponder('reply content'),
      createMockConfig(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:01:00Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({ sessionId: 'sess-1', prompt: 'hello' })

    expect(result.session.getMessages()).toHaveLength(2)
    expect(result.session.getMessages()[0]?.role).toBe('user')
    expect(result.session.getMessages()[0]?.content).toBe('hello')
    expect(result.session.getMessages()[1]?.role).toBe('assistant')
    expect(result.session.getMessages()[1]?.content).toBe('reply content')
  })

  test('execute should ignore empty prompt', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-2',
      title: 'test',
      mode: 'chat',
      workspacePath: '/test',
      createdAt: new Date('2026-01-01'),
    })
    await repo.save(session)

    const useCase = new SubmitPromptUseCase(
      repo,
      createMockWorkspace(),
      createMockResponder('unused'),
      createMockConfig(),
      createMockIdGenerator(),
      createMockClock(new Date()),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({ sessionId: 'sess-2', prompt: '   ' })

    expect(result.statusLine).toBe('Empty input ignored.')
    expect(result.session.getMessages()).toHaveLength(0)
  })

  test('execute should throw for missing session', async () => {
    const repo = createMockSessionRepo()

    const useCase = new SubmitPromptUseCase(
      repo,
      createMockWorkspace(),
      createMockResponder('x'),
      createMockConfig(),
      createMockIdGenerator(),
      createMockClock(new Date()),
      createMockLogger(),
      createAppI18n('en'),
    )

    expect(useCase.execute({ sessionId: 'not-exist', prompt: 'hello' })).rejects.toThrow(
      'Session not found',
    )
  })

  test('executeStreaming should call onChunk and onDone', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-3',
      title: 'test',
      mode: 'agent',
      workspacePath: '/test',
      createdAt: new Date('2026-01-01'),
    })
    await repo.save(session)

    const useCase = new SubmitPromptUseCase(
      repo,
      createMockWorkspace(),
      createMockResponder('stream reply'),
      createMockConfig(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:01:00Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const chunks: string[] = []
    let doneContent = ''

    const result = await useCase.executeStreaming(
      { sessionId: 'sess-3', prompt: 'test stream' },
      {
        onChunk: (delta) => chunks.push(delta),
        onDone: (full) => {
          doneContent = full
        },
        onError: () => {},
      },
    )

    expect(chunks).toEqual(['stream reply'])
    expect(doneContent).toBe('stream reply')
    expect(result.session.getMessages()).toHaveLength(2)
    expect(result.session.getMessages()[1]?.content).toBe('stream reply')
  })

  test('executeStreaming should publish the user message before workspace or API work', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-optimistic',
      title: 'test',
      mode: 'agent',
      workspacePath: '/test',
      createdAt: new Date('2026-01-01'),
    })
    await repo.save(session)

    const accepted: string[] = []
    const useCase = new SubmitPromptUseCase(
      repo,
      { inspect: async () => { throw new Error('workspace unavailable') } },
      createMockResponder('unused'),
      createMockConfig(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:01:00Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    await expect(useCase.executeStreaming(
      { sessionId: session.id, prompt: 'render me now' },
      {
        onUserMessage: (acceptedSession) => {
          accepted.push(acceptedSession.getMessages()[0]?.content ?? '')
        },
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      },
    )).rejects.toThrow('workspace unavailable')

    expect(accepted).toEqual(['render me now'])
  })

  test('executeStreaming should handle errors gracefully', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-4',
      title: 'test',
      mode: 'agent',
      workspacePath: '/test',
      createdAt: new Date('2026-01-01'),
    })
    await repo.save(session)

    const errorResponder: AssistantResponderPort = {
      generateReply: async () => ({ content: '' }),
      async *streamReply() {
        yield { kind: 'text', delta: 'partial', done: false }
        throw new Error('network interrupted')
      },
      async *streamApprovalDecision() {
        yield { kind: 'text', delta: '', done: true }
      },
    }

    const useCase = new SubmitPromptUseCase(
      repo,
      createMockWorkspace(),
      errorResponder,
      createMockConfig(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:01:00Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    let errorMsg = ''

    const result = await useCase.executeStreaming(
      { sessionId: 'sess-4', prompt: 'failing request' },
      {
        onChunk: () => {},
        onDone: () => {},
        onError: (err) => {
          errorMsg = err.message
        },
      },
    )

    expect(errorMsg).toBe('network interrupted')
    expect(result.statusLine).toContain('network interrupted')
    const messages = result.session.getMessages()
    const lastMsg = messages[messages.length - 1]
    expect(lastMsg?.content).toContain('partial')
    expect(lastMsg?.content).toContain('[Response interrupted]')
  })

  test('executeStreaming should stop cleanly when aborted', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-5',
      title: 'test',
      mode: 'agent',
      workspacePath: '/test',
      createdAt: new Date('2026-01-01'),
    })
    await repo.save(session)

    const abortAwareResponder: AssistantResponderPort = {
      generateReply: async () => ({ content: '' }),
      async *streamReply(command) {
        yield { kind: 'text', delta: 'partial ', done: false }
        await new Promise((resolve) => setTimeout(resolve, 10))
        if (command.abortSignal?.aborted) {
          throw new Error('Request aborted')
        }
        yield { kind: 'text', delta: 'tail', done: true }
      },
      async *streamApprovalDecision() {
        yield { kind: 'text', delta: '', done: true }
      },
    }

    const useCase = new SubmitPromptUseCase(
      repo,
      createMockWorkspace(),
      abortAwareResponder,
      createMockConfig(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:01:00Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const controller = new AbortController()
    let firstChunk = true

    const result = await useCase.executeStreaming(
      { sessionId: 'sess-5', prompt: 'abort me', abortSignal: controller.signal },
      {
        onChunk: () => {
          if (firstChunk) {
            firstChunk = false
            controller.abort(new Error('user-abort'))
          }
        },
        onDone: () => {},
        onError: () => {},
      },
    )

    expect(result.statusLine).toBe('Current execution aborted.')
    const messages = result.session.getMessages()
    expect(messages[messages.length - 1]?.content).toContain('partial')
  })

  test('executeStreaming should persist transcript chunks as system messages', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-6',
      title: 'test',
      mode: 'agent',
      workspacePath: '/test',
      createdAt: new Date('2026-01-01'),
    })
    await repo.save(session)

    const transcriptResponder: AssistantResponderPort = {
      generateReply: async () => ({ content: '' }),
      async *streamReply() {
        yield {
          kind: 'transcript',
          delta: '',
          transcript: '<adnify-notice title="tools" tone="info">running tool</adnify-notice>',
          done: false,
        }
        yield { kind: 'text', delta: 'done', done: false }
        yield { kind: 'text', delta: '', done: true }
      },
      async *streamApprovalDecision() {
        yield { kind: 'text', delta: '', done: true }
      },
    }

    const useCase = new SubmitPromptUseCase(
      repo,
      createMockWorkspace(),
      transcriptResponder,
      createMockConfig(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:01:00Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const transcripts: string[] = []
    const result = await useCase.executeStreaming(
      { sessionId: 'sess-6', prompt: 'run tool' },
      {
        onChunk: () => {},
        onTranscript: (content) => {
          transcripts.push(content)
        },
        onDone: () => {},
        onError: () => {},
      },
    )

    expect(transcripts).toHaveLength(1)
    const messages = result.session.getMessages()
    expect(messages).toHaveLength(3)
    expect(messages[1]?.role).toBe('system')
    expect(messages[1]?.content).toContain('running tool')
    expect(messages[2]?.content).toBe('done')
  })

  test('executeStreaming should preserve assistant text around tool transcripts', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-ordered',
      title: 'test',
      mode: 'agent',
      workspacePath: '/test',
      createdAt: new Date('2026-01-01'),
    })
    await repo.save(session)

    const orderedResponder: AssistantResponderPort = {
      generateReply: async () => ({ content: '' }),
      async *streamReply() {
        yield { kind: 'text', delta: 'I will inspect this first.', done: false }
        yield {
          kind: 'transcript',
          delta: '',
          transcript: '<adnify-notice title="tools" tone="info">reading</adnify-notice>',
          done: false,
        }
        yield { kind: 'text', delta: 'The inspection is complete.', done: false }
      },
      async *streamApprovalDecision() {
        yield { kind: 'text', delta: '', done: true }
      },
    }

    const useCase = new SubmitPromptUseCase(
      repo,
      createMockWorkspace(),
      orderedResponder,
      createMockConfig(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:01:00Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const segments: string[] = []
    const result = await useCase.executeStreaming(
      { sessionId: session.id, prompt: 'inspect' },
      {
        onChunk: () => {},
        onAssistantSegment: (content) => segments.push(content),
        onDone: () => {},
        onError: () => {},
      },
    )

    expect(result.session.getMessages().map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'system',
      'assistant',
    ])
    expect(segments).toEqual(['I will inspect this first.', 'The inspection is complete.'])
  })

  test('executeStreaming should pause on pending approval without appending assistant text', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-7',
      title: 'test',
      mode: 'agent',
      workspacePath: '/test',
      createdAt: new Date('2026-01-01'),
    })
    await repo.save(session)

    const approval: PendingToolApproval = {
      id: 'approval-1',
      toolId: 'shell-runner',
      toolName: 'Shell Runner',
      input: '{"argv":["git","status"]}',
      reason: 'Approval required.',
    }

    const approvalResponder: AssistantResponderPort = {
      generateReply: async () => ({ content: '' }),
      async *streamReply() {
        yield {
          kind: 'transcript',
          delta: '',
          transcript: '<adnify-command-output title="tools · shell-runner" tone="warning">Approval required.</adnify-command-output>',
          done: false,
        }
        yield {
          kind: 'approval',
          delta: '',
          approval,
          done: true,
        }
      },
      async *streamApprovalDecision() {
        yield { kind: 'text', delta: '', done: true }
      },
    }

    const useCase = new SubmitPromptUseCase(
      repo,
      createMockWorkspace(),
      approvalResponder,
      createMockConfig(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:01:00Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    let capturedApproval: PendingToolApproval | null = null
    const result = await useCase.executeStreaming(
      { sessionId: 'sess-7', prompt: 'inspect repo' },
      {
        onChunk: () => {},
        onTranscript: () => {},
        onApproval: (nextApproval) => {
          capturedApproval = nextApproval
        },
        onDone: () => {},
        onError: () => {},
      },
    )

    const approvalFromCallback = capturedApproval ?? result.pendingApproval ?? null
    if (!approvalFromCallback) {
      throw new Error('Expected approval callback to be invoked.')
    }

    expect(result.statusLine).toBe('Approval required before running the requested tool.')
    expect(result.pendingApproval?.toolId).toBe('shell-runner')
    expect(approvalFromCallback.toolName).toBe('Shell Runner')
    expect(result.session.getMessages()).toHaveLength(2)
    expect(result.session.getMessages()[1]?.role).toBe('system')
  })

  test('executeApprovalDecision should append the resumed assistant reply', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-8',
      title: 'test',
      mode: 'agent',
      workspacePath: '/test',
      createdAt: new Date('2026-01-01'),
    })
    session.addUserMessage('msg-1', new Date('2026-01-01T00:00:30Z'), 'inspect repo')
    await repo.save(session)

    const resumedResponder: AssistantResponderPort = {
      generateReply: async () => ({ content: '' }),
      async *streamReply() {
        yield { kind: 'text', delta: '', done: true }
      },
      async *streamApprovalDecision() {
        yield {
          kind: 'transcript',
          delta: '',
          transcript: '<adnify-command-output title="tools · shell-runner" tone="success">Tool completed successfully.</adnify-command-output>',
          done: false,
        }
        yield { kind: 'text', delta: 'All set after approval.', done: false }
        yield { kind: 'text', delta: '', done: true }
      },
    }

    const useCase = new SubmitPromptUseCase(
      repo,
      createMockWorkspace(),
      resumedResponder,
      createMockConfig(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:01:00Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.executeApprovalDecision(
      { sessionId: 'sess-8', approved: true },
      {
        onChunk: () => {},
        onTranscript: () => {},
        onApproval: () => {},
        onDone: () => {},
        onError: () => {},
      },
    )

    expect(result.statusLine).toBe('Completed one response.')
    expect(result.session.getMessages()).toHaveLength(3)
    expect(result.session.getMessages()[1]?.role).toBe('system')
    expect(result.session.getMessages()[2]?.content).toBe('All set after approval.')
  })
})
