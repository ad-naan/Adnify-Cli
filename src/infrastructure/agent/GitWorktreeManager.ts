import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { LoggerPort } from '../../application/ports/LoggerPort'

const execFileAsync = promisify(execFile)

export interface WorktreeHandle {
  id: string
  path: string
}

export interface WorktreeCommandRunner {
  run(cwd: string, args: string[]): Promise<string>
}

const defaultRunner: WorktreeCommandRunner = {
  async run(cwd, args) {
    const result = await execFileAsync('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
    return result.stdout
  },
}

/** Creates disposable detached worktrees for isolated implementation workers. */
export class GitWorktreeManager {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: LoggerPort,
    private readonly runner: WorktreeCommandRunner = defaultRunner,
  ) {}

  async create(taskId: string): Promise<WorktreeHandle> {
    await this.runner.run(this.workspaceRoot, ['rev-parse', '--verify', 'HEAD'])
    const id = sanitize(taskId)
    const path = join(this.workspaceRoot, '.adnify', 'worktrees', id)
    await mkdir(join(this.workspaceRoot, '.adnify', 'worktrees'), { recursive: true })
    await this.runner.run(this.workspaceRoot, ['worktree', 'add', '--detach', path, 'HEAD'])
    this.logger.info('Created isolated agent worktree', { taskId, path })
    return { id, path }
  }

  async capturePatch(handle: WorktreeHandle): Promise<{ patch: string; status: string }> {
    // Make untracked files visible to `git diff HEAD` without staging their contents.
    // This only touches the disposable worktree index; the parent workspace stays clean.
    await this.runner.run(handle.path, ['add', '-N', '--', '.'])
    const [patch, status] = await Promise.all([
      this.runner.run(handle.path, ['diff', '--binary', '--no-ext-diff', 'HEAD']),
      this.runner.run(handle.path, ['status', '--short']),
    ])
    return { patch, status }
  }

  async dispose(handle: WorktreeHandle): Promise<void> {
    try {
      await this.runner.run(this.workspaceRoot, ['worktree', 'remove', '--force', handle.path])
      await this.runner.run(this.workspaceRoot, ['worktree', 'prune'])
      this.logger.info('Removed isolated agent worktree', { path: handle.path })
    } catch (error) {
      this.logger.warn('Failed to clean isolated agent worktree', {
        path: handle.path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

function sanitize(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return (normalized || `agent-${Date.now()}`).slice(0, 64)
}
