export interface RuntimeBudget {
  maxStepsPerTurn: number
  maxModelRetries: number
  retryBaseDelayMs: number
  duplicateToolCallLimit: number
  maxSubAgentConcurrency: number
  maxSubTasksPerBatch: number
  toolTimeoutMs: number
  taskTimeoutMs: number
}

export type RuntimeBudgetPatch = Partial<RuntimeBudget>

export interface RuntimeBudgetPort {
  get(): Readonly<RuntimeBudget>
  update(patch: RuntimeBudgetPatch): Readonly<RuntimeBudget>
  reset(): Readonly<RuntimeBudget>
}

export const DEFAULT_RUNTIME_BUDGET: RuntimeBudget = {
  maxStepsPerTurn: 20,
  maxModelRetries: 2,
  retryBaseDelayMs: 500,
  duplicateToolCallLimit: 2,
  maxSubAgentConcurrency: 4,
  maxSubTasksPerBatch: 8,
  toolTimeoutMs: 30_000,
  taskTimeoutMs: 10 * 60_000,
}

export const RUNTIME_BUDGET_LIMITS: Record<keyof RuntimeBudget, readonly [number, number]> = {
  maxStepsPerTurn: [4, 100],
  maxModelRetries: [0, 8],
  retryBaseDelayMs: [100, 10_000],
  duplicateToolCallLimit: [1, 10],
  maxSubAgentConcurrency: [1, 12],
  maxSubTasksPerBatch: [1, 24],
  toolTimeoutMs: [5_000, 10 * 60_000],
  taskTimeoutMs: [30_000, 60 * 60_000],
}

export function normalizeRuntimeBudget(patch: RuntimeBudgetPatch): RuntimeBudget {
  const budget = { ...DEFAULT_RUNTIME_BUDGET }
  for (const key of Object.keys(DEFAULT_RUNTIME_BUDGET) as Array<keyof RuntimeBudget>) {
    const candidate = patch[key]
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) continue
    const [min, max] = RUNTIME_BUDGET_LIMITS[key]
    budget[key] = Math.max(min, Math.min(max, Math.trunc(candidate)))
  }
  return budget
}

export function formatRuntimeBudget(budget: Readonly<RuntimeBudget>): string {
  return Object.entries(budget).map(([key, value]) => `${key}=${value}`).join('\n')
}
