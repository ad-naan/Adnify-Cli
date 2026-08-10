import type { ToolProgressEvent } from '../../application/ports/ToolExecutorPort'

/**
 * 把「执行中途的回调」接到「async generator 的 yield」上。
 *
 * 问题在于两种模型对不上：工具执行是 `await` 一个 promise 拿单个结果，
 * 而回调是在这个 await 期间从旁边打进来的 —— 回调里没法 yield。
 *
 * 所以事件先进队列，`drain()` 一边等执行结束一边把队列里的事件吐出来。
 * 执行结束且队列排空后 drain 自然收尾，最终结果通过 `result` 拿。
 */
export class ToolProgressChannel<T> {
  private readonly queue: ToolProgressEvent[] = []
  private wake: (() => void) | null = null
  private settled = false

  /** 传给 execute 的回调。 */
  readonly onProgress = (event: ToolProgressEvent): void => {
    // 执行已经结束后迟到的事件直接丢掉：drain 已经退出，留着也没人来取。
    if (this.settled) {
      return
    }

    this.queue.push(event)
    this.wake?.()
  }

  /** 底层执行的最终结果。 */
  readonly result: Promise<T>

  constructor(start: (onProgress: (event: ToolProgressEvent) => void) => Promise<T>) {
    this.result = start(this.onProgress).finally(() => {
      this.settled = true
      this.wake?.()
    })

    // 调用方是先 drain 再 await result 的，中间这段时间里一个失败的 promise
    // 处于「无人接管」状态，会触发 unhandled rejection 警告。
    // 这里挂个空 catch 只为标记已接管；错误本身仍然由 result 抛给调用方。
    this.result.catch(() => {})
  }

  /**
   * 按事件到达的顺序吐出进度，执行结束且队列排空后结束。
   *
   * 注意先排空队列再看是否结束：反过来会漏掉最后一批事件 ——
   * 最后一个子任务完成的通知和整体完成几乎是同一时刻发生的。
   */
  async *drain(): AsyncGenerator<ToolProgressEvent, void, unknown> {
    for (;;) {
      const event = this.queue.shift()
      if (event) {
        yield event
        continue
      }

      if (this.settled) {
        return
      }

      // 等下一个事件或者执行结束，谁先来都算。
      await new Promise<void>((resolve) => {
        this.wake = () => {
          this.wake = null
          resolve()
        }
      })
    }
  }
}
