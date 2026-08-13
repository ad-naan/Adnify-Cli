import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalToolExecutor } from './LocalToolExecutor'
import { CheckpointManager } from '../checkpoint/CheckpointManager'
import { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'
import type { ToolApprovalPort } from '../../application/ports/ToolApprovalPort'
import type {
  ToolActionIntent,
  ToolApprovalDecision,
} from '../../domain/tooling/value-objects/ToolApproval'
import { ConversationSession } from '../../domain/session/aggregates/ConversationSession'
import type { RuntimeControlPort } from '../../application/ports/RuntimeControlPort'
import { MutableRuntimeBudget } from '../runtime/MutableRuntimeBudget'

/** 检查点用例不关心日志输出。 */
const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

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

function createRuntimeApprovalSpy(decision: ToolApprovalDecision) {
  const asked: ToolActionIntent[] = []
  const port: ToolApprovalPort = {
    async requestApproval(intent) {
      asked.push(intent)
      return decision
    },
  }
  return { port, asked }
}

describe('LocalToolExecutor', () => {
  test('requires approval before applying an AI-proposed session budget', async () => {
    const approval = createRuntimeApprovalSpy('approved')
    const budget = new MutableRuntimeBudget()
    const runtimeControl: RuntimeControlPort = {
      inspect: () => '{}',
      getPermissionMode: () => 'workspace',
      setPermissionMode: async () => {},
      setAnimationLevel: async () => {},
      setLocale: async () => {},
      switchModel: () => null,
      getRuntimeBudget: () => budget.get(),
      setRuntimeBudget: (patch) => budget.update(patch),
    }
    const executor = new LocalToolExecutor(
      approval.port, undefined, undefined, undefined, () => 'workspace', undefined, runtimeControl, budget,
    )

    const result = await executor.execute({
      toolId: 'runtime-control',
      input: '{"action":"set-runtime-budget","budget":{"maxStepsPerTurn":40,"maxModelRetries":4},"rationale":"complex migration"}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(true)
    expect(budget.get().maxStepsPerTurn).toBe(40)
    expect(budget.get().maxModelRetries).toBe(4)
    expect(approval.asked).toHaveLength(1)
    expect(approval.asked[0]?.scope).toBe('protected')
  })

  test('lets AI apply low-risk runtime preferences without approval', async () => {
    const approval = createRuntimeApprovalSpy('denied')
    let animation = 'full'
    const runtimeControl: RuntimeControlPort = {
      inspect: () => '{}',
      getPermissionMode: () => 'workspace',
      setPermissionMode: async () => {},
      setAnimationLevel: async (level) => { animation = level },
      setLocale: async () => {},
      switchModel: () => null,
    }
    const executor = new LocalToolExecutor(
      approval.port, undefined, undefined, undefined, () => 'workspace', undefined, runtimeControl,
    )

    const result = await executor.execute({
      toolId: 'runtime-control',
      input: '{"action":"set-animation","value":"minimal","rationale":"reduce terminal motion"}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(true)
    expect(animation).toBe('minimal')
    expect(approval.asked).toHaveLength(0)
  })

  test('requires keyboard approval before AI increases the permission mode', async () => {
    const approval = createRuntimeApprovalSpy('approved')
    let permission: 'manual' | 'workspace' | 'auto' | 'plan' = 'workspace'
    const runtimeControl: RuntimeControlPort = {
      inspect: () => '{}',
      getPermissionMode: () => permission,
      setPermissionMode: async (mode) => { permission = mode },
      setAnimationLevel: async () => {},
      setLocale: async () => {},
      switchModel: () => null,
    }
    const executor = new LocalToolExecutor(
      approval.port, undefined, undefined, undefined, () => permission, undefined, runtimeControl,
    )

    const result = await executor.execute({
      toolId: 'runtime-control',
      input: '{"action":"set-permission-mode","value":"auto","rationale":"run the verified migration"}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(true)
    expect(permission).toBe('auto')
    expect(approval.asked[0]?.scope).toBe('protected')
  })

  test('lets AI lower assistant capability but asks before leaving explicit plan mode', async () => {
    const approval = createRuntimeApprovalSpy('approved')
    const runtimeControl: RuntimeControlPort = {
      inspect: () => '{}',
      getPermissionMode: () => 'workspace',
      setPermissionMode: async () => {},
      setAnimationLevel: async () => {},
      setLocale: async () => {},
      switchModel: () => null,
    }
    const executor = new LocalToolExecutor(
      approval.port, undefined, undefined, undefined, () => 'workspace', undefined, runtimeControl,
    )
    const session = ConversationSession.create({
      id: 'runtime-session', title: 'test', mode: 'plan', workspacePath: process.cwd(), createdAt: new Date(),
    })

    const result = await executor.execute({
      toolId: 'runtime-control',
      input: '{"action":"set-assistant-mode","value":"agent","rationale":"begin implementation"}',
      workspace: createWorkspace(),
      session,
    })

    expect(result.ok).toBe(true)
    expect(session.mode).toBe('agent')
    expect(approval.asked).toHaveLength(1)
  })

  test('uses one approval to leave plan restrictions and begin execution', async () => {
    const approval = createRuntimeApprovalSpy('approved')
    let permission: 'manual' | 'workspace' | 'auto' | 'plan' = 'plan'
    const runtimeControl: RuntimeControlPort = {
      inspect: () => '{}',
      getPermissionMode: () => permission,
      setPermissionMode: async (mode) => { permission = mode },
      setAnimationLevel: async () => {},
      setLocale: async () => {},
      switchModel: () => null,
    }
    const executor = new LocalToolExecutor(
      approval.port, undefined, undefined, undefined, () => permission, undefined, runtimeControl,
    )
    const session = ConversationSession.create({
      id: 'begin-execution', title: 'test', mode: 'plan', workspacePath: process.cwd(), createdAt: new Date(),
    })

    const result = await executor.execute({
      toolId: 'runtime-control',
      input: '{"action":"begin-execution","rationale":"create the requested file"}',
      workspace: createWorkspace(),
      session,
    })

    expect(result.ok).toBe(true)
    expect(session.mode).toBe('agent')
    expect(permission).toBe('workspace')
    expect(approval.asked).toHaveLength(1)
  })

  test('should reject unsupported shell commands', async () => {
    const executor = new LocalToolExecutor()

    const result = await executor.execute({
      toolId: 'shell-runner',
      input: '{"argv":["del","foo.txt"]}',
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('Command is not allowed')
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

  test('should route ask-user through the interactive choice port', async () => {
    const executor = new LocalToolExecutor(
      undefined,
      undefined,
      undefined,
      undefined,
      () => 'workspace',
      {
        requestChoices: async () => [{ questionId: 'scope', selectedIndex: 0, label: 'Small' }],
      },
    )
    const result = await executor.execute({
      toolId: 'ask-user',
      input: JSON.stringify({
        questions: [{
          id: 'scope',
          header: 'Scope',
          question: 'Choose scope',
          options: [
            { label: 'Small', description: 'Minimal' },
            { label: 'Full', description: 'Complete' },
          ],
        }],
      }),
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(true)
    expect(result.content).toContain('Small')
  })

  test('should auto-approve workspace edits in workspace mode', async () => {
    await withTempWorkspace(async (workspace) => {
      const approval = createApprovalSpy('denied')
      const executor = new LocalToolExecutor(
        approval.port,
        undefined,
        undefined,
        undefined,
        () => 'workspace',
      )
      const result = await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"write","path":"src/auto.ts","content":"export {}","allowWrite":true}',
        workspace,
      })

      expect(result.ok).toBe(true)
      expect(approval.asked).toHaveLength(0)
    })
  })

  test('should still ask for protected workspace files in auto mode', async () => {
    await withTempWorkspace(async (workspace) => {
      const approval = createApprovalSpy('denied')
      const executor = new LocalToolExecutor(
        approval.port,
        undefined,
        undefined,
        undefined,
        () => 'auto',
      )
      const result = await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"write","path":".env","content":"TOKEN=x","allowWrite":true}',
        workspace,
      })

      expect(result.ok).toBe(false)
      expect(approval.asked[0]?.scope).toBe('protected')
    })
  })

  test('should block file mutations without prompting in plan mode', async () => {
    await withTempWorkspace(async (workspace) => {
      const approval = createApprovalSpy('approved')
      const executor = new LocalToolExecutor(
        approval.port,
        undefined,
        undefined,
        undefined,
        () => 'plan',
      )
      const result = await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"write","path":"blocked.ts","content":"x","allowWrite":true}',
        workspace,
      })

      expect(result.ok).toBe(false)
      expect(result.content).toContain('plan')
      expect(approval.asked).toHaveLength(0)
    })
  })

  test('should require approval for an absolute path outside the workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'adnify-workspace-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'adnify-outside-'))
    const outsideFile = join(outsideRoot, 'notes.txt')
    await writeFile(outsideFile, 'outside evidence', 'utf8')

    try {
      const approval = createApprovalSpy('approved')
      const executor = new LocalToolExecutor(
        approval.port,
        undefined,
        undefined,
        undefined,
        () => 'workspace',
      )
      const result = await executor.execute({
        toolId: 'file-ops',
        input: JSON.stringify({ action: 'read', path: outsideFile }),
        workspace: createWorkspace(workspaceRoot),
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain('outside evidence')
      expect(approval.asked[0]).toMatchObject({ scope: 'outside', targetPath: outsideFile })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
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

  test('should snapshot the previous content before an approved overwrite', async () => {
    await withTempWorkspace(async (workspace) => {
      const approval = createApprovalSpy('approved')
      const checkpoints = new CheckpointManager(workspace.rootPath, silentLogger as never)
      const executor = new LocalToolExecutor(approval.port, undefined, checkpoints)

      await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"write","path":"tracked.txt","content":"first","allowWrite":true}',
        workspace,
      })
      await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"write","path":"tracked.txt","content":"second","allowWrite":true}',
        workspace,
        sessionId: 'session-checkpoint',
      })

      // The newest snapshot holds the content as it was before the second write.
      const snapshots = checkpoints.listSnapshots()
      expect(snapshots.length).toBe(2)
      expect(snapshots[0].entries[0]).toMatchObject({
        relativePath: 'tracked.txt',
        originalContent: 'first',
      })
      expect(snapshots[0].metadata).toMatchObject({
        sessionId: 'session-checkpoint',
        toolId: 'file-ops',
      })
      expect(snapshots[0].metadata?.toolInput).toContain('tracked.txt')

      // Rolling it back returns the file to its pre-overwrite state.
      checkpoints.restore(snapshots[0].id)
      const readBack = await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"read","path":"tracked.txt"}',
        workspace,
      })
      expect(readBack.content).toContain('first')
    })
  })

  test('should discard the snapshot when an approved mutation fails validation', async () => {
    await withTempWorkspace(async (workspace) => {
      const approval = createApprovalSpy('approved')
      const checkpoints = new CheckpointManager(workspace.rootPath, silentLogger as never)
      const executor = new LocalToolExecutor(approval.port, undefined, checkpoints)

      const result = await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"update","path":"missing.txt","oldText":"before","newText":"after","allowWrite":true}',
        workspace,
      })

      expect(result.ok).toBe(false)
      expect(checkpoints.listSnapshots()).toHaveLength(0)
    })
  })

  test('should not snapshot when the write is denied', async () => {
    await withTempWorkspace(async (workspace) => {
      const approval = createApprovalSpy('denied')
      const checkpoints = new CheckpointManager(workspace.rootPath, silentLogger as never)
      const executor = new LocalToolExecutor(approval.port, undefined, checkpoints)

      await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"write","path":"denied.txt","content":"nope","allowWrite":true}',
        workspace,
      })

      expect(checkpoints.listSnapshots()).toHaveLength(0)
    })
  })

  test('should not snapshot on read-only file-ops', async () => {
    await withTempWorkspace(async (workspace) => {
      const approval = createApprovalSpy('approved')
      const checkpoints = new CheckpointManager(workspace.rootPath, silentLogger as never)
      const executor = new LocalToolExecutor(approval.port, undefined, checkpoints)

      await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"list","path":"."}',
        workspace,
      })

      expect(checkpoints.listSnapshots()).toHaveLength(0)
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

  test('should ask for approval before dispatching sub-agents', async () => {
    const approval = createApprovalSpy('denied')
    let ran = false
    const executor = new LocalToolExecutor(approval.port, undefined, undefined, () => ({
      createTasks: () => [],
      runBatch: async (tasks) => {
        ran = true
        return tasks
      },
    }))

    const result = await executor.execute({
      toolId: 'task',
      input: JSON.stringify({ tasks: [{ title: 'Audit logging', instruction: 'x' }] }),
      workspace: createWorkspace(),
    })

    // 子代理会真的去打模型 API，所以必须先过审批。
    expect(approval.asked[0]).toMatchObject({ riskLevel: 'careful' })
    expect(approval.asked[0]?.preview).toContain('Audit logging')
    expect(result.ok).toBe(false)
    // 被拒之后一个子任务都不该跑起来。
    expect(ran).toBe(false)
  })

  test('should fail the task tool when no model is configured', async () => {
    const approval = createApprovalSpy('approved')
    // 没配 API key 时 resolver 返回 undefined。
    const executor = new LocalToolExecutor(approval.port, undefined, undefined, () => undefined)

    const result = await executor.execute({
      toolId: 'task',
      input: JSON.stringify({ tasks: [{ title: 'Audit logging', instruction: 'x' }] }),
      workspace: createWorkspace(),
    })

    expect(result.ok).toBe(false)
    expect(result.content).toContain('no model is configured')
    // 拿不到编排器就不该弹审批 —— 弹了也只是让用户批准一件做不成的事。
    expect(approval.asked).toHaveLength(0)
  })

  test('should not count approval thinking time against the execution timeout', async () => {
    await withTempWorkspace(async (workspace) => {
      // 真人在审批面板上斟酌的时间不该算进「工具跑了多久」。
      // 这里模拟一个慢决定：批准前先拖一会儿，写入仍然必须落盘。
      const slowApproval: ToolApprovalPort = {
        async requestApproval() {
          await new Promise((resolve) => setTimeout(resolve, 120))
          return 'approved'
        },
      }
      const executor = new LocalToolExecutor(slowApproval)

      const result = await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"write","path":"slow-approval.txt","content":"landed","allowWrite":true}',
        workspace,
      })

      expect(result.ok).toBe(true)

      const readBack = await executor.execute({
        toolId: 'file-ops',
        input: '{"action":"read","path":"slow-approval.txt"}',
        workspace,
      })
      expect(readBack.content).toContain('landed')
    })
  })
})
