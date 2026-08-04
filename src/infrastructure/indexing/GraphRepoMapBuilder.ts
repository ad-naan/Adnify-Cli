import type { RepoMapBuilderPort } from '../../application/ports/CodeIndexerPort'
import type { FileSymbolIndex, RepoMap, RepoMapFile, SymbolTag } from '../../domain/workspace/value-objects/SymbolTag'
import { SYMBOL_IMPORTANCE, symbolKindToLabel } from '../../domain/workspace/value-objects/SymbolTag'
import type { LoggerPort } from '../../application/ports/LoggerPort'

/**
 * 仓库地图构建器。
 *
 * 核心算法（Aider-style，生产级实现）：
 *
 * 1. **引用图构建** — 从 FileSymbolIndex 构建 O(V+E) 邻接表，
 *    同时构建反向邻接表（inbound edges）用于 PageRank。
 *
 * 2. **个性化 PageRank** — O(n) 迭代，使用反向邻接表避免 O(n²) 全扫描。
 *    带 convergence detection（L1 norm < epsilon 时提前收敛）。
 *    聊天中提及的文件获得 100x personalization 权重提升。
 *
 * 3. **Per-file 符号预算分配** — 按 rank 分数比例分配 token 预算，
 *    使得高重要性文件获得更多符号展示。
 *    符号选择基于 SYMBOL_IMPORTANCE 权重（class > function > interface...）。
 *
 * 4. **树状格式化** — 按目录分组，带 kind 标注（class Foo, fn bar）。
 */
export class GraphRepoMapBuilder implements RepoMapBuilderPort {
  private static readonly PAGERANK_ITERATIONS = 40
  private static readonly PAGERANK_DAMPING = 0.85
  private static readonly PAGERANK_CONVERGENCE_EPSILON = 1e-7
  private static readonly PERSONALIZE_WEIGHT = 100

  /** 每个文件的最低符号数（保证小文件不会被完全隐藏） */
  private static readonly MIN_SYMBOLS_PER_FILE = 3

  constructor(private readonly logger: LoggerPort) {}

  async buildRepoMap(
    _rootPath: string,
    chatFilePaths: string[],
    maxTokens: number,
  ): Promise<RepoMap> {
    // Indexer is injected by the caller; this method is for interface compliance.
    // Actual indexing is performed by the caller via buildFromIndex().
    return this.buildFromIndex([], chatFilePaths, maxTokens)
  }

  buildFromIndex(
    indices: FileSymbolIndex[],
    chatFilePaths: string[],
    maxTokens: number,
  ): RepoMap {
    if (indices.length === 0) {
      return { files: [], tokenEstimate: 0 }
    }

    const filePaths = indices.map((i) => i.path)
    const fileSet = new Set(filePaths)
    const chatSet = new Set(
      chatFilePaths.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '')),
    )

    // ── Step 1: Build adjacency graph with O(V+E) complexity ──
    const graph = this.buildGraph(indices, fileSet)

    // ── Step 2: Personalized PageRank with convergence detection ──
    const ranks = this.computePageRank(graph, fileSet, chatSet)

    // ── Step 3: Sort by PageRank descending ──
    const sortedFiles = filePaths
      .map((p) => ({ path: p, rank: ranks.get(p) ?? 0 }))
      .sort((a, b) => b.rank - a.rank)

    // ── Step 4: Allocate per-file symbol budgets & select symbols ──
    const indexMap = new Map(indices.map((i) => [i.path, i]))
    const files = this.selectSymbolsForBudget(sortedFiles, indexMap, maxTokens)

    const treeString = this.formatTreeString(files)
    const tokenEstimate = this.estimateTokens(treeString)

    this.logger.debug('Repo map built', {
      totalFiles: indices.length,
      includedFiles: files.length,
      totalSymbols: files.reduce((s, f) => s + f.symbols.length, 0),
      maxTokens,
      tokenEstimate,
    })

    return { files, tokenEstimate }
  }

  toTreeString(repoMap: RepoMap): string {
    return this.formatTreeString(repoMap.files)
  }

  // ── Graph construction ──────────────────────────────────────────

  /**
   * 构建有向图数据结构。
   *
   * @returns outbound edges, inbound edges, out-degree map
   */
  private buildGraph(
    indices: FileSymbolIndex[],
    fileSet: Set<string>,
  ): Graph {
    const outbound = new Map<string, Set<string>>()
    const inbound = new Map<string, Set<string>>()

    for (const file of indices) {
      const targets = new Set<string>()
      for (const ref of file.referencePaths) {
        if (fileSet.has(ref) && ref !== file.path) {
          targets.add(ref)
        }
      }
      // Isolated files (no intra-workspace references) become dangling nodes.
      // Their PageRank weight is redistributed uniformly to all files,
      // which prevents them from retaining an artificially high score.
      outbound.set(file.path, targets)

      // Build inbound edges
      if (!inbound.has(file.path)) {
        inbound.set(file.path, new Set())
      }
      for (const target of targets) {
        if (!inbound.has(target)) {
          inbound.set(target, new Set())
        }
        inbound.get(target)!.add(file.path)
      }
    }

    return { outbound, inbound }
  }

  // ── PageRank ────────────────────────────────────────────────────

  /**
   * 个性化 PageRank 迭代计算。
   *
   * 复杂度：O(iterations × (V + E))
   * 使用反向邻接表避免 O(n²) 全边扫描。
   * 带 convergence detection：当 L1 norm 变化 < epsilon 时提前终止。
   */
  private computePageRank(
    graph: Graph,
    fileSet: Set<string>,
    chatSet: Set<string>,
  ): Map<string, number> {
    const n = fileSet.size
    if (n === 0) return new Map()

    const files = [...fileSet]
    const personalization = this.buildPersonalization(files, chatSet)

    // Initialize uniform
    let scores = new Float64Array(n)
    const fileIndex = new Map<string, number>()
    files.forEach((f, i) => {
      scores[i] = 1 / n
      fileIndex.set(f, i)
    })

    // Pre-compute: for each node, list of (inbound node index, out-degree of inbound node)
    const inboundLists: Array<Array<{ srcIdx: number; outDeg: number }>> = new Array(n)
    for (let i = 0; i < n; i++) {
      const file = files[i]
      const inboundSet = graph.inbound.get(file) ?? new Set<string>()
      inboundLists[i] = []
      for (const src of inboundSet) {
        const srcIdx = fileIndex.get(src)!
        const outDeg = graph.outbound.get(src)?.size ?? 1
        inboundLists[i].push({ srcIdx, outDeg })
      }
    }

    // Pre-compute dangling node indices
    const danglingIdx: number[] = []
    for (let i = 0; i < n; i++) {
      const file = files[i]
      const targets = graph.outbound.get(file)
      if (!targets || targets.size === 0) {
        danglingIdx.push(i)
      }
    }

    const next = new Float64Array(n)

    for (let iter = 0; iter < GraphRepoMapBuilder.PAGERANK_ITERATIONS; iter++) {
      next.fill(0)

      // Dangling mass
      let danglingSum = 0
      for (const di of danglingIdx) {
        danglingSum += scores[di]
      }

      for (let i = 0; i < n; i++) {
        let sum = 0
        const inList = inboundLists[i]
        for (let j = 0; j < inList.length; j++) {
          const { srcIdx, outDeg } = inList[j]
          sum += scores[srcIdx] / outDeg
        }

        // Dangling redistribution
        sum += danglingSum / n

        const p = personalization[i]

        next[i] =
          GraphRepoMapBuilder.PAGERANK_DAMPING * sum +
          (1 - GraphRepoMapBuilder.PAGERANK_DAMPING) * p
      }

      // Convergence detection
      let l1 = 0
      for (let i = 0; i < n; i++) {
        l1 += Math.abs(next[i] - scores[i])
      }

      scores = next.slice()

      if (l1 < GraphRepoMapBuilder.PAGERANK_CONVERGENCE_EPSILON) {
        break
      }
    }

    // Normalize
    let total = 0
    for (let i = 0; i < n; i++) total += scores[i]
    if (total > 0) {
      for (let i = 0; i < n; i++) scores[i] /= total
    }

    const result = new Map<string, number>()
    for (let i = 0; i < n; i++) {
      result.set(files[i], scores[i])
    }
    return result
  }

  /**
   * 构建个性化向量。
   * 聊天中提及的文件获得 PERSONALIZE_WEIGHT 倍权重提升。
   */
  private buildPersonalization(
    files: string[],
    chatSet: Set<string>,
  ): Float64Array {
    const n = files.length
    const vec = new Float64Array(n)

    const chatIndices: number[] = []
    const otherIndices: number[] = []

    for (let i = 0; i < n; i++) {
      if (chatSet.has(files[i])) {
        chatIndices.push(i)
      } else {
        otherIndices.push(i)
      }
    }

    if (chatIndices.length > 0) {
      const chatWeight = GraphRepoMapBuilder.PERSONALIZE_WEIGHT
      const otherWeight = 1
      const totalWeight = chatIndices.length * chatWeight + otherIndices.length * otherWeight

      for (const idx of chatIndices) vec[idx] = chatWeight / totalWeight
      for (const idx of otherIndices) vec[idx] = otherWeight / totalWeight
    } else {
      vec.fill(1 / n)
    }

    return vec
  }

  // ── Symbol selection & budget allocation ────────────────────────

  /**
   * 按 PageRank 分数比例分配 token 预算，并选择每个文件展示的符号。
   *
   * 策略：
   * 1. 先过滤掉无符号的文件
   * 2. 从 token 预算中预留 path overhead
   * 3. 按 rank 比例分配剩余预算
   * 4. 每个文件内按 SYMBOL_IMPORTANCE 排序符号
   * 5. 贪心填充，保证每个文件至少 MIN_SYMBOLS_PER_FILE 个符号
   */
  private selectSymbolsForBudget(
    rankedFiles: Array<{ path: string; rank: number }>,
    indexMap: Map<string, FileSymbolIndex>,
    maxTokens: number,
  ): RepoMapFile[] {
    // Filter out files with no definitions
    const candidateFiles = rankedFiles
      .map((f) => {
        const idx = indexMap.get(f.path)
        return idx && idx.definitions.length > 0
          ? { path: f.path, rank: f.rank, index: idx }
          : null
      })
      .filter((f): f is { path: string; rank: number; index: FileSymbolIndex } => f !== null)

    if (candidateFiles.length === 0) return []

    // Calculate total rank sum for proportional allocation
    const rankSum = candidateFiles.reduce((s, f) => s + Math.max(f.rank, 1e-10), 0)

    // Pre-sort symbols within each file by importance
    const sortedSymbolsMap = new Map<string, SymbolTag[]>()
    for (const f of candidateFiles) {
      const sorted = [...f.index.definitions].sort((a, b) => {
        const impDiff = SYMBOL_IMPORTANCE[b.kind] - SYMBOL_IMPORTANCE[a.kind]
        if (impDiff !== 0) return impDiff
        return a.level - b.level
      })
      sortedSymbolsMap.set(f.path, sorted)
    }

    const result: RepoMapFile[] = []
    let remainingBudget = maxTokens

    for (const f of candidateFiles) {
      if (remainingBudget <= 0) break

      // Path overhead: path string + newlines + indentation
      const pathOverhead = this.estimateTokens(f.path + '\n')
      const availableForSymbols = remainingBudget - pathOverhead

      if (availableForSymbols <= 2) break

      // Allocate budget proportionally, but with minimum floor
      const proportionalBudget = Math.max(
        availableForSymbols * (Math.max(f.rank, 1e-10) / rankSum),
        4, // At least enough for a few symbols
      )

      const symbols = sortedSymbolsMap.get(f.path)!
      const selectedSymbols = this.selectSymbolsWithinBudget(
        symbols,
        proportionalBudget,
        f.rank / rankSum > 0.01, // Allow more symbols for high-rank files
      )

      if (selectedSymbols.length === 0) continue

      const fileCost = this.estimateTokens(
        this.formatFileEntry(f.path, selectedSymbols),
      )

      if (fileCost > remainingBudget) {
        // Try minimal set
        const minSymbols = symbols.slice(0, GraphRepoMapBuilder.MIN_SYMBOLS_PER_FILE)
        const minCost = this.estimateTokens(
          this.formatFileEntry(f.path, minSymbols),
        )
        if (minCost <= remainingBudget) {
          result.push({ path: f.path, rank: f.rank, symbols: minSymbols })
          remainingBudget -= minCost
        }
        continue
      }

      result.push({ path: f.path, rank: f.rank, symbols: selectedSymbols })
      remainingBudget -= fileCost
    }

    return result
  }

  /**
   * 在每个文件内按 token 预算选择符号。
   */
  private selectSymbolsWithinBudget(
    symbols: SymbolTag[],
    budget: number,
    isHighRank: boolean,
  ): SymbolTag[] {
    const selected: SymbolTag[] = []
    let used = 0

    const maxSymbols = isHighRank ? symbols.length : Math.min(symbols.length, 15)

    for (let i = 0; i < maxSymbols; i++) {
      const sym = symbols[i]
      const cost = this.estimateTokens(this.formatSymbolLine(sym))
      if (used + cost > budget && selected.length >= GraphRepoMapBuilder.MIN_SYMBOLS_PER_FILE) {
        break
      }
      selected.push(sym)
      used += cost
    }

    return selected
  }

  // ── Formatting ──────────────────────────────────────────────────

  /**
   * 格式化单个符号为带 kind 标注的行。
   * 例如: `    class ModelAssistantResponder`
   */
  private formatSymbolLine(symbol: SymbolTag): string {
    const label = symbolKindToLabel(symbol.kind)
    const indent = '  '.repeat(symbol.level + 1)
    return label ? `${indent}${label} ${symbol.name}` : `${indent}${symbol.name}`
  }

  /**
   * 格式化单个文件条目（path + 所有符号行）。
   */
  private formatFileEntry(filePath: string, symbols: SymbolTag[]): string {
    const lines = [filePath]
    for (const sym of symbols) {
      lines.push(this.formatSymbolLine(sym))
    }
    return lines.join('\n')
  }

  /**
   * 将整个 repo map 渲染为树状文本。
   *
   * 按 PageRank 排序后在同一目录下聚合展示，
   * 高 rank 文件在目录内排在前面。
   */
  private formatTreeString(files: RepoMapFile[]): string {
    if (files.length === 0) return ''

    // Group by directory
    const grouped = new Map<string, RepoMapFile[]>()
    for (const file of files) {
      const dir = file.path.includes('/')
        ? file.path.substring(0, file.path.lastIndexOf('/'))
        : ''
      const existing = grouped.get(dir)
      if (existing) {
        existing.push(file)
      } else {
        grouped.set(dir, [file])
      }
    }

    // Sort directories, with root files first
    const sortedDirs = [...grouped.keys()].sort((a, b) => {
      if (a === '') return -1
      if (b === '') return 1
      return a.localeCompare(b)
    })

    const lines: string[] = []

    for (const dir of sortedDirs) {
      const dirFiles = grouped.get(dir)!

      if (dir) {
        lines.push(`${dir}/`)
      }

      for (const file of dirFiles) {
        const fileName = file.path.includes('/')
          ? file.path.substring(file.path.lastIndexOf('/') + 1)
          : file.path

        lines.push(`  ${fileName}`)

        for (const sym of file.symbols) {
          lines.push(this.formatSymbolLineIndentedForTree(sym))
        }
      }
    }

    return lines.join('\n')
  }

  /**
   * 树状格式化中符号的行（比文件名多两级缩进）。
   */
  private formatSymbolLineIndentedForTree(symbol: SymbolTag): string {
    const label = symbolKindToLabel(symbol.kind)
    const indent = '  '.repeat(symbol.level + 2)
    return label ? `${indent}${label} ${symbol.name}` : `${indent}${symbol.name}`
  }

  // ── Token estimation ────────────────────────────────────────────

  /**
   * Token 估算：chars/4 是行业标准近似。
   * 对中文等 CJK 字符取 chars/2 更准确，
   * 但 repo map 以英文标识符为主，chars/4 足够。
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }
}

// ── Graph type ────────────────────────────────────────────────────

interface Graph {
  /** file → set of files it references */
  outbound: Map<string, Set<string>>
  /** file → set of files that reference it */
  inbound: Map<string, Set<string>>
}
