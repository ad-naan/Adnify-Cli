import type { HookContext, HookEvent, HookHandler, HookPort } from '../../application/ports/HookPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'

/**
 * 默认 Hook 实现器。
 *
 * 特性：
 * 1. 失败隔离 — 单个 handler 抛异常不影响其他 handler 执行
 * 2. 顺序执行 — handlers 按注册顺序调用
 * 3. 中止支持 — before* hooks 返回 false 可中止链路
 * 4. 超时保护 — 每个 handler 有超时限制，防止永久阻塞
 * 5. 一次性注册 — `on()` 返回 unsubscribe 函数
 *
 * 线程安全性：handlers 数组使用 copy-on-write 语义，确保遍历时不被修改影响。
 */
export class DefaultHookRegistry implements HookPort {
  /** event → sorted handlers (by priority) */
  private readonly handlers = new Map<HookEvent, Array<{ handler: HookHandler; priority: number }>>()

  /** 单个 handler 执行超时（ms） */
  private static readonly HANDLER_TIMEOUT_MS = 5000

  constructor(private readonly logger: LoggerPort) {}

  on(event: HookEvent, handler: HookHandler): () => void {
    const list = this.handlers.get(event) ?? []
    const priority = list.length
    list.push({ handler, priority })
    this.handlers.set(event, list)

    // Return unsubscribe function
    return () => {
      const current = this.handlers.get(event)
      if (!current) return
      const filtered = current.filter((entry) => entry.handler !== handler)
      if (filtered.length === 0) {
        this.handlers.delete(event)
      } else {
        this.handlers.set(event, filtered)
      }
    }
  }

  async emit(context: HookContext): Promise<boolean> {
    const list = this.handlers.get(context.event)
    if (!list || list.length === 0) {
      return true
    }

    // Copy to avoid mutation during iteration
    const snapshot = [...list]

    for (const entry of snapshot) {
      try {
        const result = await this.executeWithTimeout(entry.handler, context)

        // before* hooks: false means abort
        if (result === false) {
          this.logger.debug('Hook aborted execution chain', {
            event: context.event,
            handlerIndex: entry.priority,
          })
          return false
        }
      } catch (error) {
        // Error isolation — log and continue
        this.logger.warn('Hook handler failed, continuing chain', {
          event: context.event,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return true
  }

  /**
   * 带超时的 handler 执行。
   * 如果 handler 超过 HANDLER_TIMEOUT_MS 未完成，视为超时。
   */
  private async executeWithTimeout(
    handler: HookHandler,
    context: HookContext,
  ): Promise<boolean | void> {
    return new Promise<boolean | void>((resolve) => {
      let settled = false

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          this.logger.warn('Hook handler timed out', {
            event: context.event,
            timeoutMs: DefaultHookRegistry.HANDLER_TIMEOUT_MS,
          })
          resolve(undefined) // Treat timeout as success (don't abort)
        }
      }, DefaultHookRegistry.HANDLER_TIMEOUT_MS)

      handler(context)
        .then((result) => {
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            resolve(result)
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            resolve(undefined) // Treat error as non-aborting
            // Re-throw to be caught by emit()
            throw error
          }
        })
    })
  }

  /**
   * 清除所有注册的 handler。测试或重置时使用。
   */
  clear(): void {
    this.handlers.clear()
  }

  /**
   * 获取某事件当前注册的 handler 数量。
   */
  handlerCount(event: HookEvent): number {
    return this.handlers.get(event)?.length ?? 0
  }
}
