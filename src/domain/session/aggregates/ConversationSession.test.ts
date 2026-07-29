import { describe, expect, test } from 'bun:test'
import { ConversationSession } from './ConversationSession'

describe('ConversationSession', () => {
  test('should append messages and update timestamps', () => {
    const createdAt = new Date('2026-04-13T12:00:00.000Z')
    const session = ConversationSession.create({
      id: 'session-1',
      title: 'General session',
      mode: 'agent',
      workspacePath: '/workspace/adnify-cli',
      createdAt,
    })

    const userTime = new Date('2026-04-13T12:01:00.000Z')
    session.addUserMessage('message-1', userTime, '你好')

    const assistantTime = new Date('2026-04-13T12:02:00.000Z')
    session.addAssistantMessage('message-2', assistantTime, '你好，我在。')

    expect(session.getMessages()).toHaveLength(2)
    expect(session.updatedAt.toISOString()).toBe(assistantTime.toISOString())
    expect(session.getRecentMessages(1)[0]?.content).toBe('你好，我在。')
  })

  test('should clear messages without losing session identity', () => {
    const session = ConversationSession.create({
      id: 'session-2',
      title: 'Chat session',
      mode: 'chat',
      workspacePath: '/workspace/adnify-cli',
      createdAt: new Date('2026-04-13T12:00:00.000Z'),
    })

    session.addSystemMessage('message-3', new Date('2026-04-13T12:01:00.000Z'), 'system')
    session.clearConversation(new Date('2026-04-13T12:02:00.000Z'))

    expect(session.id).toBe('session-2')
    expect(session.getMessages()).toHaveLength(0)
  })

  test('should rename title and update timestamp', () => {
    const createdAt = new Date('2026-04-13T12:00:00.000Z')
    const session = ConversationSession.create({
      id: 'session-3',
      title: 'Rename session',
      mode: 'agent',
      workspacePath: '/workspace/adnify-cli',
      createdAt,
    })

    const renamedAt = new Date('2026-04-13T12:03:00.000Z')
    session.renameTitle('Fix auth token refresh loop', renamedAt)

    expect(session.title).toBe('Fix auth token refresh loop')
    expect(session.updatedAt.toISOString()).toBe(renamedAt.toISOString())
  })
})
