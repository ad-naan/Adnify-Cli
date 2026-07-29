import type {
  ToolApprovalController,
  ToolApprovalPort,
} from '../../application/ports/ToolApprovalPort'
import type {
  ToolActionIntent,
  ToolApprovalDecision,
} from '../../domain/tooling/value-objects/ToolApproval'

interface PendingEntry {
  intent: ToolActionIntent
  settle: (decision: ToolApprovalDecision) => void
}

/** presentation 层订阅当前待决意图；null 表示没有待办审批。 */
export type PendingApprovalObserver = (intent: ToolActionIntent | null) => void

/**
 * 把「等用户按键」变成一个可 await 的 promise。
 *
 * 工具执行发生在 responder 的 async generator 里，无法直接读键盘；
 * 这里存下未 resolve 的 deferred，由 Ink 层在收到按键后带外 resolve。
 * 适配器在 Ink 挂载前就已创建，所以 observer 是可后设的，而非构造注入。
 */
export class PendingToolApprovalAdapter implements ToolApprovalPort, ToolApprovalController {
  private readonly queue: PendingEntry[] = []
  private readonly sessionAllowList = new Set<string>()
  private observer: PendingApprovalObserver | null = null

  async requestApproval(intent: ToolActionIntent): Promise<ToolApprovalDecision> {
    if (this.sessionAllowList.has(intent.toolId)) {
      return 'approved'
    }

    return new Promise<ToolApprovalDecision>((resolve) => {
      this.queue.push({ intent, settle: resolve })
      this.notifyObserver()
    })
  }

  setObserver(observer: PendingApprovalObserver | null): void {
    this.observer = observer
    this.notifyObserver()
  }

  getPending(): ToolActionIntent | null {
    return this.queue[0]?.intent ?? null
  }

  /** 用户做出决定：结算队首，并在选择「始终允许」时记住该工具。 */
  resolvePending(decision: ToolApprovalDecision): boolean {
    const entry = this.queue.shift()
    if (!entry) {
      return false
    }

    if (decision === 'always-approved') {
      this.sessionAllowList.add(entry.intent.toolId)
    }

    entry.settle(decision)
    this.notifyObserver()
    return true
  }

  /**
   * 中止时清空所有待决审批。
   * 少了这一步，Esc 之后仍有 promise 永不 resolve，generator 会挂死、isBusy 卡住。
   */
  denyAllPending(): void {
    const entries = this.queue.splice(0, this.queue.length)
    for (const entry of entries) {
      entry.settle('denied')
    }

    this.notifyObserver()
  }

  private notifyObserver(): void {
    this.observer?.(this.getPending())
  }
}

/** 默认实现：无人审批时（如单测、非交互场景）直接放行，保持既有行为。 */
export const autoApproveToolApproval: ToolApprovalPort = {
  async requestApproval() {
    return 'approved'
  },
}
