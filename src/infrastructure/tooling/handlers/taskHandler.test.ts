/// <reference path="../../../types/bun-test.d.ts" />
import { describe, expect, test } from 'bun:test'
import { formatTaskPreview, parseTaskRequest, runTaskBatch } from './taskHandler'
import type { ToolExecutionRequest } from '../../../application/ports/ToolExecutorPort'
import type { SubAgentOrchestratorPort } from '../../../domain/agent/SubAgentOrchestratorPort'
import { SubAgentTask } from '../../../domain/agent/SubAgentTask'
import { WorkspaceContext } from '../../../domain/workspace/entities/WorkspaceContext'

function createRequest(input: string): ToolExecutionRequest {
  return {
    toolId: 'task',
    input,
    workspace: new WorkspaceContext({
      rootPath: '/workspace',
      isGitRepository: true,
      packageManager: 'bun',
      topLevelEntries: ['src'],
    }),
  }
}

function parseOrThrow(input: string) {
  const parsed = parseTaskRequest(createRequest(input))
  if (!parsed.ok) {
    throw new Error(`expected input to parse: ${parsed.result.content}`)
  }
  return parsed.value
}

describe('parseTaskRequest', () => {
  test('accepts a minimal batch and defaults the concurrency', () => {
    const parsed = parseOrThrow(
      JSON.stringify({ tasks: [{ title: 'Audit logging', instruction: 'List every logger call.' }] }),
    )

    expect(parsed.tasks).toHaveLength(1)
    expect(parsed.tasks[0]?.title).toBe('Audit logging')
    expect(parsed.maxConcurrency).toBe(3)
  })

  test('clamps concurrency into the supported range', () => {
    expect(parseOrThrow(JSON.stringify({ tasks: [{ title: 'a', instruction: 'b' }], maxConcurrency: 99 })).maxConcurrency).toBe(4)
    expect(parseOrThrow(JSON.stringify({ tasks: [{ title: 'a', instruction: 'b' }], maxConcurrency: 0 })).maxConcurrency).toBe(1)
  })

  test('rejects a missing or empty task list', () => {
    expect(parseTaskRequest(createRequest('{}')).ok).toBe(false)
    expect(parseTaskRequest(createRequest(JSON.stringify({ tasks: [] }))).ok).toBe(false)
  })

  test('rejects a batch larger than the dispatch cap', () => {
    const tasks = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, instruction: 'do it' }))
    const parsed = parseTaskRequest(createRequest(JSON.stringify({ tasks })))

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.result.content).toContain('Too many subtasks')
    }
  })

  test('rejects a subtask missing its instruction', () => {
    // 子代理只能看到 instruction，空指令等于派了个必然失败的任务出去。
    const parsed = parseTaskRequest(
      createRequest(JSON.stringify({ tasks: [{ title: 'Nameless', instruction: '   ' }] })),
    )

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.result.content).toContain('missing "instruction"')
    }
  })

  test('ignores an unrecognised priority instead of failing the batch', () => {
    const parsed = parseOrThrow(
      JSON.stringify({ tasks: [{ title: 'a', instruction: 'b', priority: 'urgent' }] }),
    )

    expect(parsed.tasks[0]?.priority).toBeUndefined()
  })

  test('uses runtime task and concurrency limits', () => {
    const request = createRequest(JSON.stringify({
      tasks: [{ title: 'a', instruction: 'b' }, { title: 'c', instruction: 'd' }],
      maxConcurrency: 9,
    }))
    const parsed = parseTaskRequest(request, { maxTasks: 2, maxConcurrency: 7 })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.maxConcurrency).toBe(7)

    const rejected = parseTaskRequest(request, { maxTasks: 1, maxConcurrency: 7 })
    expect(rejected.ok).toBe(false)
  })

  test('accepts specialized sub-agent roles', () => {
    const parsed = parseOrThrow(
      JSON.stringify({ tasks: [{ title: 'review', instruction: 'audit it', role: 'review' }] }),
    )

    expect(parsed.tasks[0]?.role).toBe('review')
  })

  test('accepts an implementation-proposal role', () => {
    const parsed = parseOrThrow(
      JSON.stringify({ tasks: [{ title: 'implement', instruction: 'design the patch', role: 'implement' }] }),
    )

    expect(parsed.tasks[0]?.role).toBe('implement')
  })
})

describe('formatTaskPreview', () => {
  test('lists what will be dispatched so approval is informed', () => {
    const preview = formatTaskPreview(
      parseOrThrow(
        JSON.stringify({
          tasks: [
            { title: 'Audit logging', instruction: 'x' },
            { title: 'Audit errors', instruction: 'y' },
          ],
        }),
      ),
    )

    expect(preview).toContain('Dispatches 2 sub-agents')
    expect(preview).toContain('1. Audit logging')
    expect(preview).toContain('2. Audit errors')
    // 没有 implement 角色时，用户要明确知道这些任务保持只读。
    expect(preview).toContain('read-only workspace tools')
    expect(preview).toContain('cannot modify files')
  })

  test('explains disposable worktree isolation for implementation workers', () => {
    const preview = formatTaskPreview(
      parseOrThrow(
        JSON.stringify({
          tasks: [{ title: 'Implement auth', instruction: 'edit it', role: 'implement' }],
        }),
      ),
    )

    expect(preview).toContain('1 implementation worker')
    expect(preview).toContain('disposable Git worktrees')
    expect(preview).toContain('other roles remain read-only')
  })
})

/** 只驱动结果汇总，不碰真实模型。 */
function createOrchestrator(
  outcomes: Array<{ title: string; result?: string; error?: string }>,
): SubAgentOrchestratorPort {
  return {
    createTasks: (tasks) =>
      tasks.map((task, index) =>
        SubAgentTask.create({ id: `task-${index}`, title: task.title, instruction: task.instruction }),
      ),
    // 回调按真实编排器的时序发：开始一个、跑完一个。
    // 假实现若忽略 options，进度测试就只是在测它自己。
    runBatch: async (tasks, options) => {
      for (const task of tasks) {
        options.onTaskStart?.(task.id, task.title)
        const outcome = outcomes.find((candidate) => candidate.title === task.title)
        if (outcome?.result) {
          task.markCompleted(outcome.result)
        } else {
          task.markFailed(outcome?.error ?? 'no outcome configured')
        }
        options.onTaskComplete?.(task.id, task.status === 'completed', outcome?.result)
      }
      return tasks
    },
  }
}

describe('runTaskBatch', () => {
  const input = JSON.stringify({
    tasks: [
      { title: 'Audit logging', instruction: 'x' },
      { title: 'Audit errors', instruction: 'y' },
    ],
  })

  test('reports each subtask result under its own heading', async () => {
    const request = createRequest(input)
    const result = await runTaskBatch(
      request,
      parseOrThrow(input),
      createOrchestrator([
        { title: 'Audit logging', result: 'found 12 logger calls' },
        { title: 'Audit errors', result: 'found 3 swallowed errors' },
      ]),
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('2 succeeded, 0 failed')
    expect(result.content).toContain('found 12 logger calls')
    expect(result.content).toContain('found 3 swallowed errors')
  })

  test('stays successful when only some subtasks fail', async () => {
    const result = await runTaskBatch(
      createRequest(input),
      parseOrThrow(input),
      createOrchestrator([
        { title: 'Audit logging', result: 'found 12 logger calls' },
        { title: 'Audit errors', error: 'model timeout' },
      ]),
    )

    // 部分成功仍然有价值，模型可以就着拿到的那一半继续做。
    expect(result.ok).toBe(true)
    expect(result.content).toContain('1 succeeded, 1 failed')
    expect(result.content).toContain('model timeout')
  })

  test('fails the tool when every subtask fails', async () => {
    const result = await runTaskBatch(
      createRequest(input),
      parseOrThrow(input),
      createOrchestrator([
        { title: 'Audit logging', error: 'model timeout' },
        { title: 'Audit errors', error: 'model timeout' },
      ]),
    )

    // 全失败必须报 failed，否则模型会把一堆错误信息当成调研结论往下走。
    expect(result.ok).toBe(false)
    expect(result.content).toContain('0 succeeded, 2 failed')
  })

  test('reports progress as each subtask starts and finishes', async () => {
    const events: string[] = []
    const request = createRequest(input)
    request.onProgress = (event) => events.push(event.message)

    await runTaskBatch(
      request,
      parseOrThrow(input),
      createOrchestrator([
        { title: 'Audit logging', result: 'found 12 logger calls' },
        { title: 'Audit errors', error: 'model timeout' },
      ]),
    )

    // 没有这些进度，派一批子代理时界面会静默几十秒，跟卡死没法区分。
    expect(events).toContain('▸ started: Audit logging')
    expect(events).toContain('▸ started: Audit errors')
    // 完成通知带进度计数，用户能看出还剩几个。
    expect(events.some((message) => message.includes('✓ Audit logging (1/2)'))).toBe(true)
    expect(events.some((message) => message.includes('✗ Audit errors (2/2)'))).toBe(true)
  })

  test('flags a failed subtask so the transcript can style it', async () => {
    const flags: Array<boolean | undefined> = []
    const request = createRequest(input)
    request.onProgress = (event) => {
      if (event.message.startsWith('✓') || event.message.startsWith('✗')) {
        flags.push(event.ok)
      }
    }

    await runTaskBatch(
      request,
      parseOrThrow(input),
      createOrchestrator([
        { title: 'Audit logging', result: 'ok' },
        { title: 'Audit errors', error: 'model timeout' },
      ]),
    )

    expect(flags).toEqual([true, false])
  })

  test('runs fine when the caller does not listen for progress', async () => {
    // onProgress 是可选的，不传就该按老样子跑完。
    const result = await runTaskBatch(
      createRequest(input),
      parseOrThrow(input),
      createOrchestrator([
        { title: 'Audit logging', result: 'ok' },
        { title: 'Audit errors', result: 'ok' },
      ]),
    )

    expect(result.ok).toBe(true)
  })

  test('truncates an oversized subtask result and says how much was cut', async () => {
    const single = JSON.stringify({ tasks: [{ title: 'Audit logging', instruction: 'x' }] })
    const result = await runTaskBatch(
      createRequest(single),
      parseOrThrow(single),
      createOrchestrator([{ title: 'Audit logging', result: 'x'.repeat(2500) }]),
    )

    // 8 个子任务的完整输出足以吃掉整个上下文窗口。
    expect(result.content).toContain('characters omitted')
    expect(result.content.length).toBeLessThan(2500)
  })
})
