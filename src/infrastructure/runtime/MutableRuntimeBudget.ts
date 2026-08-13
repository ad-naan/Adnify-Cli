import {
  normalizeRuntimeBudget,
  type RuntimeBudget,
  type RuntimeBudgetPatch,
  type RuntimeBudgetPort,
} from '../../application/ports/RuntimeBudgetPort'

export class MutableRuntimeBudget implements RuntimeBudgetPort {
  private current: RuntimeBudget

  constructor(initial: RuntimeBudgetPatch = {}) {
    this.current = normalizeRuntimeBudget(initial)
  }

  get(): Readonly<RuntimeBudget> {
    return { ...this.current }
  }

  update(patch: RuntimeBudgetPatch): Readonly<RuntimeBudget> {
    this.current = normalizeRuntimeBudget({ ...this.current, ...patch })
    return this.get()
  }

  reset(): Readonly<RuntimeBudget> {
    this.current = normalizeRuntimeBudget({})
    return this.get()
  }
}
