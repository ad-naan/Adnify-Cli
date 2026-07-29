import { describe, expect, it } from 'bun:test'
import { PendingToolApprovalAdapter } from './PendingToolApprovalAdapter'
import type { ToolActionIntent } from '../../domain/tooling/value-objects/ToolApproval'

function createIntent(overrides: Partial<ToolActionIntent> = {}): ToolActionIntent {
  return {
    toolId: 'file-ops',
    riskLevel: 'careful',
    summary: 'write src/a.ts',
    targetPath: 'src/a.ts',
    ...overrides,
  }
}

describe('PendingToolApprovalAdapter', () => {
  it('keeps the request pending until a decision arrives', async () => {
    const adapter = new PendingToolApprovalAdapter()
    const pending = adapter.requestApproval(createIntent())

    expect(adapter.getPending()?.summary).toBe('write src/a.ts')

    adapter.resolvePending('approved')
    expect(await pending).toBe('approved')
    expect(adapter.getPending()).toBeNull()
  })

  it('notifies the observer when a request appears and after it settles', async () => {
    const adapter = new PendingToolApprovalAdapter()
    const seen: (string | null)[] = []
    adapter.setObserver((intent) => seen.push(intent?.summary ?? null))

    const pending = adapter.requestApproval(createIntent())
    adapter.resolvePending('denied')
    await pending

    expect(seen).toEqual([null, 'write src/a.ts', null])
  })

  it('skips the prompt for tools approved for the whole session', async () => {
    const adapter = new PendingToolApprovalAdapter()
    const first = adapter.requestApproval(createIntent())
    adapter.resolvePending('always-approved')
    expect(await first).toBe('always-approved')

    // 第二次不再进入队列，直接返回批准。
    expect(await adapter.requestApproval(createIntent({ summary: 'write src/b.ts' }))).toBe(
      'approved',
    )
    expect(adapter.getPending()).toBeNull()
  })

  it('does not leak the allow-list across different tools', async () => {
    const adapter = new PendingToolApprovalAdapter()
    const first = adapter.requestApproval(createIntent())
    adapter.resolvePending('always-approved')
    await first

    const other = adapter.requestApproval(createIntent({ toolId: 'shell-runner' }))
    expect(adapter.getPending()?.toolId).toBe('shell-runner')
    adapter.resolvePending('denied')
    expect(await other).toBe('denied')
  })

  it('denies every pending request on abort so the generator cannot hang', async () => {
    const adapter = new PendingToolApprovalAdapter()
    const first = adapter.requestApproval(createIntent())
    const second = adapter.requestApproval(createIntent({ toolId: 'shell-runner' }))

    adapter.denyAllPending()

    expect(await first).toBe('denied')
    expect(await second).toBe('denied')
    expect(adapter.getPending()).toBeNull()
  })

  it('reports when there is nothing to resolve', () => {
    const adapter = new PendingToolApprovalAdapter()
    expect(adapter.resolvePending('approved')).toBe(false)
  })
})
