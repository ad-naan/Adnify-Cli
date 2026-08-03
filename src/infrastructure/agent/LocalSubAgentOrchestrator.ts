import type { IdGeneratorPort } from '../../application/ports/IdGeneratorPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'
import type { ModelGatewayPort, ModelMessage } from '../../application/ports/ModelGatewayPort'
import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'
import {
  SubAgentTask,
  type SubAgentPriority,
} from '../../domain/agent/SubAgentTask'
import type { SubAgentOrchestratorPort } from '../../domain/agent/SubAgentOrchestratorPort'

interface LocalSubAgentOptions {
  idGenerator: IdGeneratorPort
  logger: LoggerPort
}

/**
 * 本地子代理编排器。
 *
 * 子代理在隔离的消息上下文中运行（只有 system prompt + 子任务指令），
 * 结果汇总到主 Agent。
 *
 * 并发控制：使用信号量模式限制同时运行的子任务数量。
 */
export class LocalSubAgentOrchestrator implements SubAgentOrchestratorPort {
  constructor(
    private readonly gateway: ModelGatewayPort | null,
    private readonly config: ModelConfig,
    private readonly options: LocalSubAgentOptions,
  ) {}

  createTasks(tasks: Array<{
    title: string
    instruction: string
    contextSummary?: string
    priority?: SubAgentPriority
  }>): SubAgentTask[] {
    return tasks.map((task) =>
      SubAgentTask.create({
        id: this.options.idGenerator.next(),
        title: task.title,
        instruction: task.instruction,
        contextSummary: task.contextSummary,
        priority: task.priority ?? 'normal',
      }),
    )
  }

  async runBatch(
    tasks: SubAgentTask[],
    options: {
      maxConcurrency: number
      abortSignal?: AbortSignal
      onTaskStart?: (taskId: string, title: string) => void
      onTaskComplete?: (taskId: string, success: boolean, result?: string) => void
    },
  ): Promise<SubAgentTask[]> {
    const pending = tasks.filter((t) => t.status === 'pending')
    if (pending.length === 0) {
      return tasks
    }

    const maxConcurrent = Math.max(1, Math.min(options.maxConcurrency, pending.length))
    const results = [...tasks]

    // Simple semaphore — maxConcurrent controls parallelism via worker pool below
    let nextIndex = 0

    const executeTask = async (task: SubAgentTask): Promise<void> => {
      task.markRunning()
      options.onTaskStart?.(task.id, task.title)

      try {
        if (!this.gateway) {
          task.markFailed('No model gateway configured for sub-agent execution')
          options.onTaskComplete?.(task.id, false, task.error)
          return
        }

        const messages = this.buildSubAgentMessages(task)
        let result = ''

        for await (const chunk of this.gateway.streamChat({
          messages,
          model: this.config.model,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          abortSignal: options.abortSignal,
        })) {
          result += chunk.delta
        }

        result = result.trim()
        if (!result) {
          task.markFailed('Sub-agent returned empty response')
          options.onTaskComplete?.(task.id, false, task.error)
          return
        }

        task.markCompleted(result)
        options.onTaskComplete?.(task.id, true, result)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        task.markFailed(msg)
        options.onTaskComplete?.(task.id, false, msg)
      }
    }

    // Worker pool pattern
    const workers: Promise<void>[] = []
    for (let w = 0; w < maxConcurrent; w++) {
      workers.push(
        (async () => {
          while (nextIndex < pending.length) {
            const current = pending[nextIndex++]
            await executeTask(current)
          }
        })(),
      )
    }

    await Promise.allSettled(workers)
    return results
  }

  private buildSubAgentMessages(task: SubAgentTask): ModelMessage[] {
    const systemLines = [
      'You are a focused sub-agent working on a specific task.',
      'Provide a clear, complete result. Do not ask questions — give your best answer.',
      `Task: ${task.title}`,
    ]

    if (task.contextSummary) {
      systemLines.push(`Context: ${task.contextSummary}`)
    }

    const userLines = [task.instruction]

    return [
      { role: 'system', content: systemLines.join('\n') },
      { role: 'user', content: userLines.join('\n') },
    ]
  }
}
