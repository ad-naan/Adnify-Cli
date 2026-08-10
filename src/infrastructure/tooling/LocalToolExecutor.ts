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
import type { ToolActionIntent } from '../../domain/tooling/value-objects/ToolApproval'
import { isApprovedDecision } from '../../domain/tooling/value-objects/ToolApproval'
import { autoApproveToolApproval } from './PendingToolApprovalAdapter'
import { parseFileOpsRequest, runFileOps, type FileOpsRequest } from './handlers/fileOpsHandler'
import { handleSearchIndex } from './handlers/searchIndexHandler'
import { parseShellRunnerRequest, runShellCommand } from './handlers/shellRunnerHandler'
import { toolFailure } from './handlers/ToolHandler'
import { replaceFirst } from './toolPathGuard'
import { handleWorkspaceRead } from './handlers/workspaceReadHandler'
import { handleGlobSearch } from './handlers/globSearchHandler'
import { handleWebFetch } from './handlers/webFetchHandler'
import { handleWebSearch } from './handlers/webSearchHandler'
import type { McpRegistry } from '../mcp/McpClient'
import type { CheckpointManager } from '../checkpoint/CheckpointManager'
import { computeDiffStats, computeLineDiff, formatDiffAsText } from '../diff/DiffEngine'

/**
 * 工具调度入口。
 *
 * 分派到 handler，并在动作真正发生前统一做审批判定 —— 审批集中在这一层，
 * 因为只有解析完 payload 才知道「这是读还是写」「这条命令具体是什么」。
 * MCP 工具（mcp__前缀）委托给 McpRegistry 处理。
 *
 * 所有工具执行都有 30 秒超时保护，防止卡死 agent 循环。
 */
const TOOL_EXECUTION_TIMEOUT_MS = 30_000

/** file-ops 中会改动磁盘的动作 —— 只有这些需要事前快照。 */
const MUTATING_FILE_OPS = new Set(['write', 'update', 'patch'])

export class LocalToolExecutor implements ToolExecutorPort {
  constructor(
    private readonly approval: ToolApprovalPort = autoApproveToolApproval,
    private readonly mcpRegistry?: McpRegistry,
    private readonly checkpoints?: CheckpointManager,
  ) {}

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    try {
      return await Promise.race([
        this.executeInner(request),
        this.createTimeout(request.toolId),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return toolFailure(request.toolId, `Tool execution error: ${message}`)
    }
  }

  private createTimeout(toolId: string): Promise<ToolExecutionResult> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(
          toolFailure(
            toolId,
            `Tool execution timed out after ${TOOL_EXECUTION_TIMEOUT_MS / 1000}s. The task may still be running in the background.`,
          ),
        )
      }, TOOL_EXECUTION_TIMEOUT_MS)
    })
  }

  private async executeInner(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
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
        return this.executeFileOps(request)
      case 'shell-runner':
        return this.executeShellRunner(request)
      default:
        return toolFailure(request.toolId, `Tool "${request.toolId}" is not implemented yet.`)
    }
  }

  private async executeFileOps(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const parsed = parseFileOpsRequest(request)
    if (!parsed.ok) {
      return parsed.result
    }

    const { action, resolvedPath } = parsed.value
    const targetPath = toRelativePath(request.workspace.rootPath, resolvedPath)
    const denial = await this.ensureApproved({
      toolId: request.toolId,
      riskLevel: classifyFileOpsRisk(action),
      summary: `${action} ${targetPath}`,
      targetPath,
      preview: await buildFileOpsPreview(parsed.value, targetPath),
    })

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

  private async executeShellRunner(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const parsed = parseShellRunnerRequest(request)
    if (!parsed.ok) {
      return parsed.result
    }

    const { riskLevel, summary } = parsed.value.classification
    const denial = await this.ensureApproved({ toolId: request.toolId, riskLevel, summary })

    return denial ?? runShellCommand(parsed.value)
  }

  /**
   * 需要审批时等待用户决定。
   * 被拒绝时返回失败结果而不是抛异常 —— 模型能读到拒绝原因并改用别的方案，整轮对话不中断。
   */
  private async ensureApproved(intent: ToolActionIntent): Promise<ToolExecutionResult | null> {
    if (!requiresApproval(intent)) {
      return null
    }

    const decision = await this.approval.requestApproval(intent)
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

/** 预览最多展示的行数，避免大文件把审批面板刷爆。 */
const MAX_PREVIEW_LINES = 40

/**
 * 为待批准的写入构造 diff 预览。
 *
 * 这里算的是「还没落盘的改动」—— git diff 此刻看不到任何东西，
 * 所以必须自己把新旧内容对比出来。
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
    const lines = body.split('\n')
    const shown =
      lines.length > MAX_PREVIEW_LINES
        ? [...lines.slice(0, MAX_PREVIEW_LINES), `... ${lines.length - MAX_PREVIEW_LINES} more line(s)`]
        : lines

    return [...shown, `+${stats.additions} -${stats.deletions}`].join('\n')
  } catch {
    return undefined
  }
}
