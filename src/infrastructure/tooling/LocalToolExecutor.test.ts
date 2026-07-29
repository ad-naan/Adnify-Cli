import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalToolExecutor } from './LocalToolExecutor'
import { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'
import type { ToolApprovalPort } from '../../application/ports/ToolApprovalPort'
import type {
  ToolActionIntent,
  ToolApprovalDecision,
} from '../../domain/tooling/value-objects/ToolApproval'

/** 只读用例复用仓库自身作为工作区，避免依赖某台机器上的绝对路径。 */
function createWorkspace(rootPath: string = process.cwd()) {
  return new WorkspaceContext({
    rootPath,
    isGitRepository: true,
    packageManager: 'bun',
    topLevelEntries: ['src', 'package.json'],
  })
}

/**
 * 写入类用例在临时目录里建独立工作区。
 * resolveWorkspacePath 会把路径锁在工作区内，所以临时目录必须作为 rootPath 传入。
 */
async function withTempWorkspace(
  run: (workspace: WorkspaceContext) => Promise<void>,
): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), 'adnify-tool-'))

  try {
    await run(createWorkspace(rootPath))
  } finally {
    await rm(rootPath, { recursive: true, force: true }).catch(() => {})
  }
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
    expect(result.content).toContain('Command is not allowed in this build')
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
    await withTempWorkspace(async (workspace) => {
      const executor = new LocalToolExecutor()
      const targetPath = 'tmp-write-check.txt'

      const result = await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"write","path":"${targetPath}","content":"hello from tool","allowWrite":true}`,
        workspace,
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain(`File written: ${targetPath}`)

      const readResult = await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"read","path":"${targetPath}"}`,
        workspace,
      })

      expect(readResult.ok).toBe(true)
      expect(readResult.content).toContain('hello from tool')
    })
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
    await withTempWorkspace(async (workspace) => {
      const executor = new LocalToolExecutor()
      const targetPath = 'tmp-update-check.ts'

      await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"write","path":"${targetPath}","content":"const value = 1;\\n","allowWrite":true}`,
        workspace,
      })

      const result = await executor.execute({
        toolId: 'file-ops',
        input:
          `{"action":"update","path":"${targetPath}","oldText":"const value = 1;","newText":"const value = 2;","allowWrite":true}`,
        workspace,
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain(`File updated: ${targetPath}`)

      const readResult = await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"read","path":"${targetPath}"}`,
        workspace,
      })

      expect(readResult.ok).toBe(true)
      expect(readResult.content).toContain('const value = 2;')
    })
  })

  test('should reject update when matches are ambiguous', async () => {
    await withTempWorkspace(async (workspace) => {
      const executor = new LocalToolExecutor()
      const targetPath = 'tmp-update-ambiguous.ts'

      await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"write","path":"${targetPath}","content":"item\\nitem\\n","allowWrite":true}`,
        workspace,
      })

      const result = await executor.execute({
        toolId: 'file-ops',
        input:
          `{"action":"update","path":"${targetPath}","oldText":"item","newText":"next","allowWrite":true}`,
        workspace,
      })

      expect(result.ok).toBe(false)
      expect(result.content).toContain('Expected 1 match')
    })
  })

  test('should patch all matches when replaceAll is enabled', async () => {
    await withTempWorkspace(async (workspace) => {
      const executor = new LocalToolExecutor()
      const targetPath = 'tmp-update-all.ts'

      await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"write","path":"${targetPath}","content":"a\\na\\na\\n","allowWrite":true}`,
        workspace,
      })

      const result = await executor.execute({
        toolId: 'file-ops',
        input:
          `{"action":"patch","path":"${targetPath}","oldText":"a","newText":"b","replaceAll":true,"allowWrite":true}`,
        workspace,
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain('Replacements: 3')

      const readResult = await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"read","path":"${targetPath}"}`,
        workspace,
      })

      expect(readResult.ok).toBe(true)
      expect(readResult.content).toContain('b\nb\nb')
    })
  })
})

describe('LocalToolExecutor approval gate', () => {
  /** 记录被问到的意图，并按预设决定作答。 */
  function createApprovalSpy(decision: ToolApprovalDecision) {
    const asked: ToolActionIntent[] = []

    return {
      asked,
      port: {
        async requestApproval(intent: ToolActionIntent) {
          asked.push(intent)
          return decision
        },
      } satisfies ToolApprovalPort,
    }
  }

  test('should not ask for approval on read-only file-ops', async () => {
    const approval = createApprovalSpy('denied')
    const executor = new LocalToolExecutor(approval.port)

    const result = await executor.execute({
      toolId: 'file-ops',
      input: '{"action":"read","path":"package.json"}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(true)
    expect(approval.asked).toHaveLength(0)
  })

  test('should ask for approval before writing and skip the write when denied', async () => {
    await withTempWorkspace(async (workspace) => {
      const approval = createApprovalSpy('denied')
      const executor = new LocalToolExecutor(approval.port)
      const targetPath = 'denied-write.txt'

      const result = await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"write","path":"${targetPath}","content":"nope","allowWrite":true}`,
        workspace,
      })

      expect(result.ok).toBe(false)
      expect(result.content).toContain('denied this operation')
      expect(approval.asked[0]).toMatchObject({
        toolId: 'file-ops',
        riskLevel: 'careful',
        targetPath,
      })

      // 文件不该被创建出来。
      const readResult = await executor.execute({
        toolId: 'file-ops',
        input: `{"action":"read","path":"${targetPath}"}`,
        workspace,
      })
      expect(readResult.ok).toBe(false)
    })
  })

  test('should perform the write once approved', async () => {
    await withTempWorkspace(async (workspace) => {
      const approval = createApprovalSpy('approved')
      const executor = new LocalToolExecutor(approval.port)

      const result = await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"write","path":"approved-write.txt","content":"ok","allowWrite":true}',
        workspace,
      })

      expect(result.ok).toBe(true)
      expect(approval.asked).toHaveLength(1)
    })
  })

  test('should ask for approval before running verification commands', async () => {
    const approval = createApprovalSpy('denied')
    const executor = new LocalToolExecutor(approval.port)

    const result = await executor.execute({
      toolId: 'shell-runner',
      input: '{"argv":["bun","test"]}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(approval.asked[0]).toMatchObject({ riskLevel: 'careful', summary: 'bun test' })
  })

  test('should run read-only shell commands without approval', async () => {
    const approval = createApprovalSpy('denied')
    const executor = new LocalToolExecutor(approval.port)

    await executor.execute({
      toolId: 'shell-runner',
      input: '{"argv":["git","status"]}',
      workspace: createWorkspace(),
    })

    expect(approval.asked).toHaveLength(0)
  })
})
