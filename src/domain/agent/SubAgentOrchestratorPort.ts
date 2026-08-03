import type { SubAgentTask, SubAgentPriority } from './SubAgentTask'

/**
 * 子代理编排器接口。
 *
 * 主 Agent 通过此接口将复杂任务拆分为子任务，
 * 各子代理并行执行后汇总结果。
 *
 * 实现可以是本地串行、本地并行、或远程多模型。
 */
export interface SubAgentOrchestratorPort {
  /**
   * 创建一批子任务并返回它们的 ID。
   * 任务不会立即执行 —— 调用 runBatch 后才开始。
   */
  createTasks(tasks: Array<{
    title: string
    instruction: string
    contextSummary?: string
    priority?: SubAgentPriority
  }>): SubAgentTask[]

  /**
   * 并发执行所有 pending 的子任务，返回最终结果列表。
   * 每个子任务在独立的上下文中运行，互不干扰。
   */
  runBatch(
    tasks: SubAgentTask[],
    options: {
      maxConcurrency: number
      abortSignal?: AbortSignal
      onTaskStart?: (taskId: string, title: string) => void
      onTaskComplete?: (taskId: string, success: boolean, result?: string) => void
    },
  ): Promise<SubAgentTask[]>
}
