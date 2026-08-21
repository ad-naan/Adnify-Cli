import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceContext } from '../../../domain/workspace/entities/WorkspaceContext'
import type { ToolExecutionRequest } from '../../../application/ports/ToolExecutorPort'
import { parseFileOpsRequest, runFileOps } from './fileOpsHandler'

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'adnify-fileops-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

function makeRequest(root: string, payload: Record<string, unknown>): ToolExecutionRequest {
  return {
    toolId: 'file-ops',
    input: JSON.stringify(payload),
    workspace: new WorkspaceContext({
      rootPath: root,
      isGitRepository: false,
      packageManager: 'bun',
      topLevelEntries: [],
    }),
  }
}

async function patch(root: string, payload: Record<string, unknown>) {
  const parsed = parseFileOpsRequest(makeRequest(root, payload))
  if (!parsed.ok) return parsed.result
  return runFileOps(parsed.value)
}

describe('fileOpsHandler tolerant patch', () => {
  test('exact match still wins without a tolerance note', async () => {
    await withWorkspace(async (root) => {
      const file = join(root, 'a.ts')
      await writeFile(file, 'const a = 1\nconst b = 2\n', 'utf8')

      const result = await patch(root, {
        action: 'update',
        path: 'a.ts',
        oldText: 'const a = 1',
        newText: 'const a = 99',
        allowWrite: true,
      })

      expect(result.ok).toBe(true)
      expect(result.content).not.toContain('tolerance')
      expect(await readFile(file, 'utf8')).toBe('const a = 99\nconst b = 2\n')
    })
  })

  test('falls back to trailing-whitespace tolerance when exact match fails', async () => {
    await withWorkspace(async (root) => {
      const file = join(root, 'b.ts')
      await writeFile(file, 'const a = 1   \nconst b = 2\n', 'utf8')

      const result = await patch(root, {
        action: 'update',
        path: 'b.ts',
        oldText: 'const a = 1\nconst b = 2', // trailing spaces on line 1 break exact match
        newText: 'const a = 99\nconst b = 2',
        allowWrite: true,
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain('trailing-whitespace tolerance')
      expect(await readFile(file, 'utf8')).toBe('const a = 99\nconst b = 2\n')
    })
  })

  test('reindents newText when only indentation differs', async () => {
    await withWorkspace(async (root) => {
      const file = join(root, 'c.ts')
      await writeFile(file, 'function f() {\nreturn 42\n}\n', 'utf8')

      const result = await patch(root, {
        action: 'update',
        path: 'c.ts',
        oldText: '    return 42', // over-indented vs the file's flush-left line
        newText: '    return 43',
        allowWrite: true,
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain('indentation tolerance')
      expect(await readFile(file, 'utf8')).toBe('function f() {\nreturn 43\n}\n')
    })
  })

  test('refuses ambiguous tolerant matches instead of guessing', async () => {
    await withWorkspace(async (root) => {
      const file = join(root, 'd.ts')
      await writeFile(file, '\tfoo()\n\n\tfoo()\n', 'utf8')

      const result = await patch(root, {
        action: 'update',
        path: 'd.ts',
        oldText: '  foo()', // spaces vs the file's tabs → exact miss, two fuzzy hits
        newText: '  bar()',
        allowWrite: true,
      })

      expect(result.ok).toBe(false)
      expect(result.content).toContain('ambiguous')
      // file left untouched
      expect(await readFile(file, 'utf8')).toBe('\tfoo()\n\n\tfoo()\n')
    })
  })

  test('still fails cleanly when content is genuinely absent', async () => {
    await withWorkspace(async (root) => {
      const file = join(root, 'e.ts')
      await writeFile(file, 'const a = 1\n', 'utf8')

      const result = await patch(root, {
        action: 'update',
        path: 'e.ts',
        oldText: 'const zzz = 9',
        newText: 'const zzz = 10',
        allowWrite: true,
      })

      expect(result.ok).toBe(false)
      expect(result.content).toContain('No matching content found')
    })
  })

  test('replaceAll keeps strict exact-only semantics', async () => {
    await withWorkspace(async (root) => {
      const file = join(root, 'f.ts')
      await writeFile(file, 'a\nx = 1   \nb\n', 'utf8')

      const result = await patch(root, {
        action: 'update',
        path: 'f.ts',
        oldText: 'x = 1\nb', // exact miss (trailing spaces); replaceAll must not fuzzy-match
        newText: 'x = 2\nb',
        replaceAll: true,
        allowWrite: true,
      })

      expect(result.ok).toBe(false)
      expect(result.content).toContain('No matching content found')
    })
  })
})
