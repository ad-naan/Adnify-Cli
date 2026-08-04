import { test, expect, describe } from 'bun:test'
import { computeLineDiff, computeDiffStats, formatDiffAsText } from './DiffEngine'

describe('DiffEngine', () => {
  describe('computeLineDiff', () => {
    test('returns empty for two empty strings', () => {
      const ops = computeLineDiff('', '')
      expect(ops.length).toBe(1) // one empty equal line
      expect(ops[0].type).toBe('equal')
    })

    test('all additions for new content', () => {
      const ops = computeLineDiff('', 'a\nb\nc')
      const additions = ops.filter((op) => op.type === 'add')
      expect(additions.length).toBe(3)
    })

    test('all removals for deleted content', () => {
      const ops = computeLineDiff('a\nb\nc', '')
      const removals = ops.filter((op) => op.type === 'remove')
      expect(removals.length).toBe(3)
    })

    test('detects single line change', () => {
      const ops = computeLineDiff('hello\nworld\nfoo', 'hello\nWORLD\nfoo')
      const changes = ops.filter((op) => op.type !== 'equal')
      expect(changes.length).toBe(2) // one remove, one add

      const remove = changes.find((op) => op.type === 'remove')
      const add = changes.find((op) => op.type === 'add')
      expect(remove?.content).toBe('world')
      expect(add?.content).toBe('WORLD')
    })

    test('detects insertion in middle', () => {
      const ops = computeLineDiff('a\nc', 'a\nb\nc')
      const adds = ops.filter((op) => op.type === 'add')
      expect(adds.length).toBe(1)
      expect(adds[0].content).toBe('b')
    })

    test('detects deletion in middle', () => {
      const ops = computeLineDiff('a\nb\nc', 'a\nc')
      const removes = ops.filter((op) => op.type === 'remove')
      expect(removes.length).toBe(1)
      expect(removes[0].content).toBe('b')
    })

    test('identical content returns all equal', () => {
      const ops = computeLineDiff('a\nb\nc', 'a\nb\nc')
      expect(ops.every((op) => op.type === 'equal')).toBe(true)
      expect(ops.length).toBe(3)
    })

    test('preserves line numbers for equal ops', () => {
      const ops = computeLineDiff('a\nb\nc', 'a\nb\nc')
      expect(ops[0].oldLineNumber).toBe(1)
      expect(ops[0].newLineNumber).toBe(1)
      expect(ops[1].oldLineNumber).toBe(2)
      expect(ops[2].oldLineNumber).toBe(3)
    })
  })

  describe('computeDiffStats', () => {
    test('counts additions, deletions, and unchanged', () => {
      const ops = computeLineDiff('a\nb\nc\nd', 'a\nX\nc\nd')
      const stats = computeDiffStats(ops)
      expect(stats.additions).toBe(1)
      expect(stats.deletions).toBe(1)
      expect(stats.unchanged).toBe(3)
    })
  })

  describe('formatDiffAsText', () => {
    test('includes file headers', () => {
      const ops = computeLineDiff('old', 'new')
      const result = formatDiffAsText(ops, 'src/test.ts')
      expect(result).toContain('--- a/src/test.ts')
      expect(result).toContain('+++ b/src/test.ts')
    })

    test('includes hunk header', () => {
      const ops = computeLineDiff('a\nb\nc', 'a\nB\nc')
      const result = formatDiffAsText(ops, 'src/test.ts')
      expect(result).toContain('@@')
    })

    test('marks additions with +', () => {
      const ops = computeLineDiff('a\nb', 'a\nb\nc')
      const result = formatDiffAsText(ops, 'src/test.ts')
      expect(result).toContain('+ c')
    })

    test('marks removals with -', () => {
      const ops = computeLineDiff('a\nb\nc', 'a\nb')
      const result = formatDiffAsText(ops, 'src/test.ts')
      expect(result).toContain('- c')
    })
  })
})
