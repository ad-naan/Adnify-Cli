import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TsDiagnosticsProvider } from './TsDiagnosticsProvider'

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

async function withTempWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'adnify-diag-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

describe('TsDiagnosticsProvider', () => {
  test('supportsFile only for TS/JS extensions', () => {
    const provider = new TsDiagnosticsProvider(silentLogger)
    expect(provider.supportsFile('a.ts')).toBe(true)
    expect(provider.supportsFile('a.tsx')).toBe(true)
    expect(provider.supportsFile('a.js')).toBe(true)
    expect(provider.supportsFile('a.md')).toBe(false)
    expect(provider.supportsFile('a.png')).toBe(false)
  })

  test('reports a type error on a broken file', async () => {
    await withTempWorkspace(async (root) => {
      const file = join(root, 'broken.ts')
      await writeFile(file, 'const value: number = "not a number";\n', 'utf8')

      const provider = new TsDiagnosticsProvider(silentLogger)
      const diagnostics = await provider.getFileDiagnostics(root, file)

      expect(diagnostics.length).toBeGreaterThan(0)
      const first = diagnostics[0]
      expect(first.severity).toBe('error')
      expect(first.line).toBe(1)
      expect(first.code).toBe(2322) // Type 'string' is not assignable to type 'number'.
    })
  })

  test('returns no diagnostics for a clean file', async () => {
    await withTempWorkspace(async (root) => {
      const file = join(root, 'clean.ts')
      await writeFile(file, 'export const value: number = 42;\n', 'utf8')

      const provider = new TsDiagnosticsProvider(silentLogger)
      const diagnostics = await provider.getFileDiagnostics(root, file)

      expect(diagnostics).toHaveLength(0)
    })
  })

  test('picks up edits on re-check via version bump', async () => {
    await withTempWorkspace(async (root) => {
      const file = join(root, 'evolving.ts')
      await writeFile(file, 'export const value: number = 1;\n', 'utf8')

      const provider = new TsDiagnosticsProvider(silentLogger)
      expect(await provider.getFileDiagnostics(root, file)).toHaveLength(0)

      // Introduce an error, then re-check the same file through the cached service.
      await writeFile(file, 'export const value: number = "oops";\n', 'utf8')
      const diagnostics = await provider.getFileDiagnostics(root, file)
      expect(diagnostics.length).toBeGreaterThan(0)
      expect(diagnostics[0].code).toBe(2322)
    })
  })

  test('ignores unsupported files without throwing', async () => {
    await withTempWorkspace(async (root) => {
      const file = join(root, 'notes.md')
      await writeFile(file, '# hello\n', 'utf8')

      const provider = new TsDiagnosticsProvider(silentLogger)
      expect(await provider.getFileDiagnostics(root, file)).toHaveLength(0)
    })
  })
})
