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
 * token 估算：拉丁文本约 chars / 4，CJK 字符约 1 token，并计入消息结构开销。
 * 这仍是 provider-independent 的近似值，但不会再严重低估中文会话。
 */
export function estimateTokens(messages: ReadonlyArray<{ content: string }>): number {
  return messages.reduce((sum, message) => {
    const cjkCount = message.content.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0
    const otherCharacters = Math.max(0, message.content.length - cjkCount)
    return sum + cjkCount + Math.ceil(otherCharacters / 4) + 4
  }, 0)
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
