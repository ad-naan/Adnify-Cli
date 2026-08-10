declare module 'bun:test' {
  export const describe: (name: string, fn: () => void | Promise<void>) => void
  export const test: (name: string, fn: () => void | Promise<void>) => void
  export const it: typeof test
  export const expect: <T = unknown>(value: T) => {
    toBe: (expected: unknown) => void
    toEqual: (expected: unknown) => void
    toMatchObject: (expected: object) => void
    toContain: (expected: unknown) => void
    toHaveLength: (expected: number) => void
    toBeNull: () => void
    toBeDefined: () => void
    toBeUndefined: () => void
    toBeTruthy: () => void
    toBeFalsy: () => void
    toBeGreaterThan: (expected: number) => void
    toBeLessThan: (expected: number) => void
    not: {
      toBe: (expected: unknown) => void
      toEqual: (expected: unknown) => void
      toContain: (expected: unknown) => void
      toHaveLength: (expected: number) => void
      toBeNull: () => void
      toBeUndefined: () => void
      toBeTruthy: () => void
      toBeFalsy: () => void
    }
    rejects: {
      toThrow: (expected?: unknown) => Promise<void>
    }
  }
}
