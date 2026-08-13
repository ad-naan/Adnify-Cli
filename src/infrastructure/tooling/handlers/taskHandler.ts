import type { SubAgentOrchestratorPort } from '../../../domain/agent/SubAgentOrchestratorPort'
import type { SubAgentPriority, SubAgentRole, SubAgentTask } from '../../../domain/agent/SubAgentTask'
import type { ToolExecutionRequest, ToolExecutionResult } from '../../../application/ports/ToolExecutorPort'
import { parseJsonObject } from '../toolPathGuard'
import { toolFailure, toolSuccess } from './ToolHandler'

const DEFAULT_CONCURRENCY = 3

/** 单个子任务结果的回填上限 —— 8 个子任务的完整输出足以吃掉整个上下文窗口。 */
const MAX_RESULT_CHARS = 2000

interface ParsedTaskRequest {
  tasks: Array<{
    title: string
    instruction: string
    contextSummary?: string
    priority?: SubAgentPriority
    role?: SubAgentRole
  }>
  maxConcurrency: number
}

export type ParseTaskResult =
  | { ok: true; value: ParsedTaskRequest }
  | { ok: false; result: ToolExecutionResult }

function parsePriority(value: unknown): SubAgentPriority | undefined {
  return value === 'low' || value === 'normal' || value === 'high' ? value : undefined
}

function parseRole(value: unknown): SubAgentRole | undefined {
  return value === 'general' || value === 'explore' || value === 'review' || value === 'test' || value === 'implement'
    ? value
    : undefined
}

/**
 * 解析 task 工具的入参。
 * 与其他 handler 一样，解析和执行分开 —— LocalToolExecutor 需要先拿到解析结果
 * 才能判断审批时该给用户看什么。
 */
export function parseTaskRequest(
  request: ToolExecutionRequest,
  limits: { maxTasks: number; maxConcurrency: number } = { maxTasks: 8, maxConcurrency: 4 },
): ParseTaskResult {
  const prompt = parseJsonObject(request.input)
  const rawTasks = prompt.tasks

  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    return {
      ok: false,
      result: toolFailure(request.toolId, 'Missing required field "tasks" (a non-empty array).'),
    }
  }

  if (rawTasks.length > limits.maxTasks) {
    return {
      ok: false,
      result: toolFailure(
        request.toolId,
        `Too many subtasks: ${rawTasks.length}. At most ${limits.maxTasks} may be dispatched at once.`,
      ),
    }
  }

  const tasks: ParsedTaskRequest['tasks'] = []

  for (const [index, entry] of rawTasks.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        ok: false,
        result: toolFailure(request.toolId, `Subtask ${index + 1} is not an object.`),
      }
    }

    const candidate = entry as Record<string, unknown>
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
    const instruction =
      typeof candidate.instruction === 'string' ? candidate.instruction.trim() : ''

    if (!title) {
      return {
        ok: false,
        result: toolFailure(request.toolId, `Subtask ${index + 1} is missing "title".`),
      }
    }

    if (!instruction) {
      return {
        ok: false,
        result: toolFailure(request.toolId, `Subtask "${title}" is missing "instruction".`),
      }
    }

    const contextSummary =
      typeof candidate.contextSummary === 'string' && candidate.contextSummary.trim()
        ? candidate.contextSummary.trim()
        : undefined

    tasks.push({
      title,
      instruction,
      contextSummary,
      priority: parsePriority(candidate.priority),
      role: parseRole(candidate.role),
    })
  }

  const rawConcurrency = prompt.maxConcurrency
  const maxConcurrency =
    typeof rawConcurrency === 'number' && Number.isFinite(rawConcurrency)
      ? Math.max(1, Math.min(limits.maxConcurrency, Math.trunc(rawConcurrency)))
      : Math.min(DEFAULT_CONCURRENCY, limits.maxConcurrency)

  return { ok: true, value: { tasks, maxConcurrency } }
}

/** 审批面板上展示派了哪些活 —— 子代理会真的去打模型 API，用户有权先看一眼。 */
export function formatTaskPreview(parsed: ParsedTaskRequest): string {
  const lines = parsed.tasks.map((task, index) => `${index + 1}. ${task.title}`)
  const implementationCount = parsed.tasks.filter((task) => task.role === 'implement').length
  const isolationSummary = implementationCount > 0
    ? `${implementationCount} implementation worker${implementationCount === 1 ? '' : 's'} will edit and verify in disposable Git worktrees; other roles remain read-only.`
    : 'All workers use read-only workspace tools and cannot modify files or run shell commands.'

  return [
    `Dispatches ${parsed.tasks.length} sub-agent${parsed.tasks.length === 1 ? '' : 's'} (up to ${parsed.maxConcurrency} at a time):`,
    ...lines,
    '',
    isolationSummary,
  ].join('\n')
}

function truncateResult(content: string): string {
  const normalized = content.trim()
  if (normalized.length <= MAX_RESULT_CHARS) {
    return normalized
  }

  const omitted = normalized.length - MAX_RESULT_CHARS

  return `${normalized.slice(0, MAX_RESULT_CHARS)}\n\n[truncated: ${omitted} of ${normalized.length} characters omitted]`
}

function formatReport(finished: SubAgentTask[]): string {
  const succeeded = finished.filter((task) => task.status === 'completed')
  const failed = finished.filter((task) => task.status !== 'completed')

  const sections = finished.map((task) => {
    if (task.status === 'completed' && task.result) {
      return [`### ${task.title} — ok`, truncateResult(task.result)].join('\n')
    }

    return [`### ${task.title} — failed`, task.error ?? 'No result returned.'].join('\n')
  })

  return [
    `Ran ${finished.length} subtask${finished.length === 1 ? '' : 's'}: ${succeeded.length} succeeded, ${failed.length} failed.`,
    '',
    ...sections,
  ].join('\n')
}

/**
 * 执行一批子任务并汇总结果。
 *
 * 子代理拿不到工具，只能读指令、给结论 —— 这是刻意的：一旦子代理能调工具，
 * 它就绕过了主循环里的审批面板，用户会在毫不知情的情况下被写文件、跑命令。
 */
export async function runTaskBatch(
  request: ToolExecutionRequest,
  parsed: ParsedTaskRequest,
  orchestrator: SubAgentOrchestratorPort,
): Promise<ToolExecutionResult> {
  const created = orchestrator.createTasks(parsed.tasks)
  const total = created.length
  let done = 0

  for (const task of created) {
    request.onProgress?.({
      toolId: request.toolId,
      message: `queued: ${task.title}`,
      task: { id: task.id, title: task.title, status: 'pending' },
    })
  }

  const finished = await orchestrator.runBatch(created, {
    maxConcurrency: parsed.maxConcurrency,
    workspace: request.workspace,
    abortSignal: request.abortSignal,
    // 把编排器的进度转成给人看的一行字。
    // 少了这一步，派一批子代理时界面会静默几十秒，跟卡死没法区分。
    onTaskStart: (_taskId, title) => {
      request.onProgress?.({
        toolId: request.toolId,
        message: `▸ started: ${title}`,
        task: { id: _taskId, title, status: 'running' },
      })
    },
    onTaskComplete: (taskId, success) => {
      done += 1
      const title = created.find((task) => task.id === taskId)?.title ?? taskId
      request.onProgress?.({
        toolId: request.toolId,
        ok: success,
        message: `${success ? '✓' : '✗'} ${title} (${done}/${total})`,
        task: { id: taskId, title, status: success ? 'completed' : 'failed' },
      })
    },
  })

  request.onProgress?.({
    toolId: request.toolId,
    message: 'task batch complete',
    task: { id: request.toolId, title: '', status: 'clear' },
  })

  // 全军覆没时报失败，模型才知道要换个方式，而不是把一堆空结果当成答案往下走。
  const anySucceeded = finished.some((task) => task.status === 'completed')
  const report = formatReport(finished)

  return anySucceeded
    ? toolSuccess(request.toolId, report)
    : toolFailure(request.toolId, report)
}
