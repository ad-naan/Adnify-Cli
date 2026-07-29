import { describe, expect, test } from 'bun:test'
import { AssistantProfile } from '../../domain/assistant/entities/AssistantProfile'
import { ConversationSession } from '../../domain/session/aggregates/ConversationSession'
import { createAppI18n } from '../i18n/AppI18n'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { LoggerPort } from '../ports/LoggerPort'
import type { SessionRepositoryPort } from '../ports/SessionRepositoryPort'
import { CreateSessionUseCase } from './CreateSessionUseCase'
import { ResolveStartupSessionUseCase } from './ResolveStartupSessionUseCase'

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
  return { next: () => `boot-${++idCounter}` }
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

describe('ResolveStartupSessionUseCase', () => {
  test('should restore the latest session for the workspace when available', async () => {
    const repo = createMockSessionRepo()
    const older = ConversationSession.create({
      id: 'session-older',
      title: 'older',
      mode: 'chat',
      workspacePath: '/workspace/adnify-cli',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    older.addUserMessage('msg-1', new Date('2026-01-01T00:05:00.000Z'), 'older')

    const latest = ConversationSession.create({
      id: 'session-latest',
      title: 'latest',
      mode: 'agent',
      workspacePath: '/workspace/adnify-cli',
      createdAt: new Date('2026-01-01T00:10:00.000Z'),
    })
    latest.addUserMessage('msg-2', new Date('2026-01-01T00:20:00.000Z'), 'latest')

    await repo.save(older)
    await repo.save(latest)

    const createSession = new CreateSessionUseCase(
      repo,
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:30:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )
    const useCase = new ResolveStartupSessionUseCase(repo, createSession, createMockLogger())

    const result = await useCase.execute({
      workspacePath: '/workspace/adnify-cli',
      mode: 'plan',
    })

    expect(result.restored).toBe(true)
    expect(result.session.id).toBe('session-latest')
  })

  test('should create a new session when workspace has no history', async () => {
    const repo = createMockSessionRepo()
    const createSession = new CreateSessionUseCase(
      repo,
      createMockIdGenerator(),
      createMockClock(new Date('2026-01-01T00:30:00.000Z')),
      createMockLogger(),
      createAppI18n('en'),
    )
    const useCase = new ResolveStartupSessionUseCase(repo, createSession, createMockLogger())

    const result = await useCase.execute({
      workspacePath: '/workspace/adnify-cli',
      mode: 'agent',
    })

    expect(result.restored).toBe(false)
    expect(result.session.id).toBe('boot-1')
    expect(result.session.mode).toBe('agent')
  })
})
