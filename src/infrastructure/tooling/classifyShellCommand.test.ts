import { describe, expect, it } from 'bun:test'
import { classifyShellCommand } from './classifyShellCommand'

describe('classifyShellCommand', () => {
  it('treats ripgrep as safe', () => {
    const result = classifyShellCommand(['rg', 'useCliController', 'src'])
    expect(result).toEqual({ ok: true, riskLevel: 'safe', summary: 'rg useCliController src' })
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
