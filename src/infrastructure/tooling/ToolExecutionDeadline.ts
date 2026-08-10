/**
 * 工具执行的超时预算，可暂停。
 *
 * 为什么不是一个 `setTimeout` 了事：审批要等真人按键，而等人的时间不该算进
 * 「工具跑了多久」。直接用固定超时去 race 整段执行，用户在审批面板上想 30 秒，
 * 一个已经批准的写入就会以超时失败告终 —— 这不是卡死，是人在思考。
 *
 * 所以这里把预算做成「只在干活时流逝」：`pause()` 停表，`resume()` 继续。
 * 另外必须 `dispose()`：未清理的定时器会把事件循环按住，进程要等它烧完才退得掉。
 */
export class ToolExecutionDeadline {
  private remainingMs: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private resumedAt: number | null = null
  private settled = false
  private expire: () => void = () => {}

  /** 预算耗尽时 resolve；没耗尽就一直悬着，交给 race 的另一边赢。 */
  readonly expired: Promise<void>

  constructor(private readonly budgetMs: number) {
    this.remainingMs = budgetMs
    this.expired = new Promise<void>((resolve) => {
      this.expire = resolve
    })
    this.resume()
  }

  /** 停表。等真人做决定前调用，重复调用无副作用。 */
  pause(): void {
    if (this.settled || this.timer === null) {
      return
    }

    clearTimeout(this.timer)
    this.timer = null

    if (this.resumedAt !== null) {
      this.remainingMs -= Date.now() - this.resumedAt
      this.resumedAt = null
    }
  }

  /** 继续走表。预算已经用光时立即判超时。 */
  resume(): void {
    if (this.settled || this.timer !== null) {
      return
    }

    if (this.remainingMs <= 0) {
      this.settle()
      return
    }

    this.resumedAt = Date.now()
    this.timer = setTimeout(() => this.settle(), this.remainingMs)
  }

  /** 执行结束后必须调用，否则残留定时器会拖住进程退出。 */
  dispose(): void {
    this.settled = true

    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** 超时文案带上预算值，方便用户判断是活太慢还是预算太小。 */
  describeTimeout(): string {
    return `Tool execution timed out after ${Math.round(this.budgetMs / 1000)}s of active work (time spent waiting for approval is not counted). The task may still be running in the background.`
  }

  private settle(): void {
    if (this.settled) {
      return
    }

    this.settled = true
    this.timer = null
    this.resumedAt = null
    this.expire()
  }
}
