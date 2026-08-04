import type { ModelMessage } from './ModelGatewayPort'
import type { CompactionResult } from '../../domain/session/value-objects/CompactionResult'

/**
 * 上下文压缩端口。
 */
export interface ContextCompactionPort {
  /**
   * 判断是否需要压缩。
   */
  needsCompaction(messages: ModelMessage[], maxTokens: number): boolean

  /**
   * 执行压缩。用模型生成旧消息摘要，保留近期消息。
   */
  compact(
    messages: ModelMessage[],
    maxTokens: number,
    abortSignal?: AbortSignal,
  ): Promise<CompactionResult>
}
