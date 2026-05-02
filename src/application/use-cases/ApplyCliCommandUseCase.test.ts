import { describe, expect, test } from 'bun:test'
import { AssistantProfile } from '../../domain/assistant/entities/AssistantProfile'
import type { ModelConfig, ProvidersMap } from '../../domain/assistant/value-objects/ModelConfig'
import { ConversationSession } from '../../domain/session/aggregates/ConversationSession'
import { ToolDescriptor } from '../../domain/tooling/entities/ToolDescriptor'
import { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'
import { createAppI18n } from '../i18n/AppI18n'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { LoggerPort } from '../ports/LoggerPort'
import type { ModelConfigStorePort } from '../ports/ModelConfigStorePort'
import type { SessionRepositoryPort } from '../ports/SessionRepositoryPort'
import type { StorageSettingsPort } from '../ports/StorageSettingsPort'
import { parseCliTranscriptMarkup } from '../support/CliTranscriptMarkup'
import { ApplyCliCommandUseCase } from './ApplyCliCommandUseCase'
import type { AppStorageSnapshot } from '../dto/AppStorageSnapshot'
import type { BootstrapSnapshot } from '../dto/BootstrapSnapshot'

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

function createMockStorageSettings(): StorageSettingsPort {
  let configuredDataRoot: string | null = 'E:/AdnifyData'
  let effectiveStorage: AppStorageSnapshot = {
    dataRoot: 'E:/AdnifyData',
    configPath: 'E:/AdnifyData/config.json',
    sessionsDir: 'E:/AdnifyData/sessions',
    source: 'settings' as const,
    isCustom: true,
  }

  return {
    inspect: async () => ({
      effectiveStorage,
      settingsPath: 'E:/Users/adnaan/AppData/Roaming/Adnify-Cli/settings.json',
      configuredDataRoot,
    }),
    setDataDirectory: async (path) => {
      configuredDataRoot = path
      effectiveStorage = {
        dataRoot: path,
        configPath: `${path}/config.json`,
        sessionsDir: `${path}/sessions`,
        source: 'settings',
        isCustom: true,
      }

      return {
        effectiveStorage,
        settingsPath: 'E:/Users/adnaan/AppData/Roaming/Adnify-Cli/settings.json',
        configuredDataRoot,
        migratedConfig: true,
        migratedSessions: true,
        requiresRestart: true,
      }
    },
    resetDataDirectory: async () => {
      configuredDataRoot = null
      effectiveStorage = {
        dataRoot: 'C:/Users/adnaan/AppData/Local/Adnify-Cli',
        configPath: 'C:/Users/adnaan/AppData/Local/Adnify-Cli/config.json',
        sessionsDir: 'C:/Users/adnaan/AppData/Local/Adnify-Cli/sessions',
        source: 'default',
        isCustom: false,
      }

      return {
        effectiveStorage,
        settingsPath: 'E:/Users/adnaan/AppData/Roaming/Adnify-Cli/settings.json',
        configuredDataRoot,
        migratedConfig: false,
        migratedSessions: false,
        requiresRestart: true,
      }
    },
  }
}

function createMockModelConfigStore(): ModelConfigStorePort & { saved: ModelConfig[] } {
  const saved: ModelConfig[] = []

  return {
    saved,
    save: async (config) => {
      saved.push({ ...config })
    },
  }
}

function createBootstrapSnapshot(): BootstrapSnapshot {
  return {
    profile: new AssistantProfile({
      id: 'adnify',
      name: 'Adnify-Cli',
      author: 'adnaan',
      tagline: 'test',
      description: 'test',
      defaultMode: 'agent',
    }),
    workspace: new WorkspaceContext({
      rootPath: 'E:/26Project/Adnify-Cli',
      isGitRepository: true,
      packageManager: 'bun',
      topLevelEntries: ['src', 'package.json'],
    }),
    modelConfig: {
      provider: 'openai-compatible',
      apiKey: 'sk-test-1234567890',
      baseUrl: 'https://example.com',
      model: 'gpt-5.4',
      maxTokens: 8192,
      temperature: 0.2,
      timeoutMs: 30_000,
    } satisfies ModelConfig,
    providers: {
      openai: {
        provider: 'openai-compatible',
        apiKey: 'sk-openai',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-5', 'gpt-5.4'],
      },
    } satisfies ProvidersMap,
    supportedModes: ['chat', 'agent', 'plan'],
    storage: {
      dataRoot: 'E:/AdnifyData',
      configPath: 'E:/AdnifyData/config.json',
      sessionsDir: 'E:/AdnifyData/sessions',
      source: 'env' as const,
      isCustom: true,
    },
    toolCatalog: [
      new ToolDescriptor({
        id: 'shell-runner',
        name: 'Shell Runner',
        description: 'run shell commands',
        category: 'execution',
        riskLevel: 'careful',
      }),
    ],
    localCommands: [
      ':help',
      ':mode chat',
      ':workspace',
      ':tools',
      ':doctor',
      ':diff',
      ':review',
      ':model',
      ':config',
      ':session',
      ':config set provider [value]',
      ':config set model [value]',
      ':config set api-key [value]',
      ':config set base-url [value]',
      ':config clear api-key',
      ':storage',
      ':storage set [path]',
      ':storage reset',
      ':sessions',
      ':resume [index|id]',
      ':clear',
    ],
  }
}

describe('ApplyCliCommandUseCase', () => {
  test('should append structured command input and output for help', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-help',
      title: 'test',
      mode: 'agent',
      workspacePath: 'E:/26Project/Adnify-Cli',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await repo.save(session)

    const useCase = new ApplyCliCommandUseCase(
      repo,
      createMockStorageSettings(),
      createMockModelConfigStore(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:01:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({
      sessionId: session.id,
      commandLine: ':help',
      bootstrap: createBootstrapSnapshot(),
    })

    const messages = result.session.getMessages()
    expect(messages).toHaveLength(2)
    expect(parseCliTranscriptMarkup(messages[0]?.content ?? '')).toEqual({
      kind: 'command-input',
      content: '/help',
    })

    const output = parseCliTranscriptMarkup(messages[1]?.content ?? '')
    expect(output?.kind).toBe('command-output')
    expect(output?.content).toContain(':resume [index|id]')
  })

  test('should clear existing conversation before appending clear transcript', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-clear',
      title: 'test',
      mode: 'agent',
      workspacePath: 'E:/26Project/Adnify-Cli',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    session.addUserMessage('existing-user', new Date('2026-01-01T00:00:10.000Z'), 'legacy prompt')
    session.addAssistantMessage(
      'existing-assistant',
      new Date('2026-01-01T00:00:20.000Z'),
      'legacy reply',
    )
    await repo.save(session)

    const useCase = new ApplyCliCommandUseCase(
      repo,
      createMockStorageSettings(),
      createMockModelConfigStore(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:02:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({
      sessionId: session.id,
      commandLine: ':clear',
      bootstrap: createBootstrapSnapshot(),
    })

    const messages = result.session.getMessages()
    expect(messages).toHaveLength(2)
    expect(parseCliTranscriptMarkup(messages[0]?.content ?? '')).toEqual({
      kind: 'command-input',
      content: '/clear',
    })
  })

  test('should list recent sessions for the current workspace', async () => {
    const repo = createMockSessionRepo()
    const workspacePath = 'E:/26Project/Adnify-Cli'

    const older = ConversationSession.create({
      id: 'sess-older',
      title: 'Fix auth flow',
      mode: 'agent',
      workspacePath,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    older.addUserMessage('msg-1', new Date('2026-01-01T00:01:00.000Z'), 'older prompt')

    const current = ConversationSession.create({
      id: 'sess-current',
      title: 'Review CLI layout',
      mode: 'plan',
      workspacePath,
      createdAt: new Date('2026-01-01T00:10:00.000Z'),
    })
    current.addUserMessage('msg-2', new Date('2026-01-01T00:11:00.000Z'), 'current prompt')

    await repo.save(older)
    await repo.save(current)

    const useCase = new ApplyCliCommandUseCase(
      repo,
      createMockStorageSettings(),
      createMockModelConfigStore(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:12:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({
      sessionId: current.id,
      commandLine: ':sessions',
      bootstrap: createBootstrapSnapshot(),
    })

    const output = parseCliTranscriptMarkup(result.session.getMessages()[2]?.content ?? '')
    expect(output?.kind).toBe('command-output')
    expect(output?.content).toContain('Recent sessions:')
    expect(output?.content).toContain('[sess-cur]')
    expect(output?.content).toContain('Review CLI layout')
  })

  test('should resume a session by numeric index', async () => {
    const repo = createMockSessionRepo()
    const workspacePath = 'E:/26Project/Adnify-Cli'

    const current = ConversationSession.create({
      id: 'sess-current',
      title: 'Current session',
      mode: 'agent',
      workspacePath,
      createdAt: new Date('2026-01-01T00:10:00.000Z'),
    })
    current.addUserMessage('msg-1', new Date('2026-01-01T00:11:00.000Z'), 'current prompt')

    const previous = ConversationSession.create({
      id: 'sess-restore',
      title: 'Restore me',
      mode: 'chat',
      workspacePath,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    previous.addAssistantMessage('msg-2', new Date('2026-01-01T00:05:00.000Z'), 'saved reply')

    await repo.save(current)
    await repo.save(previous)

    const useCase = new ApplyCliCommandUseCase(
      repo,
      createMockStorageSettings(),
      createMockModelConfigStore(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:12:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({
      sessionId: current.id,
      commandLine: ':resume 2',
      bootstrap: createBootstrapSnapshot(),
    })

    expect(result.session.id).toBe('sess-restore')
    expect(result.statusLine).toContain('Resumed session')
  })

  test('should save a custom storage directory', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-storage',
      title: 'Storage',
      mode: 'agent',
      workspacePath: 'E:/26Project/Adnify-Cli',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await repo.save(session)

    const useCase = new ApplyCliCommandUseCase(
      repo,
      createMockStorageSettings(),
      createMockModelConfigStore(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:03:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({
      sessionId: session.id,
      commandLine: ':storage set D:/AdnifyData',
      bootstrap: createBootstrapSnapshot(),
    })

    const output = parseCliTranscriptMarkup(result.session.getMessages()[1]?.content ?? '')
    expect(output?.kind).toBe('command-output')
    expect(output?.content).toContain('Saved a new storage directory')
    expect(output?.content).toContain('D:/AdnifyData')
    expect(result.statusLine).toContain('storage directory')
  })

  test('should display current session details', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-meta',
      title: 'Current session title',
      mode: 'plan',
      workspacePath: 'E:/26Project/Adnify-Cli',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    session.addUserMessage('msg-1', new Date('2026-01-01T00:01:00.000Z'), 'hello')
    await repo.save(session)

    const useCase = new ApplyCliCommandUseCase(
      repo,
      createMockStorageSettings(),
      createMockModelConfigStore(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:04:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({
      sessionId: session.id,
      commandLine: ':session',
      bootstrap: createBootstrapSnapshot(),
    })

    const output = parseCliTranscriptMarkup(result.session.getMessages()[2]?.content ?? '')
    expect(output?.kind).toBe('command-output')
    expect(output?.content).toContain('Current session:')
    expect(output?.content).toContain('Current session title')
    expect(output?.content).toContain('sess-meta')
  })

  test('should review the current git diff', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-review',
      title: 'Review',
      mode: 'agent',
      workspacePath: 'E:/26Project/Adnify-Cli',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await repo.save(session)

    const useCase = new ApplyCliCommandUseCase(
      repo,
      createMockStorageSettings(),
      createMockModelConfigStore(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:05:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({
      sessionId: session.id,
      commandLine: ':review',
      bootstrap: createBootstrapSnapshot(),
      gitRunner: {
        diffCheck: async () => 'src/main.ts:12: trailing whitespace.',
        diffStat: async () => ' src/main.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)',
        diffPatch: async () => '',
      },
    })

    const output = parseCliTranscriptMarkup(result.session.getMessages()[1]?.content ?? '')
    expect(output?.kind).toBe('command-output')
    expect(output?.content).toContain('Findings:')
    expect(output?.content).toContain('trailing whitespace')
    expect(output?.content).toContain('Changed files:')
    expect(result.statusLine).toContain('Reviewed the current diff')
  })

  test('should show a compact runtime diagnostic summary', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-doctor',
      title: 'Doctor',
      mode: 'agent',
      workspacePath: 'E:/26Project/Adnify-Cli',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await repo.save(session)

    const useCase = new ApplyCliCommandUseCase(
      repo,
      createMockStorageSettings(),
      createMockModelConfigStore(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:05:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({
      sessionId: session.id,
      commandLine: ':doctor',
      bootstrap: createBootstrapSnapshot(),
    })

    const output = parseCliTranscriptMarkup(result.session.getMessages()[1]?.content ?? '')
    expect(output?.kind).toBe('command-output')
    expect(output?.content).toContain('Runtime diagnostics:')
    expect(output?.content).toContain('E:/26Project/Adnify-Cli')
    expect(output?.content).toContain('gpt-5.4')
    expect(output?.content).toContain('Runtime looks ready.')
    expect(result.statusLine).toContain('Displayed runtime diagnostics')
  })

  test('should show the current git diff patch', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-diff',
      title: 'Diff',
      mode: 'agent',
      workspacePath: 'E:/26Project/Adnify-Cli',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await repo.save(session)

    const useCase = new ApplyCliCommandUseCase(
      repo,
      createMockStorageSettings(),
      createMockModelConfigStore(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:05:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({
      sessionId: session.id,
      commandLine: ':diff',
      bootstrap: createBootstrapSnapshot(),
      gitRunner: {
        diffCheck: async () => '',
        diffStat: async () => '',
        diffPatch: async () =>
          'diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-console.log("old")\n+console.log("new")',
      },
    })

    const output = parseCliTranscriptMarkup(result.session.getMessages()[1]?.content ?? '')
    expect(output?.kind).toBe('command-output')
    expect(output?.content).toContain('Current diff:')
    expect(output?.content).toContain('diff --git a/src/main.ts b/src/main.ts')
    expect(output?.content).toContain('+console.log("new")')
    expect(result.statusLine).toContain('Displayed the current diff')
  })

  test('should show a friendly message when there is no current git diff', async () => {
    const repo = createMockSessionRepo()
    const session = ConversationSession.create({
      id: 'sess-diff-empty',
      title: 'Diff empty',
      mode: 'agent',
      workspacePath: 'E:/26Project/Adnify-Cli',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await repo.save(session)

    const useCase = new ApplyCliCommandUseCase(
      repo,
      createMockStorageSettings(),
      createMockModelConfigStore(),
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:05:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({
      sessionId: session.id,
      commandLine: ':diff',
      bootstrap: createBootstrapSnapshot(),
      gitRunner: {
        diffCheck: async () => '',
        diffStat: async () => '',
        diffPatch: async () => '',
      },
    })

    const output = parseCliTranscriptMarkup(result.session.getMessages()[1]?.content ?? '')
    expect(output?.kind).toBe('command-output')
    expect(output?.content).toContain('No current git diff was found.')
    expect(result.statusLine).toContain('Displayed the current diff')
  })

  test('should update model config via command subcommand', async () => {
    const repo = createMockSessionRepo()
    const store = createMockModelConfigStore()
    const session = ConversationSession.create({
      id: 'sess-config',
      title: 'Config',
      mode: 'agent',
      workspacePath: 'E:/26Project/Adnify-Cli',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await repo.save(session)

    const useCase = new ApplyCliCommandUseCase(
      repo,
      createMockStorageSettings(),
      store,
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:05:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )

    const result = await useCase.execute({
      sessionId: session.id,
      commandLine: ':config set model gpt-5',
      bootstrap: createBootstrapSnapshot(),
      configUpdater: {
        applyModelConfig: (config) => config,
      },
    })

    const output = parseCliTranscriptMarkup(result.session.getMessages()[1]?.content ?? '')
    expect(output?.kind).toBe('command-output')
    expect(output?.content).toContain('Configuration updated.')
    expect(store.saved[0]?.model).toBe('gpt-5')
    expect(result.statusLine).toContain('Configuration updated')
  })
})
