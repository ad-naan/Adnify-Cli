import { relative } from 'node:path'
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
import { parseFileOpsRequest, runFileOps } from './handlers/fileOpsHandler'
import { handleSearchIndex } from './handlers/searchIndexHandler'
import { parseShellRunnerRequest, runShellCommand } from './handlers/shellRunnerHandler'
import { toolFailure } from './handlers/ToolHandler'
import { handleWorkspaceRead } from './handlers/workspaceReadHandler'

/**
 * 工具调度入口。
 *
 * 分派到 handler，并在动作真正发生前统一做审批判定 —— 审批集中在这一层，
 * 因为只有解析完 payload 才知道「这是读还是写」「这条命令具体是什么」。
 */
export class LocalToolExecutor implements ToolExecutorPort {
  constructor(private readonly approval: ToolApprovalPort = autoApproveToolApproval) {}

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    switch (request.toolId) {
      case 'workspace-read':
        return handleWorkspaceRead(request)
      case 'search-index':
        return handleSearchIndex(request)
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
    })

    return denial ?? runFileOps(parsed.value)
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
