import { test, expect, describe } from 'bun:test'
import { computeLineDiff, computeDiffStats, formatDiffAsText } from './DiffEngine'

describe('DiffEngine', () => {
  describe('computeLineDiff', () => {
    test('returns no ops for two empty strings', () => {
      // 空文本是零行，不是「一行空串」—— 否则新建文件会多出一行幽灵改动。
      expect(computeLineDiff('', '')).toHaveLength(0)
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

    test('marks additions with + and no space after the sign', () => {
      const ops = computeLineDiff('a\nb', 'a\nb\nc')
      const result = formatDiffAsText(ops, 'src/test.ts')
      expect(result.split('\n')).toContain('+c')
      // 多一个空格就不是合法 unified diff，git apply 会拒绝。
      expect(result.split('\n')).not.toContain('+ c')
    })

    test('marks removals with - and no space after the sign', () => {
      const ops = computeLineDiff('a\nb\nc', 'a\nb')
      const result = formatDiffAsText(ops, 'src/test.ts')
      expect(result.split('\n')).toContain('-c')
      expect(result.split('\n')).not.toContain('- c')
    })

    test('prefixes context lines with exactly one space', () => {
      const ops = computeLineDiff('a\nb\nc', 'a\nB\nc')
      const result = formatDiffAsText(ops, 'src/test.ts')
      expect(result.split('\n')).toContain(' a')
    })

    test('omits the count in a hunk range when it is 1', () => {
      const ops = computeLineDiff('a', 'b')
      const result = formatDiffAsText(ops, 'src/test.ts')
      // git 写 `@@ -1 +1 @@`，不写 `@@ -1,1 +1,1 @@`。
      expect(result).toContain('@@ -1 +1 @@')
    })

    test('uses /dev/null and a 0,0 range for a new file', () => {
      const ops = computeLineDiff('', 'x\ny\n')
      const result = formatDiffAsText(ops, 'src/new.ts')
      expect(result).toContain('--- /dev/null')
      expect(result).toContain('+++ b/src/new.ts')
      expect(result).toContain('@@ -0,0 +1,2 @@')
      // 空的「原内容」不该产生一行幽灵删除。
      expect(result.split('\n').some((line) => line.startsWith('-') && line !== '--- /dev/null'))
        .toBe(false)
    })

    test('uses /dev/null on the new side for a deleted file', () => {
      const ops = computeLineDiff('x\n', '')
      const result = formatDiffAsText(ops, 'src/gone.ts')
      expect(result).toContain('--- a/src/gone.ts')
      expect(result).toContain('+++ /dev/null')
      expect(result).toContain('@@ -1 +0,0 @@')
    })

    test('trailing newline does not produce a phantom line', () => {
      // 'a\n' 是一行，不是两行 —— 结尾换行符只是行终止符。
      const ops = computeLineDiff('a\n', 'a\n')
      expect(ops.length).toBe(1)
      expect(ops[0].content).toBe('a')
    })
  })
})
