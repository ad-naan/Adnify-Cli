import { describe, expect, test } from 'bun:test'
import { ToolExecutionDeadline } from './ToolExecutionDeadline'

/** 等一小会儿，让真实定时器有机会触发。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 预算耗尽了吗？不阻塞地问一次。 */
function hasExpired(deadline: ToolExecutionDeadline): Promise<boolean> {
  return Promise.race([
    deadline.expired.then(() => true),
    sleep(0).then(() => false),
  ])
}

describe('ToolExecutionDeadline', () => {
  test('expires once the budget is used up', async () => {
    const deadline = new ToolExecutionDeadline(20)

    await sleep(50)

    expect(await hasExpired(deadline)).toBe(true)
    deadline.dispose()
  })

  test('does not expire while the budget still has room', async () => {
    const deadline = new ToolExecutionDeadline(500)

    await sleep(20)

    expect(await hasExpired(deadline)).toBe(false)
    deadline.dispose()
  })

  test('does not spend budget while paused', async () => {
    const deadline = new ToolExecutionDeadline(60)

    // 停表期间的等待远超预算 —— 这正是用户在审批面板上斟酌的那段时间。
    deadline.pause()
    await sleep(150)

    expect(await hasExpired(deadline)).toBe(false)

    deadline.resume()
    await sleep(120)

    // 恢复后预算才继续流逝，最终仍会超时。
    expect(await hasExpired(deadline)).toBe(true)
    deadline.dispose()
  })

  test('keeps the time already spent before the pause', async () => {
    const deadline = new ToolExecutionDeadline(60)

    await sleep(45)
    deadline.pause()
    await sleep(100)
    deadline.resume()

    // 暂停前已经用掉大部分预算，恢复后剩下的一点很快就烧完。
    await sleep(40)

    expect(await hasExpired(deadline)).toBe(true)
    deadline.dispose()
  })

  test('expires immediately when resumed with no budget left', async () => {
    const deadline = new ToolExecutionDeadline(10)

    await sleep(30)
    deadline.pause()
    deadline.resume()

    expect(await hasExpired(deadline)).toBe(true)
    deadline.dispose()
  })

  test('stops the clock after dispose', async () => {
    const deadline = new ToolExecutionDeadline(20)
    deadline.dispose()

    await sleep(60)

    // dispose 之后不再判超时 —— 执行已经结束，迟到的超时只会污染结果。
    expect(await hasExpired(deadline)).toBe(false)
  })

  test('tolerates repeated pause and resume calls', async () => {
    const deadline = new ToolExecutionDeadline(80)

    deadline.pause()
    deadline.pause()
    await sleep(120)
    deadline.resume()
    deadline.resume()

    expect(await hasExpired(deadline)).toBe(false)
    deadline.dispose()
  })

  test('says approval time is excluded in the timeout message', () => {
    const deadline = new ToolExecutionDeadline(30_000)

    // 模型读到这条消息后要能判断是活太慢，而不是自己等审批等太久。
    expect(deadline.describeTimeout()).toContain('30s')
    expect(deadline.describeTimeout()).toContain('waiting for approval is not counted')
    deadline.dispose()
  })
})
