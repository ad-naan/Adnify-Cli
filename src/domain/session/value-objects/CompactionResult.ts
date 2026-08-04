import type { ModelMessage } from '../../../application/ports/ModelGatewayPort'

/**
 * 上下文压缩结果。
 */
export interface CompactionResult {
  /** 压缩后的消息列表（含摘要消息 + 保留的近期消息） */
  messages: ModelMessage[]
  /** 被压缩的消息条目数 */
  compactedCount: number
  /** 压缩前估算 token 数 */
  tokensBefore: number
  /** 压缩后估算 token 数 */
  tokensAfter: number
}

/**
 * token 估算 — 粗略使用 chars / 4。
 * 与 :context 命令保持一致。
 */
export function estimateTokens(messages: ReadonlyArray<{ content: string }>): number {
  return Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4)
}

/**
 * 判断当前消息列表是否需要压缩。
 *
 * 阈值策略：
 * - 当估算 token > maxTokens * threshold（默认 0.75）时返回 true。
 * - 这是保守策略，为后续工具调用留出空间。
 */
export function shouldCompact(
  messages: ReadonlyArray<{ content: string }>,
  maxTokens: number,
  threshold = 0.75,
): boolean {
  return estimateTokens(messages) > maxTokens * threshold
}
