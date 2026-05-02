import type { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'

export interface ToolExecutionRequest {
  toolId: string
  input: string
  workspace: WorkspaceContext
  approvalGranted?: boolean
}

export interface ToolExecutionResult {
  toolId: string
  ok: boolean
  content: string
}

export interface ToolExecutorPort {
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>
}
