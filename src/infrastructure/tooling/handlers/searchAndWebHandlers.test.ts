import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceContext } from '../../../domain/workspace/entities/WorkspaceContext'
import type { ToolExecutionRequest } from '../../../application/ports/ToolExecutorPort'
import { handleGlobSearch } from './globSearchHandler'
import { handleSearchIndex } from './searchIndexHandler'
import { handleWebFetch } from './webFetchHandler'
import { handleWebSearch } from './webSearchHandler'

const originalFetch = globalThis.fetch

async function withMockFetch(
  mockFetch: typeof fetch,
  run: () => Promise<void>,
): Promise<void> {
  globalThis.fetch = mockFetch
  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function withWorkspace(
  run: (rootPath: string) => Promise<void>,
): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), 'adnify-search-'))
  try {
    await run(rootPath)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
}

function request(
  toolId: string,
  input: Record<string, unknown>,
  rootPath: string = process.cwd(),
): ToolExecutionRequest {
  return {
    toolId,
    input: JSON.stringify(input),
    workspace: new WorkspaceContext({
      rootPath,
      isGitRepository: false,
      packageManager: 'bun',
      topLevelEntries: [],
    }),
  }
}

describe('search handlers', () => {
  test('glob-search matches source files and skips ignored directories', async () => {
    await withWorkspace(async (rootPath) => {
      await mkdir(join(rootPath, 'src', 'nested'), { recursive: true })
      await mkdir(join(rootPath, 'node_modules', 'hidden'), { recursive: true })
      await writeFile(join(rootPath, 'src', 'nested', 'match.ts'), 'export {}')
      await writeFile(join(rootPath, 'src', 'nested', 'skip.js'), 'export {}')
      await writeFile(join(rootPath, 'node_modules', 'hidden', 'ignored.ts'), 'export {}')

      const result = await handleGlobSearch(
        request('glob-search', { pattern: 'src/**/*.ts' }, rootPath),
      )

      expect(result.ok).toBe(true)
      expect(result.content).toContain('src/nested/match.ts')
      expect(result.content).not.toContain('ignored.ts')
      expect(result.content).not.toContain('skip.js')
    })
  })

  test('search-index finds matching source text in a workspace', async () => {
    await withWorkspace(async (rootPath) => {
      await mkdir(join(rootPath, 'src'), { recursive: true })
      await writeFile(
        join(rootPath, 'src', 'sample.ts'),
        'const uniqueSearchNeedle = 42\n',
      )

      const result = await handleSearchIndex(
        request('search-index', { query: 'uniqueSearchNeedle' }, rootPath),
      )

      expect(result.ok).toBe(true)
      expect(result.content).toContain('sample.ts')
      expect(result.content).toContain('uniqueSearchNeedle')
    })
  })

  test('search handlers reject missing required input', async () => {
    const globResult = await handleGlobSearch(request('glob-search', {}))
    const indexResult = await handleSearchIndex(request('search-index', {}))

    expect(globResult.ok).toBe(false)
    expect(indexResult.ok).toBe(false)
  })
})

describe('web handlers', () => {
  test('web-fetch converts HTML to readable text and removes page chrome', async () => {
    await withMockFetch(
      (async () =>
        new Response(
          '<header>menu</header><main><h1>Adnify &amp; Tools</h1><p>Useful text.</p></main><script>bad()</script>',
          { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
        )) as typeof fetch,
      async () => {
        const result = await handleWebFetch(
          request('web-fetch', { url: 'https://example.com/docs' }),
        )

        expect(result.ok).toBe(true)
        expect(result.content).toContain('Adnify & Tools')
        expect(result.content).toContain('Useful text.')
        expect(result.content).not.toContain('menu')
        expect(result.content).not.toContain('bad()')
      },
    )
  })

  test('web-fetch rejects non-http URLs before making a request', async () => {
    let called = false
    await withMockFetch(
      (async () => {
        called = true
        return new Response()
      }) as typeof fetch,
      async () => {
        const result = await handleWebFetch(
          request('web-fetch', { url: 'file:///etc/passwd' }),
        )

        expect(result.ok).toBe(false)
        expect(called).toBe(false)
      },
    )
  })

  test('web-search parses DuckDuckGo result links and respects the limit', async () => {
    await withMockFetch(
      (async () =>
        new Response(
          [
            '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone">First Result</a>',
            '<a class="result__snippet">First snippet</a>',
            '<a class="result__a" href="https://example.com/two">Second Result</a>',
            '<a class="result__snippet">Second snippet</a>',
          ].join(''),
          { status: 200, headers: { 'content-type': 'text/html' } },
        )) as typeof fetch,
      async () => {
        const result = await handleWebSearch(
          request('web-search', { query: 'adnify', limit: 1 }),
        )

        expect(result.ok).toBe(true)
        expect(result.content).toContain('https://example.com/one')
        expect(result.content).toContain('First snippet')
        expect(result.content).not.toContain('Second Result')
      },
    )
  })

  test('web-search reports upstream HTTP failures', async () => {
    await withMockFetch(
      (async () =>
        new Response('', { status: 503, statusText: 'Unavailable' })) as typeof fetch,
      async () => {
        const result = await handleWebSearch(
          request('web-search', { query: 'adnify' }),
        )

        expect(result.ok).toBe(false)
        expect(result.content).toContain('HTTP 503 Unavailable')
      },
    )
  })
})
