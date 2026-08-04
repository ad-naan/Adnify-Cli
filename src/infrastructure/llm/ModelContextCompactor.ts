import type { ModelMessage, ModelGatewayPort } from '../../application/ports/ModelGatewayPort'
import type { ContextCompactionPort } from '../../application/ports/ContextCompactionPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'
import type { CompactionResult } from '../../domain/session/value-objects/CompactionResult'
import { estimateTokens, shouldCompact } from '../../domain/session/value-objects/CompactionResult'

/**
 * 压缩时保留近期消息的最小条数。
 */
const KEEP_RECENT_MESSAGES = 6

/**
 * 触发压缩的阈值比例（占 maxTokens）。
 */
const COMPACTION_THRESHOLD = 0.75

/**
 * 压缩后目标的 token 占比（压缩到 maxTokens 的 40% 以内）。
 */
const COMPACTION_TARGET_RATIO = 0.4

/**
 * 基于模型的上下文压缩器。
 *
 * 策略与 Claude Code 类似：
 * 1. 当上下文接近窗口上限时触发
 * 2. 保留 system prompt + 近几轮对话
 * 3. 将更早的消息让模型生成一条摘要，替换原始消息
 * 4. 摘要 + 近期消息组成新的消息列表
 */
export class ModelContextCompactor implements ContextCompactionPort {
  constructor(
    private readonly gateway: ModelGatewayPort,
    private readonly maxTokens: number,
    private readonly logger: LoggerPort,
    private readonly summarizeModel?: string,
  ) {}

  needsCompaction(messages: ModelMessage[], maxTokens: number): boolean {
    void maxTokens
    return shouldCompact(messages, this.maxTokens, COMPACTION_THRESHOLD)
  }

  async compact(
    messages: ModelMessage[],
    maxTokens: number,
    abortSignal?: AbortSignal,
  ): Promise<CompactionResult> {
    const tokensBefore = estimateTokens(messages)

    // 分离 system 消息（保留原样）和非 system 消息（参与压缩）
    const systemMessages = messages.filter((m) => m.role === 'system')
    const conversationMessages = messages.filter((m) => m.role !== 'system')

    // 确定保留边界：保留最后 KEEP_RECENT_MESSAGES 条对话消息
    const keepCount = Math.min(KEEP_RECENT_MESSAGES, conversationMessages.length)
    const keepStart = conversationMessages.length - keepCount
    const toCompact = conversationMessages.slice(0, keepStart)
    const toKeep = conversationMessages.slice(keepStart)

    if (toCompact.length === 0) {
      // 没有可压缩的内容
      return {
        messages,
        compactedCount: 0,
        tokensBefore,
        tokensAfter: tokensBefore,
      }
    }

    // 生成摘要
    const summary = await this.generateSummary(toCompact, abortSignal)

    // 组装新消息列表
    const summaryMessage: ModelMessage = {
      role: 'system',
      content: [
        '## Conversation Summary',
        'The following is a summary of earlier conversation. Use it for context.',
        '',
        summary,
      ].join('\n'),
    }

    const newMessages = [...systemMessages, summaryMessage, ...toKeep]
    const tokensAfter = estimateTokens(newMessages)

    this.logger.info('Context compacted', {
      messagesBefore: messages.length,
      messagesAfter: newMessages.length,
      tokensBefore,
      tokensAfter,
      compactedCount: toCompact.length,
    })

    return {
      messages: newMessages,
      compactedCount: toCompact.length,
      tokensBefore,
      tokensAfter,
    }
  }

  /**
   * 调用模型生成旧消息的摘要。
   */
  private async generateSummary(
    messages: ModelMessage[],
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const conversationText = messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n\n')

    const summaryRequest: ModelMessage[] = [
      {
        role: 'system',
        content: [
          'You are a context compaction assistant.',
          'Summarize the following conversation, preserving:',
          '- Key decisions and their rationale',
          '- Files that were read or modified (with paths)',
          '- Tool calls that were executed and their outcomes',
          '- Any unresolved questions or pending tasks',
          '- Important code snippets or error messages',
          '',
          'Be concise but complete. Output only the summary.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Summarize this conversation:\n\n${conversationText}`,
      },
    ]

    let summary = ''
    for await (const chunk of this.gateway.streamChat({
      messages: summaryRequest,
      model: this.summarizeModel ?? 'gpt-4o-mini',
      temperature: 0,
      maxTokens: Math.floor(this.maxTokens * COMPACTION_TARGET_RATIO),
      abortSignal,
    })) {
      summary += chunk.delta
    }

    return summary.trim()
  }
}
