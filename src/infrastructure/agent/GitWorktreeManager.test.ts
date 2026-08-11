import { describe, expect, test } from 'bun:test'
import { GitWorktreeManager, type WorktreeCommandRunner } from './GitWorktreeManager'

describe('GitWorktreeManager', () => {
  test('creates a detached worktree, captures its patch, and removes it', async () => {
    const calls: Array<{ cwd: string; args: string[] }> = []
    const runner: WorktreeCommandRunner = {
      async run(cwd, args) {
        calls.push({ cwd, args })
        if (args[0] === 'diff') return 'diff --git a/a.ts b/a.ts'
        if (args[0] === 'status') return ' M a.ts'
        return ''
      },
    }
    const logger = { debug() {}, info() {}, warn() {}, error() {} }
    const manager = new GitWorktreeManager('/repo', logger, runner)

    const handle = await manager.create('Implement Auth!')
    const captured = await manager.capturePatch(handle)
    await manager.dispose(handle)

    expect(handle.path.replace(/\\/g, '/')).toContain('/repo/.adnify/worktrees/implement-auth')
    expect(captured.patch).toContain('diff --git')
    expect(calls.map((call) => call.args.join(' '))).toContain('add -N -- .')
    expect(calls.map((call) => call.args.slice(0, 2).join(' '))).toContain('worktree add')
    expect(calls.map((call) => call.args.slice(0, 3).join(' '))).toContain('worktree remove --force')
  })
})
