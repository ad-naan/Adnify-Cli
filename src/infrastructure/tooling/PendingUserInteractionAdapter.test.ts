import { describe, expect, test } from 'bun:test'
import { PendingUserInteractionAdapter } from './PendingUserInteractionAdapter'

const request = {
  questions: [
    {
      id: 'scope',
      header: 'Scope',
      question: 'Which scope?',
      options: [
        { label: 'Small', description: 'Minimal change' },
        { label: 'Full', description: 'Complete change' },
      ],
    },
    {
      id: 'tests',
      header: 'Tests',
      question: 'Which tests?',
      options: [
        { label: 'Targeted', description: 'Fast' },
        { label: 'All', description: 'Thorough' },
      ],
    },
  ],
}

describe('PendingUserInteractionAdapter', () => {
  test('walks through a multi-step choice flow and returns answers', async () => {
    const adapter = new PendingUserInteractionAdapter()
    const seen: Array<string | null> = []
    adapter.setObserver((snapshot) => seen.push(snapshot?.question.id ?? null))
    const pending = adapter.requestChoices(request)

    expect(adapter.getPending()?.questionIndex).toBe(0)
    expect(adapter.selectOption(1)).toBe(true)
    expect(adapter.getPending()?.questionIndex).toBe(1)
    expect(adapter.selectOption(0)).toBe(true)

    expect(await pending).toEqual([
      { questionId: 'scope', selectedIndex: 1, label: 'Full' },
      { questionId: 'tests', selectedIndex: 0, label: 'Targeted' },
    ])
    expect(seen).toEqual([null, 'scope', 'tests', null])
  })

  test('cancels pending interaction', async () => {
    const adapter = new PendingUserInteractionAdapter()
    const pending = adapter.requestChoices(request)
    adapter.cancelPending()
    expect(await pending).toBeNull()
    expect(adapter.getPending()).toBeNull()
  })
})
