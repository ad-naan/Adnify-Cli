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

describe('fileOpsHandler multi-patch (atomic hunks)', () => {
  test('applies all hunks when every match succeeds', async () => {
    await withWorkspace(async (root) => {
      const file = join(root, 'multi.ts')
      await writeFile(
        file,
        'const alpha = 1\nconst beta = 2\nconst gamma = 3\n',
        'utf8',
      )

      const result = await patch(root, {
        action: 'multi-patch',
        path: 'multi.ts',
        patches: [
          { oldText: 'const alpha = 1', newText: 'const alpha = 10' },
          { oldText: 'const gamma = 3', newText: 'const gamma = 30' },
        ],
        allowWrite: true,
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain('Hunks applied: 2 (atomic')
      expect(await readFile(file, 'utf8')).toBe(
        'const alpha = 10\nconst beta = 2\nconst gamma = 30\n',
      )
    })
  })

  test('writes nothing when a later hunk fails (atomicity)', async () => {
    await withWorkspace(async (root) => {
      const file = join(root, 'atomic.ts')
      const original = 'const a = 1\nconst b = 2\n'
      await writeFile(file, original, 'utf8')

      const result = await patch(root, {
        action: 'multi-patch',
        path: 'atomic.ts',
        patches: [
          { oldText: 'const a = 1', newText: 'const a = 99' },
          { oldText: 'const missing = 0', newText: 'const missing = 9' },
        ],
        allowWrite: true,
      })

      expect(result.ok).toBe(false)
      expect(result.content).toContain('Atomic rejection')
      expect(result.content).toContain('patches[1] failed')
      // 磁盘内容不变:第一个 hunk 也不应被写入
      expect(await readFile(file, 'utf8')).toBe(original)
    })
  })

  test('rejects empty patches array and missing allowWrite', async () => {
    await withWorkspace(async (root) => {
      const file = join(root, 'guard.ts')
      await writeFile(file, 'x\n', 'utf8')

      const noAck = await patch(root, {
        action: 'multi-patch',
        path: 'guard.ts',
        patches: [{ oldText: 'x', newText: 'y' }],
      })
      expect(noAck.ok).toBe(false)
      expect(noAck.content).toContain('allowWrite')

      const empty = await patch(root, {
        action: 'multi-patch',
        path: 'guard.ts',
        patches: [],
        allowWrite: true,
      })
      expect(empty.ok).toBe(false)
      expect(empty.content).toContain('"patches"')
    })
  })

  test('per-hunk replaceAll and tolerant fallback still work inside multi-patch', async () => {
    await withWorkspace(async (root) => {
      const file = join(root, 'mixed.ts')
      await writeFile(file, 'const a = 1   \nlog(a)\nlog(a)\n', 'utf8')

      const result = await patch(root, {
        action: 'multi-patch',
        path: 'mixed.ts',
        patches: [
          { oldText: 'log(a)', newText: 'log(b)', replaceAll: true, expectedCount: 2 },
          // 容错匹配的 span 不含行尾换行:newText 别带 \n,否则会多出一个空行
          { oldText: 'const a = 1\n', newText: 'const a = 2' }, // trailing spaces → tolerant
        ],
        allowWrite: true,
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain('trailing-whitespace tolerance')
      expect(result.content).toContain('replaced 2 occurrence(s)')
      expect(await readFile(file, 'utf8')).toBe('const a = 2\nlog(b)\nlog(b)\n')
    })
  })
})

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
