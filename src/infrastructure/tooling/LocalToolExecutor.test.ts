import { describe, expect, test } from 'bun:test'
import { unlink } from 'node:fs/promises'
import { LocalToolExecutor } from './LocalToolExecutor'
import { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'

function createWorkspace() {
  return new WorkspaceContext({
    rootPath: 'E:/26Project/Adnify-Cli',
    isGitRepository: true,
    packageManager: 'bun',
    topLevelEntries: ['src', 'package.json'],
  })
}

describe('LocalToolExecutor', () => {
  test('should reject unsupported shell commands', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'shell-runner',
      input: '{"argv":["del","foo.txt"]}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('requires explicit approval')
  })

  test('should allow approved workspace build or test commands', async () => {
    const executor = new LocalToolExecutor(async () => ({
      stdout: '1.3.6',
      stderr: '',
    }))

    const result = await executor.execute({
      toolId: 'shell-runner',
      input: '{"argv":["bun","--version"]}',
      workspace: createWorkspace(),
      approvalGranted: true,
    })

    expect(result.ok).toBe(true)
    expect(result.content).toContain('1.3.6')
  })

  test('should reject non-approved workspace build or test commands', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'shell-runner',
      input: '{"argv":["bun","--version"]}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('requires explicit approval')
  })

  test('should keep blocking shell interpreters even after approval', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'shell-runner',
      input: '{"argv":["powershell","-Command","Get-Date"]}',
      workspace: createWorkspace(),
      approvalGranted: true,
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('workspace development commands')
  })

  test('should validate shell-runner argv payload', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'shell-runner',
      input: '{}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('Missing required field "argv"')
  })

  test('should reject malformed tool input json without throwing', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'shell-runner',
      input: '{"argv":',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('valid JSON object')
  })

  test('should return workspace summary for workspace-read', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'workspace-read',
      input: '{"focus":"layout"}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(true)
    expect(result.content).toContain('Focus: layout')
    expect(result.content).toContain('Package manager: bun')
  })

  test('should validate web-fetch url payload', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'web-fetch',
      input: '{}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('Missing required field "url"')
  })

  test('should validate glob-search pattern payload', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'glob-search',
      input: '{}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('Missing required field "pattern"')
  })

  test('should return matching files for glob-search', async () => {
    const executor = new LocalToolExecutor()

      const result = await executor.execute({
        toolId: 'glob-search',
        input: '{"pattern":"src/**/*.test.ts","limit":20}',
        workspace: createWorkspace(),
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain('Pattern: src/**/*.test.ts')
      expect(result.content).toContain('src\\application\\i18n\\AppI18n.test.ts')
      expect(result.content).toContain('src\\infrastructure\\tooling\\LocalToolExecutor.test.ts')
  })

  test('should validate web-search query payload', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'web-search',
      input: '{}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('Missing required field "query"')
  })

  test('should return parsed results for web-search', async () => {
    const executor = new LocalToolExecutor()
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async () =>
      new Response(
        `
        <html>
          <body>
            <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>
            <a class="result__a" href="https://example.org/guide">Example Guide</a>
          </body>
        </html>
        `,
        {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      )) as typeof fetch

    try {
      const result = await executor.execute({
        toolId: 'web-search',
        input: '{"query":"terminal ui","limit":2}',
        workspace: createWorkspace(),
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain('Query: terminal ui')
      expect(result.content).toContain('1. Example Docs')
      expect(result.content).toContain('https://example.com/docs')
      expect(result.content).toContain('2. Example Guide')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('should fetch text content for web-fetch', async () => {
    const executor = new LocalToolExecutor()
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async () =>
      new Response('hello from docs', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })) as typeof fetch

    try {
      const result = await executor.execute({
        toolId: 'web-fetch',
        input: '{"url":"https://example.com/docs"}',
        workspace: createWorkspace(),
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain('URL: https://example.com/docs')
      expect(result.content).toContain('hello from docs')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('should reject binary-like responses for web-fetch', async () => {
    const executor = new LocalToolExecutor()
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async () =>
      new Response('fake-binary', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      })) as typeof fetch

    try {
      const result = await executor.execute({
        toolId: 'web-fetch',
        input: '{"url":"https://example.com/file.bin"}',
        workspace: createWorkspace(),
      })

      expect(result.ok).toBe(false)
      expect(result.content).toContain('Unsupported content type')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('should list a directory for file-ops', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'file-ops',
      input: '{"action":"list","path":"src"}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(true)
    expect(result.content).toContain('Directory: src')
  })

  test('should read a file for file-ops', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'file-ops',
      input: '{"action":"read","path":"package.json"}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(true)
    expect(result.content).toContain('File: package.json')
    expect(result.content).toContain('"name": "adnify-cli"')
  })

  test('should reject file-ops paths outside the workspace', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'file-ops',
      input: '{"action":"read","path":"../secret.txt"}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('inside the current workspace')
  })

  test('should require explicit allowWrite flag for file-ops write', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'file-ops',
      input: '{"action":"write","path":"tmp-write-check.txt","content":"hello"}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('allowWrite')
  })

  test('should write a text file for file-ops when explicitly allowed', async () => {
    const executor = new LocalToolExecutor()
    const targetPath = 'tmp-write-check.txt'

    try {
      const result = await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"write","path":"${targetPath}","content":"hello from tool","allowWrite":true}`,
        workspace: createWorkspace(),
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain(`File written: ${targetPath}`)

      const readResult = await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"read","path":"${targetPath}"}`,
        workspace: createWorkspace(),
      })

      expect(readResult.ok).toBe(true)
      expect(readResult.content).toContain('hello from tool')
    } finally {
      await unlink(`E:/26Project/Adnify-Cli/${targetPath}`).catch(() => {})
    }
  })

  test('should reject binary-like file writes in this build', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'file-ops',
      input: '{"action":"write","path":"image.png","content":"fake","allowWrite":true}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('text-like files')
  })

  test('should update a file with a single targeted replacement', async () => {
    const executor = new LocalToolExecutor()
    const targetPath = 'tmp-update-check.ts'

    try {
      await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"write","path":"${targetPath}","content":"const value = 1;\\n","allowWrite":true}`,
        workspace: createWorkspace(),
      })

      const result = await executor.execute({
        toolId: 'file-ops',
        input:
          `{"action":"update","path":"${targetPath}","oldText":"const value = 1;","newText":"const value = 2;","allowWrite":true}`,
        workspace: createWorkspace(),
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain(`File updated: ${targetPath}`)

      const readResult = await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"read","path":"${targetPath}"}`,
        workspace: createWorkspace(),
      })

      expect(readResult.ok).toBe(true)
      expect(readResult.content).toContain('const value = 2;')
    } finally {
      await unlink(`E:/26Project/Adnify-Cli/${targetPath}`).catch(() => {})
    }
  })

  test('should reject update when matches are ambiguous', async () => {
    const executor = new LocalToolExecutor()
    const targetPath = 'tmp-update-ambiguous.ts'

    try {
      await executor.execute({
        toolId: 'file-ops',
        input:
          `{"action":"write","path":"${targetPath}","content":"item\\nitem\\n","allowWrite":true}`,
        workspace: createWorkspace(),
      })

      const result = await executor.execute({
        toolId: 'file-ops',
        input:
          `{"action":"update","path":"${targetPath}","oldText":"item","newText":"next","allowWrite":true}`,
        workspace: createWorkspace(),
      })

      expect(result.ok).toBe(false)
      expect(result.content).toContain('Expected 1 match')
    } finally {
      await unlink(`E:/26Project/Adnify-Cli/${targetPath}`).catch(() => {})
    }
  })

  test('should patch all matches when replaceAll is enabled', async () => {
    const executor = new LocalToolExecutor()
    const targetPath = 'tmp-update-all.ts'

    try {
      await executor.execute({
        toolId: 'file-ops',
        input:
          `{"action":"write","path":"${targetPath}","content":"a\\na\\na\\n","allowWrite":true}`,
        workspace: createWorkspace(),
      })

      const result = await executor.execute({
        toolId: 'file-ops',
        input:
          `{"action":"patch","path":"${targetPath}","oldText":"a","newText":"b","replaceAll":true,"allowWrite":true}`,
        workspace: createWorkspace(),
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain('Replacements: 3')

      const readResult = await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"read","path":"${targetPath}"}`,
        workspace: createWorkspace(),
      })

      expect(readResult.ok).toBe(true)
      expect(readResult.content).toContain('b\nb\nb')
    } finally {
      await unlink(`E:/26Project/Adnify-Cli/${targetPath}`).catch(() => {})
    }
  })
})
