import { describe, expect, test } from 'bun:test'
import { ToolProgressChannel } from './ToolProgressChannel'
import type { ToolProgressEvent } from '../../application/ports/ToolExecutorPort'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function collect(channel: ToolProgressChannel<unknown>): Promise<string[]> {
  const seen: string[] = []
  for await (const event of channel.drain()) {
    seen.push(event.message)
  }
  return seen
}

describe('ToolProgressChannel', () => {
  test('streams events emitted while execution is still running', async () => {
    const channel = new ToolProgressChannel<string>(async (onProgress) => {
      onProgress({ toolId: 'task', message: 'first' })
      await sleep(10)
      onProgress({ toolId: 'task', message: 'second' })
      await sleep(10)
      return 'done'
    })

    expect(await collect(channel)).toEqual(['first', 'second'])
    expect(await channel.result).toBe('done')
  })

  test('does not drop an event emitted at the moment execution finishes', async () => {
    // 最后一个子任务完成的通知和整体完成几乎同时发生。
    // drain 若先判「已结束」再排空队列，这条就永远丢了。
    const channel = new ToolProgressChannel<string>(async (onProgress) => {
      await sleep(10)
      onProgress({ toolId: 'task', message: 'last' })
      return 'done'
    })

    expect(await collect(channel)).toEqual(['last'])
  })

  test('finishes immediately when nothing reports progress', async () => {
    // 绝大多数工具从头到尾只有一个结果，drain 不该把调用方挂住。
    const channel = new ToolProgressChannel<string>(async () => 'quiet')

    expect(await collect(channel)).toEqual([])
    expect(await channel.result).toBe('quiet')
  })

  test('preserves the order events were emitted in', async () => {
    const channel = new ToolProgressChannel<string>(async (onProgress) => {
      for (const message of ['a', 'b', 'c', 'd']) {
        onProgress({ toolId: 'task', message })
        await sleep(2)
      }
      return 'done'
    })

    expect(await collect(channel)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('carries the failure flag through so a failed subtask can be styled', async () => {
    const seen: ToolProgressEvent[] = []
    const channel = new ToolProgressChannel<string>(async (onProgress) => {
      onProgress({ toolId: 'task', message: 'ok one', ok: true })
      onProgress({ toolId: 'task', message: 'bad one', ok: false })
      return 'done'
    })

    for await (const event of channel.drain()) {
      seen.push(event)
    }

    expect(seen.map((event) => event.ok)).toEqual([true, false])
  })

  test('ends the drain when execution rejects and surfaces the error on result', async () => {
    const channel = new ToolProgressChannel<string>(async (onProgress) => {
      onProgress({ toolId: 'task', message: 'before the crash' })
      await sleep(5)
      throw new Error('orchestrator exploded')
    })

    // drain 必须正常收尾，否则整个 agent 循环会挂在这里。
    expect(await collect(channel)).toEqual(['before the crash'])
    await expect(channel.result).rejects.toThrow('orchestrator exploded')
  })

  test('ignores progress arriving after execution settled', async () => {
    let leak: ((event: ToolProgressEvent) => void) | null = null
    const channel = new ToolProgressChannel<string>(async (onProgress) => {
      leak = onProgress
      return 'done'
    })

    await collect(channel)
    // 迟到的事件没人来取了，丢掉即可 —— 不该抛，也不该悬住。
    expect(() => leak?.({ toolId: 'task', message: 'too late' })).not.toThrow()
  })
})
