import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionRepositoryPort } from '../../application/ports/SessionRepositoryPort'
import type { AppStorageSnapshot } from '../../application/dto/AppStorageSnapshot'
import { atomicWriteFile } from '../storage/atomicWriteFile'
import {
  ConversationSession,
  type ConversationSessionSnapshot,
} from '../../domain/session/aggregates/ConversationSession'

export class FileSessionRepository implements SessionRepositoryPort {
  constructor(private readonly storage: AppStorageSnapshot) {}

  async save(session: ConversationSession): Promise<void> {
    await atomicWriteFile(
      this.resolveSessionPath(session.id),
      JSON.stringify(session.toSnapshot(), null, 2),
    )
  }

  async findById(sessionId: string): Promise<ConversationSession | null> {
    try {
      const raw = await readFile(this.resolveSessionPath(sessionId), 'utf8')
      return ConversationSession.rehydrate(JSON.parse(raw) as ConversationSessionSnapshot)
    } catch {
      return null
    }
  }

  async listByWorkspace(workspacePath: string, limit = 20): Promise<ConversationSession[]> {
    try {
      const entries = await readdir(this.storage.sessionsDir)
      const sessions = await Promise.all(
        entries
          .filter((entry) => entry.endsWith('.json'))
          .map(async (entry) => {
            try {
              const raw = await readFile(join(this.storage.sessionsDir, entry), 'utf8')
              return ConversationSession.rehydrate(JSON.parse(raw) as ConversationSessionSnapshot)
            } catch {
              return null
            }
          }),
      )

      return sessions
        .filter((session): session is ConversationSession => Boolean(session))
        .filter((session) => session.workspacePath === workspacePath)
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .slice(0, limit)
    } catch {
      return []
    }
  }

  private resolveSessionPath(sessionId: string): string {
    return join(this.storage.sessionsDir, `${sessionId}.json`)
  }
}
