/**
 * 最小化 diff 引擎。
 *
 * 使用 Myers diff 算法计算两段文本之间的行级差异。
 * 用于在 AI Agent 编辑文件后生成可视化 diff。
 */

/** 单行 diff 操作类型 */
export type DiffOpType = 'equal' | 'add' | 'remove'

/** 单行 diff 操作 */
export interface DiffOp {
  type: DiffOpType
  /** 行内容（不含换行符） */
  content: string
  /** 原文件中的行号（1-indexed），仅 equal/remove 有值 */
  oldLineNumber?: number
  /** 新文件中的行号（1-indexed），仅 equal/add 有值 */
  newLineNumber?: number
}

/**
 * 行级 Myers diff。
 *
 * 时间复杂度 O(ND)，其中 N = 总行数，D = 差异行数。
 * 对于典型代码编辑（少量修改 + 大量不变），D 远小于 N，性能远优于 O(M×N) LCS。
 */
export function computeLineDiff(
  oldText: string,
  newText: string,
): DiffOp[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const m = oldLines.length
  const n = newLines.length

  // Trail-off optimization: skip matching suffix and prefix
  let start = 0
  while (start < m && start < n && oldLines[start] === newLines[start]) {
    start++
  }

  let endOld = m - 1
  let endNew = n - 1
  while (endOld >= start && endNew >= start && oldLines[endOld] === newLines[endNew]) {
    endOld--
    endNew--
  }

  const coreOld = oldLines.slice(start, endOld + 1)
  const coreNew = newLines.slice(start, endNew + 1)

  // Compute core diff using Myers algorithm
  const coreOps = myersDiff(coreOld, coreNew)

  // Reconstruct full diff ops
  const ops: DiffOp[] = []

  // Matched prefix
  for (let i = 0; i < start; i++) {
    ops.push({
      type: 'equal',
      content: oldLines[i],
      oldLineNumber: i + 1,
      newLineNumber: i + 1,
    })
  }

  // Core diff (adjust line numbers)
  let oldLine = start
  let newLine = start

  for (const op of coreOps) {
    if (op.type === 'equal') {
      ops.push({
        type: 'equal',
        content: op.content,
        oldLineNumber: oldLine + 1,
        newLineNumber: newLine + 1,
      })
      oldLine++
      newLine++
    } else if (op.type === 'remove') {
      ops.push({
        type: 'remove',
        content: op.content,
        oldLineNumber: oldLine + 1,
      })
      oldLine++
    } else {
      ops.push({
        type: 'add',
        content: op.content,
        newLineNumber: newLine + 1,
      })
      newLine++
    }
  }

  // Matched suffix
  for (let i = endOld + 1; i < m; i++) {
    ops.push({
      type: 'equal',
      content: oldLines[i],
      oldLineNumber: i + 1,
      newLineNumber: i - (m - n - (endOld - endNew)) + 1,
    })
  }

  return ops
}

/**
 * 核心 Myers diff 实现。
 * 求解最短编辑脚本 (Shortest Edit Script)。
 */
function myersDiff(a: string[], b: string[]): DiffOp[] {
  const m = a.length
  const n = b.length

  if (m === 0 && n === 0) return []
  if (m === 0) {
    return b.map((line) => ({ type: 'add' as const, content: line }))
  }
  if (n === 0) {
    return a.map((line) => ({ type: 'remove' as const, content: line }))
  }

  // Myers trace
  const max = m + n
  const vOffset = max
  const vContainer = new Int32Array(2 * max + 1).fill(-1)
  const trace: Int32Array[] = []

  vContainer[vOffset + 1] = 0

  let found = false

  for (let d = 0; d <= max && !found; d++) {
    trace.push(new Int32Array(vContainer))

    for (let k = -d; k <= d; k += 2) {
      let x: number

      if (k === -d || (k !== d && vContainer[vOffset + k - 1] < vContainer[vOffset + k + 1])) {
        x = vContainer[vOffset + k + 1] // Down (insertion)
      } else {
        x = vContainer[vOffset + k - 1] + 1 // Right (deletion)
      }

      let y = x - k

      // Extend diagonal
      while (x < m && y < n && a[x] === b[y]) {
        x++
        y++
      }

      vContainer[vOffset + k] = x

      if (x >= m && y >= n) {
        found = true
        break
      }
    }
  }

  // Backtrack through the trace to build the diff
  return backtrack(trace, a, b, m, n, vOffset)
}

/**
 * 从 Myers trace 中反向构建 diff 操作序列。
 */
function backtrack(
  trace: Int32Array[],
  a: string[],
  b: string[],
  m: number,
  n: number,
  vOffset: number,
): DiffOp[] {
  const ops: DiffOp[] = []
  let x = m
  let y = n

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]
    const k = x - y

    let prevK: number

    if (k === -d || (k !== d && v[vOffset + k - 1] < v[vOffset + k + 1])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }

    const prevX = v[vOffset + prevK]
    const prevY = prevX - prevK

    // Extend diagonal backwards
    while (x > prevX && y > prevY) {
      ops.unshift({ type: 'equal', content: a[x - 1] })
      x--
      y--
    }

    if (d > 0) {
      if (x === prevX) {
        // Down = insertion
        ops.unshift({ type: 'add', content: b[y - 1] })
      } else {
        // Right = deletion
        ops.unshift({ type: 'remove', content: a[x - 1] })
      }
    }

    x = prevX
    y = prevY
  }

  return ops
}

// ── Diff rendering ────────────────────────────────────────────────

/**
 * Diff 统计信息。
 */
export interface DiffStats {
  additions: number
  deletions: number
  unchanged: number
}

/**
 * 从 diff 操作列表统计增删行数。
 */
export function computeDiffStats(ops: DiffOp[]): DiffStats {
  let additions = 0
  let deletions = 0
  let unchanged = 0

  for (const op of ops) {
    switch (op.type) {
      case 'add': additions++; break
      case 'remove': deletions++; break
      case 'equal': unchanged++; break
    }
  }

  return { additions, deletions, unchanged }
}

/**
 * 将 diff 操作列表格式化为带颜色的 ANSI 文本。
 *
 * 输出格式：
 * ```
 * --- a/src/foo.ts
 * +++ b/src/foo.ts
 * @@ -10,5 +10,7 @@
 *   unchanged line
 * - removed line
 * + added line
 *   unchanged line
 * ```
 */
export function formatDiffAsText(
  ops: DiffOp[],
  filePath: string,
  contextLines = 3,
): string {
  const lines: string[] = []
  lines.push(`--- a/${filePath}`)
  lines.push(`+++ b/${filePath}`)

  let i = 0
  while (i < ops.length) {
    // Find next change region
    if (ops[i].type === 'equal') {
      i++
      continue
    }

    // Start of a change hunk — collect context + changes
    const hunkStart = Math.max(0, i - contextLines)
    let hunkEnd = i

    while (hunkEnd < ops.length && ops[hunkEnd].type !== 'equal') {
      hunkEnd++
    }
    // Include trailing context
    hunkEnd = Math.min(ops.length, hunkEnd + contextLines)

    // Check if there's another change within 2*contextLines — merge hunks
    let nextChange = hunkEnd
    while (nextChange < ops.length && nextChange < hunkEnd + contextLines) {
      if (ops[nextChange].type !== 'equal') {
        hunkEnd = Math.min(ops.length, nextChange + 1)
        nextChange = hunkEnd
        // Re-check for further changes
        while (hunkEnd < ops.length && ops[hunkEnd].type !== 'equal') {
          hunkEnd++
        }
        hunkEnd = Math.min(ops.length, hunkEnd + contextLines)
        nextChange = hunkEnd
      } else {
        nextChange++
      }
    }

    // Build hunk header
    const oldStart = ops[hunkStart].oldLineNumber ?? 1
    const newStart = ops[hunkStart].newLineNumber ?? 1
    const oldCount = ops.slice(hunkStart, hunkEnd).filter((op) => op.type !== 'add').length
    const newCount = ops.slice(hunkStart, hunkEnd).filter((op) => op.type !== 'remove').length

    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)

    // Render hunk lines
    for (let j = hunkStart; j < hunkEnd; j++) {
      const op = ops[j]
      const prefix = op.type === 'add' ? '+' : op.type === 'remove' ? '-' : ' '
      lines.push(`${prefix} ${op.content}`)
    }

    i = hunkEnd
  }

  return lines.join('\n')
}
