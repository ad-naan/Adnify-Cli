import { describe, expect, test } from 'bun:test'
import type { ModelGatewayPort, ModelMessage } from '../../application/ports/ModelGatewayPort'
import { estimateTokens } from '../../domain/session/value-objects/CompactionResult'
import { ModelContextCompactor } from './ModelContextCompactor'

const logger = { debug() {}, info() {}, warn() {}, error() {} }

function gatewayWithSummary(summary: string): ModelGatewayPort {
  return {
    async *streamChat() {
      yield { delta: summary, finishReason: 'stop' as const }
    },
  }
}

function messagesWithCompactableHistory(earlyContent: string): ModelMessage[] {
  return [
    { role: 'system', content: 'system instructions' },
    { role: 'user', content: earlyContent },
    { role: 'assistant', content: earlyContent },
    ...Array.from({ length: 6 }, (_, index): ModelMessage => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `recent-${index}`,
    })),
  ]
}

describe('ModelContextCompactor', () => {
  test('does not confuse a 4k output limit with a 128k context window', () => {
    const compactor = new ModelContextCompactor(gatewayWithSummary('short'), 128_000, logger, 'test', 4_096)
    const messages = messagesWithCompactableHistory('x'.repeat(10_000))

    expect(estimateTokens(messages)).toBeGreaterThan(4_096)
    expect(compactor.needsCompaction(messages, 128_000)).toBe(false)
  })

  test('rejects a summary that does not meaningfully reduce tokens', async () => {
    const early = 'x'.repeat(8_000)
    const messages = messagesWithCompactableHistory(early)
    const compactor = new ModelContextCompactor(gatewayWithSummary('y'.repeat(16_000)), 12_000, logger, 'test', 1_000)

    expect(compactor.needsCompaction(messages, 12_000)).toBe(true)
    const result = await compactor.compact(messages, 12_000)

    expect(result.compactedCount).toBe(0)
    expect(result.messages).toEqual(messages)
    expect(result.tokensAfter).toBe(result.tokensBefore)
  })

  test('keeps a concise summary when it creates real headroom', async () => {
    const messages = messagesWithCompactableHistory('x'.repeat(8_000))
    const compactor = new ModelContextCompactor(gatewayWithSummary('decisions and pending work'), 12_000, logger, 'test', 1_000)

    const result = await compactor.compact(messages, 12_000)

    expect(result.compactedCount).toBe(2)
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore - 512)
    expect(result.messages.some((message) => message.content.includes('Conversation Summary'))).toBe(true)
  })

  test('estimates CJK text more realistically than chars divided by four', () => {
    expect(estimateTokens([{ content: '这是一个中文上下文测试' }])).toBeGreaterThan(9)
  })
})
