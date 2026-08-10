import * as fs from 'node:fs'
import * as path from 'node:path'
import type { LoggerPort } from '../../application/ports/LoggerPort'

/**
 * 文件检查点条目。
 * 记录单个文件在某次事务中的原始内容快照。
 */
export interface CheckpointEntry {
  /** 工作区相对路径（POSIX 正斜杠） */
  relativePath: string
  /** 快照时的文件内容（null = 文件当时不存在） */
  originalContent: string | null
  /** 快照时间戳 */
  timestamp: number
}

/**
 * 一次工具调用事务的检查点。
 * 包含该事务中被修改的所有文件的快照。
 */
export interface CheckpointSnapshot {
  /** 唯一 ID（UUID 或时间戳+随机） */
  id: string
  /** 事务描述（如 "file-ops write src/main.ts"） */
  description: string
  /** 文件快照列表 */
  entries: CheckpointEntry[]
  /** 创建时间戳 */
  createdAt: number
}

/**
 * 文件级检查点管理器。
 *
 * 设计目标：
 * - 在 AI Agent 每次写入/修改文件前，保存原始内容快照
 * - 不依赖 Git — 即使没有 Git 仓库也能回滚
 * - 快照存储在 `.adnify/checkpoints/` 目录下
 * - 自动清理过期快照（默认保留最近 50 个）
 *
 * 使用场景：
 * - AI Agent 执行文件写入前调用 `captureBeforeWrite()`
 * - 用户请求撤销时调用 `restore()`
 * - 崩溃恢复时调用 `listSnapshots()` 查看可恢复点
 *
 * 线程安全：所有操作都是同步的，避免并发写入问题。
 */
export class CheckpointManager {
  private static readonly MAX_SNAPSHOTS = 50
  private static readonly CHECKPOINT_DIR = '.adnify'

  private readonly checkpointRoot: string

  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: LoggerPort,
  ) {
    this.checkpointRoot = path.join(workspaceRoot, CheckpointManager.CHECKPOINT_DIR, 'checkpoints')
  }

  /**
   * 在文件被写入之前捕获快照。
   *
   * 如果文件不存在，记录 null（表示新增）。
   * 如果已是注册的暂存区域，则不重复读取。
   *
   * @param relativePath 工作区相对路径
   * @param description 操作描述
   * @returns 快照 ID
   */
  captureBeforeWrite(relativePath: string, description: string): string {
    const normalizedPath = relativePath.replace(/\\/g, '/')

    let originalContent: string | null
    try {
      const fullPath = path.join(this.workspaceRoot, normalizedPath)
      originalContent = fs.readFileSync(fullPath, 'utf8')
    } catch (error) {
      // File doesn't exist yet — this is fine, record null
      originalContent = null
    }

    const entry: CheckpointEntry = {
      relativePath: normalizedPath,
      originalContent,
      timestamp: Date.now(),
    }

    return this.commitSnapshot([entry], description)
  }

  /**
   * 从保存的快照中恢复文件内容。
   *
   * @param snapshotId 快照 ID
   * @returns 恢复的文件列表，如果快照不存在则返回 null
   */
  restore(snapshotId: string): CheckpointEntry[] | null {
    const snapshot = this.loadSnapshot(snapshotId)
    if (!snapshot) {
      this.logger.warn('Checkpoint snapshot not found', { snapshotId })
      return null
    }

    const restored: CheckpointEntry[] = []

    for (const entry of snapshot.entries) {
      const fullPath = path.join(this.workspaceRoot, entry.relativePath)
      try {
        if (entry.originalContent === null) {
          // File was created by the operation — delete it to restore
          try {
            fs.unlinkSync(fullPath)
          } catch {
            // File might have been removed already
          }
        } else {
          // Restore original content
          fs.mkdirSync(path.dirname(fullPath), { recursive: true })
          fs.writeFileSync(fullPath, entry.originalContent, 'utf8')
        }
        restored.push(entry)
      } catch (error) {
        this.logger.error('Failed to restore checkpoint entry', {
          relativePath: entry.relativePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    this.logger.info('Checkpoint restored', {
      snapshotId,
      filesRestored: restored.length,
    })

    return restored
  }

  /**
   * 列出所有可用的快照。
   */
  listSnapshots(): CheckpointSnapshot[] {
    this.ensureCheckpointDir()

    const snapshots: CheckpointSnapshot[] = []

    try {
      const entries = fs.readdirSync(this.checkpointRoot)
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue
        try {
          const content = fs.readFileSync(path.join(this.checkpointRoot, entry), 'utf8')
          snapshots.push(JSON.parse(content))
        } catch {
          // Skip corrupted snapshots
        }
      }
    } catch {
      // Directory doesn't exist
    }

    // Sort by createdAt descending (newest first)
    return snapshots.sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * 删除最旧的快照，直到数量降到 MAX_SNAPSHOTS 以下。
   */
  pruneOldSnapshots(): number {
    const snapshots = this.listSnapshots()
    if (snapshots.length <= CheckpointManager.MAX_SNAPSHOTS) {
      return 0
    }

    const toRemove = snapshots.slice(CheckpointManager.MAX_SNAPSHOTS)
    let removed = 0

    for (const snapshot of toRemove) {
      const filePath = path.join(this.checkpointRoot, `${snapshot.id}.json`)
      try {
        fs.unlinkSync(filePath)
        removed++
      } catch {
        // Ignore
      }
    }

    this.logger.debug('Pruned old checkpoints', { removed, remaining: snapshots.length - removed })
    return removed
  }

  /**
   * 注册一次工具调用的完整事务快照。
   * 在工具执行后调用，将所有捕获的条目持久化。
   */
  commitSnapshot(entries: CheckpointEntry[], description: string): string {
    const id = this.generateId(Date.now())
    const snapshot: CheckpointSnapshot = {
      id,
      description,
      entries,
      createdAt: Date.now(),
    }

    this.ensureCheckpointDir()

    const filePath = path.join(this.checkpointRoot, `${id}.json`)
    try {
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8')
      this.logger.debug('Checkpoint committed', {
        id,
        description,
        fileCount: entries.length,
      })
      this.pruneOldSnapshots()
    } catch (error) {
      this.logger.warn('Failed to persist checkpoint', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return id
  }

  /**
   * 删除指定快照。
   */
  deleteSnapshot(snapshotId: string): boolean {
    const filePath = path.join(this.checkpointRoot, `${snapshotId}.json`)
    try {
      fs.unlinkSync(filePath)
      return true
    } catch {
      return false
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  private ensureCheckpointDir(): void {
    try {
      fs.mkdirSync(this.checkpointRoot, { recursive: true })
    } catch {
      // May already exist or no permissions — non-fatal
    }
  }

  private loadSnapshot(id: string): CheckpointSnapshot | null {
    try {
      const filePath = path.join(this.checkpointRoot, `${id}.json`)
      const content = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(content) as CheckpointSnapshot
    } catch {
      return null
    }
  }

  private generateId(timestamp: number): string {
    const random = Math.random().toString(36).substring(2, 8)
    return `${timestamp.toString(36)}-${random}`
  }
}
