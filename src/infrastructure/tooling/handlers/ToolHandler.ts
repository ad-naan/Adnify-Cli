import type {
  ToolExecutionRequest,
  ToolExecutionResult,
} from '../../../application/ports/ToolExecutorPort'

/**
 * 各工具 handler 的统一签名。
 * handler 只负责「做这件事」，是否需要用户审批由 LocalToolExecutor 统一判定。
 */
export type ToolHandler = (request: ToolExecutionRequest) => Promise<ToolExecutionResult>

export function toolSuccess(toolId: string, content: string): ToolExecutionResult {
  return { toolId, ok: true, content }
}

export function toolFailure(toolId: string, content: string): ToolExecutionResult {
  return { toolId, ok: false, content }
}

export function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
