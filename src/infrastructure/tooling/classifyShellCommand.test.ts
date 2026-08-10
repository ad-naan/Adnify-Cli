import { describe, expect, it } from 'bun:test'
import { classifyShellCommand, formatShellCommandEffect } from './classifyShellCommand'

describe('classifyShellCommand', () => {
  it('treats ripgrep as safe', () => {
    const result = classifyShellCommand(['rg', 'useCliController', 'src'])
    expect(result).toMatchObject({ ok: true, riskLevel: 'safe', summary: 'rg useCliController src' })
  })

  it('treats read-only git as safe', () => {
    expect(classifyShellCommand(['git', 'status'])).toMatchObject({ ok: true, riskLevel: 'safe' })
    expect(classifyShellCommand(['git', 'rev-parse', 'HEAD'])).toMatchObject({
      ok: true,
      riskLevel: 'safe',
    })
  })

  it('rejects mutating git subcommands', () => {
    const result = classifyShellCommand(['git', 'push'])
    expect(result.ok).toBe(false)
  })

  it('treats project verification commands as careful so they need approval', () => {
    expect(classifyShellCommand(['bun', 'test'])).toMatchObject({ ok: true, riskLevel: 'careful' })
    expect(classifyShellCommand(['bun', 'run', 'build'])).toMatchObject({
      ok: true,
      riskLevel: 'careful',
    })
    expect(classifyShellCommand(['bunx', 'tsc', '--noEmit'])).toMatchObject({
      ok: true,
      riskLevel: 'careful',
    })
    expect(classifyShellCommand(['bun', 'x', 'tsc'])).toMatchObject({
      ok: true,
      riskLevel: 'careful',
    })
  })

  it('does not let bun run become an arbitrary script runner', () => {
    expect(classifyShellCommand(['bun', 'run', 'deploy']).ok).toBe(false)
    expect(classifyShellCommand(['bun', 'run']).ok).toBe(false)
  })

  it('rejects other bun subcommands and binaries', () => {
    expect(classifyShellCommand(['bun', 'install']).ok).toBe(false)
    expect(classifyShellCommand(['bunx', 'rimraf']).ok).toBe(false)
  })

  it('rejects unknown commands and empty argv', () => {
    expect(classifyShellCommand(['del', 'foo.txt']).ok).toBe(false)
    expect(classifyShellCommand([])).toEqual({ ok: false, reason: 'Missing command name.' })
  })
})

/** 审批面板靠 effect 区分「同为 careful 但后果差很远」的命令。 */
describe('shell command effect', () => {
  const effectOf = (argv: string[]) => {
    const result = classifyShellCommand(argv)
    if (!result.ok) {
      throw new Error(`expected ${argv.join(' ')} to be allowed`)
    }
    return result.effect
  }

  it('reports read-only commands as writing nothing', () => {
    expect(effectOf(['rg', 'foo']).writes).toHaveLength(0)
    expect(effectOf(['git', 'status']).writes).toHaveLength(0)
  })

  it('renders no preview for read-only commands', () => {
    // 只读命令根本不触发审批，塞一段说明只会稀释真正要注意的内容。
    expect(formatShellCommandEffect(effectOf(['git', 'log']))).toBe('')
  })

  it('flags irrecoverable data loss for git reset --hard', () => {
    // git add 和 git reset --hard 都是 careful，面板上必须能看出区别。
    const hard = effectOf(['git', 'reset', '--hard', 'HEAD~1'])
    expect(hard.cautions.join(' ')).toContain('cannot be recovered')
    expect(hard.writes).toContain('The working tree')

    const staged = effectOf(['git', 'add', '.'])
    expect(staged.cautions).toHaveLength(0)
  })

  it('does not warn about data loss for a soft reset', () => {
    const soft = effectOf(['git', 'reset', '--soft', 'HEAD~1'])
    expect(soft.cautions).toHaveLength(0)
    expect(soft.writes).toContain('The git index')
  })

  it('flags overwritten changes for checkout and restore', () => {
    expect(effectOf(['git', 'checkout', 'main']).cautions.join(' ')).toContain('overwritten')
    expect(effectOf(['git', 'restore', 'src/a.ts']).cautions.join(' ')).toContain('overwritten')
  })

  it('distinguishes an amend from an ordinary commit', () => {
    expect(effectOf(['git', 'commit', '-m', 'x']).cautions).toHaveLength(0)
    expect(effectOf(['git', 'commit', '--amend']).cautions.join(' ')).toContain('rewrites')
  })

  it('warns that installs run third-party scripts', () => {
    const install = effectOf(['npm', 'install'])
    expect(install.cautions.join(' ')).toContain('install scripts')
    expect(install.writes).toContain('node_modules/')
    expect(effectOf(['npm', 'ci']).cautions.join(' ')).toContain('deletes node_modules/')
  })

  it('formats writes and cautions into a readable block', () => {
    const text = formatShellCommandEffect(effectOf(['git', 'reset', '--hard']))
    expect(text).toContain('Modifies:')
    expect(text).toContain('Note:')
    expect(text.split('\n')[0]).toBe('Move the branch pointer')
  })
})
