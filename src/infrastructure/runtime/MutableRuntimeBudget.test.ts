import { describe, expect, test } from 'bun:test'
import { MutableRuntimeBudget } from './MutableRuntimeBudget'

describe('MutableRuntimeBudget', () => {
  test('layers valid stored values over defaults and clamps unsafe input', () => {
    const budget = new MutableRuntimeBudget({ maxStepsPerTurn: 40, maxSubAgentConcurrency: 99 })

    expect(budget.get().maxStepsPerTurn).toBe(40)
    expect(budget.get().maxSubAgentConcurrency).toBe(12)
    expect(budget.get().maxModelRetries).toBe(2)
  })

  test('updates session values and resets to defaults', () => {
    const budget = new MutableRuntimeBudget()
    budget.update({ maxModelRetries: 5 })
    expect(budget.get().maxModelRetries).toBe(5)
    expect(budget.reset().maxModelRetries).toBe(2)
  })
})
