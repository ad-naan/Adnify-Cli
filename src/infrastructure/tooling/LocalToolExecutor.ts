import { relative } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { ToolApprovalPort } from '../../application/ports/ToolApprovalPort'
import type {
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutorPort,
} from '../../application/ports/ToolExecutorPort'
import {
  classifyFileOpsRisk,
  requiresApproval,
} from '../../domain/tooling/services/ToolApprovalPolicy'
import type {
  ToolActionIntent,
  ToolApprovalDecision,
} from '../../domain/tooling/value-objects/ToolApproval'
import { isApprovedDecision } from '../../domain/tooling/value-objects/ToolApproval'
import { ToolExecutionDeadline } from './ToolExecutionDeadline'
import { autoApproveToolApproval } from './PendingToolApprovalAdapter'
import { parseFileOpsRequest, runFileOps, type FileOpsRequest } from './handlers/fileOpsHandler'
import { handleSearchIndex } from './handlers/searchIndexHandler'
import { formatShellCommandEffect } from './classifyShellCommand'
import { parseShellRunnerRequest, runShellCommand } from './handlers/shellRunnerHandler'
import { toolFailure } from './handlers/ToolHandler'
import { replaceFirst } from './toolPathGuard'
import { handleWorkspaceRead } from './handlers/workspaceReadHandler'
import { handleGlobSearch } from './handlers/globSearchHandler'
import { handleWebFetch } from './handlers/webFetchHandler'
import { handleWebSearch } from './handlers/webSearchHandler'
import { formatTaskPreview, parseTaskRequest, runTaskBatch } from './handlers/taskHandler'
import type { McpRegistry } from '../mcp/McpClient'
import type { CheckpointManager } from '../checkpoint/CheckpointManager'
import type { SubAgentOrchestratorPort } from '../../domain/agent/SubAgentOrchestratorPort'
import { computeDiffStats, computeLineDiff, formatDiffAsText } from '../diff/DiffEngine'

/**
 * 工具调度入口。
 *
 * 分派到 handler，并在动作真正发生前统一做审批判定 —— 审批集中在这一层，
 * 因为只有解析完 payload 才知道「这是读还是写」「这条命令具体是什么」。
 * MCP 工具（mcp__前缀）委托给 McpRegistry 处理。
 *
 * 每次执行都有超时保护，防止卡死 agent 循环。计时只在真正干活时流逝，
 * 等用户审批的那段不算 —— 详见 ToolExecutionDeadline。
 */
const TOOL_EXECUTION_TIMEOUT_MS = 30_000

/**
 * task 的预算单独放大。
 *
 * 一次批次要串起若干次完整的模型往返，而单次请求本身已经被 gateway 的
 * `config.timeoutMs`（默认 60s）各自兜住了，批次不会无限悬着。
 * 沿用 30s 的话，任何真实的子代理派发都会在第一个子任务答完之前就被杀掉。
 */
const TASK_EXECUTION_TIMEOUT_MS = 10 * 60_000

function resolveTimeoutMs(toolId: string): number {
  return toolId === 'task' ? TASK_EXECUTION_TIMEOUT_MS : TOOL_EXECUTION_TIMEOUT_MS
}

/** file-ops 中会改动磁盘的动作 —— 只有这些需要事前快照。 */
const MUTATING_FILE_OPS = new Set(['write', 'update', 'patch'])

export class LocalToolExecutor implements ToolExecutorPort {
  constructor(
    private readonly approval: ToolApprovalPort = autoApproveToolApproval,
    private readonly mcpRegistry?: McpRegistry,
    private readonly checkpoints?: CheckpointManager,
    /**
     * 取子代理编排器。
     *
     * 传的是函数而不是实例：executor 在 gateway 之前就构造好了，而 gateway 还会随
     * `:model` 切换被替换掉。直接存实例会让 task 工具一直用着旧模型的网关。
     * 返回 undefined 表示当前没配 API key —— 此时 task 工具报错而不是静默失败。
     */
    private readonly resolveSubAgents?: () => SubAgentOrchestratorPort | undefined,
  ) {}

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const deadline = new ToolExecutionDeadline(resolveTimeoutMs(request.toolId))

    try {
      return await Promise.race([
        this.executeInner(request, deadline),
        deadline.expired.then(() => toolFailure(request.toolId, deadline.describeTimeout())),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return toolFailure(request.toolId, `Tool execution error: ${message}`)
    } finally {
      // 无论走哪条路都要清掉定时器，否则事件循环会被残留的 timer 按住。
      deadline.dispose()
    }
  }

  private async executeInner(
    request: ToolExecutionRequest,
    deadline: ToolExecutionDeadline,
  ): Promise<ToolExecutionResult> {
    // MCP tools are routed to the McpRegistry
    if (request.toolId.startsWith('mcp__') && this.mcpRegistry) {
      const mcpResult = await this.mcpRegistry.executeTool(request)
      if (mcpResult) {
        return mcpResult
      }
      return toolFailure(request.toolId, `MCP tool "${request.toolId}" is not registered.`)
    }

    switch (request.toolId) {
      case 'workspace-read':
        return handleWorkspaceRead(request)
      case 'search-index':
        return handleSearchIndex(request)
      case 'glob-search':
        return handleGlobSearch(request)
      case 'web-search':
        return handleWebSearch(request)
      case 'web-fetch':
        return handleWebFetch(request)
      case 'file-ops':
        return this.executeFileOps(request, deadline)
      case 'shell-runner':
        return this.executeShellRunner(request, deadline)
      case 'task':
        return this.executeTask(request, deadline)
      default:
        return toolFailure(request.toolId, `Tool "${request.toolId}" is not implemented yet.`)
    }
  }

  private async executeFileOps(
    request: ToolExecutionRequest,
    deadline: ToolExecutionDeadline,
  ): Promise<ToolExecutionResult> {
    const parsed = parseFileOpsRequest(request)
    if (!parsed.ok) {
      return parsed.result
    }

    const { action, resolvedPath } = parsed.value
    const targetPath = toRelativePath(request.workspace.rootPath, resolvedPath)
    const denial = await this.ensureApproved(
      {
        toolId: request.toolId,
        riskLevel: classifyFileOpsRisk(action),
        summary: `${action} ${targetPath}`,
        targetPath,
        preview: await buildFileOpsPreview(parsed.value, targetPath),
      },
      deadline,
    )

    if (denial) {
      return denial
    }

    // Snapshot the pre-write state so a single tool call can be rolled back later.
    // Taken after approval (no snapshot for a denied write) and before the write lands.
    if (this.checkpoints && MUTATING_FILE_OPS.has(action)) {
      try {
        this.checkpoints.captureBeforeWrite(targetPath, `file-ops ${action} ${targetPath}`)
      } catch {
        // A failed snapshot must not block the write the user already approved.
      }
    }

    return runFileOps(parsed.value)
  }

  private async executeShellRunner(
    request: ToolExecutionRequest,
    deadline: ToolExecutionDeadline,
  ): Promise<ToolExecutionResult> {
    const parsed = parseShellRunnerRequest(request)
    if (!parsed.ok) {
      return parsed.result
    }

    const { riskLevel, summary, effect } = parsed.value.classification
    const denial = await this.ensureApproved(
      {
        toolId: request.toolId,
        riskLevel,
        summary,
        // 命令风险展开：光一个 careful 标签说明不了批准之后会发生什么，
        // `git add` 和 `git reset --hard` 在面板上长得一模一样。
        preview: formatShellCommandEffect(effect),
      },
      deadline,
    )

    return denial ?? runShellCommand(parsed.value)
  }

  private async executeTask(
    request: ToolExecutionRequest,
    deadline: ToolExecutionDeadline,
  ): Promise<ToolExecutionResult> {
    const orchestrator = this.resolveSubAgents?.()
    if (!orchestrator) {
      return toolFailure(
        request.toolId,
        'Sub-agents are unavailable because no model is configured. Do the work directly instead.',
      )
    }

    const parsed = parseTaskRequest(request)
    if (!parsed.ok) {
      return parsed.result
    }

    const denial = await this.ensureApproved(
      {
        toolId: request.toolId,
        riskLevel: 'careful',
        summary: `dispatch ${parsed.value.tasks.length} sub-agent task(s)`,
        preview: formatTaskPreview(parsed.value),
      },
      deadline,
    )

    return denial ?? runTaskBatch(request, parsed.value, orchestrator)
  }

  /**
   * 需要审批时等待用户决定。
   * 被拒绝时返回失败结果而不是抛异常 —— 模型能读到拒绝原因并改用别的方案，整轮对话不中断。
   *
   * 等人期间停表：真人在面板上斟酌的时间不该算作「工具跑了多久」，
   * 否则想久一点，一个已经批准的写入反而以超时收场。
   */
  private async ensureApproved(
    intent: ToolActionIntent,
    deadline?: ToolExecutionDeadline,
  ): Promise<ToolExecutionResult | null> {
    if (!requiresApproval(intent)) {
      return null
    }

    deadline?.pause()
    let decision: ToolApprovalDecision
    try {
      decision = await this.approval.requestApproval(intent)
    } finally {
      deadline?.resume()
    }

    if (isApprovedDecision(decision)) {
      return null
    }

    return toolFailure(
      intent.toolId,
      `The user denied this operation: ${intent.summary}. Do not retry it; explain the situation or propose a different approach.`,
    )
  }
}

function toRelativePath(rootPath: string, resolvedPath: string): string {
  return relative(rootPath, resolvedPath) || '.'
}

/**
 * 为待批准的写入构造 diff 预览。
 *
 * 这里算的是「还没落盘的改动」—— git diff 此刻看不到任何东西，
 * 所以必须自己把新旧内容对比出来。
 *
 * 返回完整 diff，不在这一层截断：终端有多高只有 presentation 知道，
 * 在基础设施层写死行数，换个窗口大小就是错的。折叠交给审批面板做。
 *
 * 任何失败都退化为「没有预览」，绝不因为预览算不出来就挡住写入。
 */
async function buildFileOpsPreview(
  parsed: FileOpsRequest,
  targetPath: string,
): Promise<string | undefined> {
  const { action, prompt, resolvedPath } = parsed

  if (!MUTATING_FILE_OPS.has(action)) {
    return undefined
  }

  try {
    const currentContent = await readFile(resolvedPath, 'utf8').catch(() => null)

    let nextContent: string | null = null

    if (action === 'write') {
      nextContent = typeof prompt.content === 'string' ? prompt.content : null
    } else {
      const oldText = typeof prompt.oldText === 'string' ? prompt.oldText : null
      const newText = typeof prompt.newText === 'string' ? prompt.newText : null

      if (currentContent !== null && oldText && newText !== null) {
        nextContent =
          prompt.replaceAll === true
            ? currentContent.split(oldText).join(newText)
            : replaceFirst(currentContent, oldText, newText)
      }
    }

    if (nextContent === null) {
      return undefined
    }

    // 新建文件时没有「原内容」，与空串比较即可得到全量新增。
    const ops = computeLineDiff(currentContent ?? '', nextContent)
    const stats = computeDiffStats(ops)

    if (stats.additions === 0 && stats.deletions === 0) {
      return 'No effective change.'
    }

    const body = formatDiffAsText(ops, targetPath)

    return [body, `+${stats.additions} -${stats.deletions}`].join('\n')
  } catch {
    return undefined
  }
}
