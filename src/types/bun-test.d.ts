declare module 'bun:test' {
  export const describe: (name: string, fn: () => void | Promise<void>) => void
  export const test: (name: string, fn: () => void | Promise<void>) => void
  export const expect: <T = unknown>(value: T) => {
    toBe: (expected: unknown) => void
    toEqual: (expected: unknown) => void
    toContain: (expected: unknown) => void
    toHaveLength: (expected: number) => void
    toBeNull: () => void
    not: {
      toBeNull: () => void
    }
    rejects: {
      toThrow: (expected?: unknown) => Promise<void>
    }
  }
}
