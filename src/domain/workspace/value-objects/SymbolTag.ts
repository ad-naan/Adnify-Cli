/**
 * 从源码文件中提取的符号标签。
 * 由 CodeIndexerPort 的具体实现（LSP / 编译器 API）产出。
 */
export interface SymbolTag {
  /** 符号名称，如 "ModelAssistantResponder" 或 "streamReply" */
  name: string
  /** 符号类型 */
  kind: SymbolKind
  /** 在文件中的起始行号（1-indexed） */
  line: number
  /** 嵌套层级（0 = 顶层声明，1 = 类/接口内成员，2 = 更深嵌套） */
  level: number
  /**
   * 完全限定标识符，如 "WorkspaceContext#rootPath"。
   * 用于跨文件符号去重与精准引用匹配。
   */
  identifier?: string
}

export type SymbolKind =
  | 'class'
  | 'interface'
  | 'type'
  | 'function'
  | 'method'
  | 'property'
  | 'enum'
  | 'enum-member'
  | 'variable'
  | 'namespace'
  | 'module'
  | 'constructor-param'
  | 'other'

/**
 * 单个文件的索引结果。
 */
export interface FileSymbolIndex {
  /** 工作区相对路径（ POSIX，正斜杠分隔） */
  path: string
  /** 该文件中定义的符号列表 */
  definitions: SymbolTag[]
  /** 该文件引用的其他文件的工作区相对路径列表 */
  referencePaths: string[]
}

/**
 * 仓库地图页面。
 */
export interface RepoMapFile {
  /** 工作区相对路径 */
  path: string
  /** 重要性得分（PageRank 值，0-1 之间） */
  rank: number
  /** 该文件的符号列表（按相关性裁剪后） */
  symbols: SymbolTag[]
}

/**
 * 最终生成的仓库地图。
 */
export interface RepoMap {
  files: RepoMapFile[]
  /** 原始 token 估算 */
  tokenEstimate: number
}

// ── Kind priorities & labels ─────────────────────────────────────

/**
 * 符号重要度权重：当 token 预算不足需要裁剪符号时，
 * 优先保留高权重类型（类 > 函数 > 接口 > 类型 > 属性...）。
 */
export const SYMBOL_IMPORTANCE: Readonly<Record<SymbolKind, number>> = Object.freeze({
  class: 100,
  function: 90,
  interface: 70,
  enum: 60,
  type: 50,
  namespace: 45,
  module: 40,
  method: 35,
  property: 20,
  'constructor-param': 15,
  variable: 10,
  'enum-member': 5,
  other: 1,
})

/**
 * 符号类型到展示标签的映射，用于 tree 格式化。
 */
export function symbolKindToLabel(kind: SymbolKind): string {
  switch (kind) {
    case 'class': return 'class'
    case 'interface': return 'interface'
    case 'type': return 'type'
    case 'function': return 'fn'
    case 'method': return 'method'
    case 'property': return 'prop'
    case 'enum': return 'enum'
    case 'enum-member': return 'enum-val'
    case 'variable': return 'var'
    case 'namespace': return 'ns'
    case 'module': return 'mod'
    case 'constructor-param': return 'param'
    default: return ''
  }
}
