import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { AppStorageSnapshot } from '../../application/dto/AppStorageSnapshot'

export interface MemoryEntry {
  id: string
  content: string
  createdAt: string
  scope: 'workspace' | 'global'
}

export interface MemoryFile {
  entries: MemoryEntry[]
}

/**
 * Persistent memory store for cross-session project knowledge.
 * Stores workspace-scoped memories in the app data directory.
 */
export class MemoryStore {
  private readonly memoryDir: string
  private cache: Map<string, MemoryEntry[]> | null = null

  constructor(
    storage: AppStorageSnapshot,
    private readonly workspacePath: string,
  ) {
    this.memoryDir = join(storage.dataRoot, 'memories')
  }

  private workspaceKey(): string {
    // Sanitize workspace path for filename
    return this.workspacePath
      .replace(/[:/\\]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80)
  }

  private memoryFilePath(): string {
    return join(this.memoryDir, `${this.workspaceKey()}.json`)
  }

  private async ensureCache(): Promise<MemoryEntry[]> {
    if (this.cache) {
      return this.cache.get(this.workspaceKey()) ?? []
    }

    try {
      const raw = await readFile(this.memoryFilePath(), 'utf8')
      const parsed = JSON.parse(raw) as MemoryFile
      this.cache = new Map()
      this.cache.set(this.workspaceKey(), parsed.entries ?? [])
      return parsed.entries ?? []
    } catch {
      this.cache = new Map()
      this.cache.set(this.workspaceKey(), [])
      return []
    }
  }

  async list(): Promise<MemoryEntry[]> {
    return [...(await this.ensureCache())]
  }

  async add(content: string): Promise<MemoryEntry> {
    const normalizedContent = content.trim()
    if (!normalizedContent) {
      throw new Error('Memory content cannot be empty')
    }

    const entries = [...(await this.ensureCache())]
    const entry: MemoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: normalizedContent,
      createdAt: new Date().toISOString(),
      scope: 'workspace',
    }

    entries.push(entry)
    this.cache!.set(this.workspaceKey(), entries)
    await this.persist()
    return entry
  }

  async remove(id: string): Promise<boolean> {
    const entries = [...(await this.ensureCache())]
    const index = entries.findIndex((e) => e.id === id)
    if (index === -1) {
      return false
    }

    entries.splice(index, 1)
    this.cache!.set(this.workspaceKey(), entries)
    await this.persist()
    return true
  }

  async clear(): Promise<void> {
    await this.ensureCache()
    this.cache!.set(this.workspaceKey(), [])
    await this.persist()
  }

  /**
   * Returns all memories as a formatted string for system prompt injection.
   */
  async toPromptBlock(): Promise<string> {
    const entries = await this.ensureCache()
    if (entries.length === 0) {
      return ''
    }

    const formatted = entries
      .map((e, i) => `[${i + 1}] ${e.content}`)
      .join('\n')

    return `## Project Memories\nThe following facts were saved in previous sessions:\n${formatted}`
  }

  private async persist(): Promise<void> {
    const entries = this.cache!.get(this.workspaceKey()) ?? []
    const data: MemoryFile = { entries }
    await mkdir(dirname(this.memoryFilePath()), { recursive: true })
    await writeFile(this.memoryFilePath(), JSON.stringify(data, null, 2), 'utf8')
  }
}
