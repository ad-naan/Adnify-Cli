import type { FileSymbolIndex, RepoMap } from '../../domain/workspace/value-objects/SymbolTag'

/**
 * 代码索引器端口。
 *
 * 架构设计为可扩展：
 * - TsLanguageServiceIndexer：使用 TypeScript 编译器的 LanguageService（等价于 tsserver 引擎）为 TS/JS 文件提供精确符号表和引用图
 * - 未来可添加 LspClientIndexer：通过 JSON-RPC 连接外部语言服务器（gopls, pyright 等）
 */
export interface CodeIndexerPort {
  /**
   * 索引整个工作区，返回每个源文件的符号定义 + 文件间引用关系。
   */
  indexWorkspace(rootPath: string): Promise<FileSymbolIndex[]>

  /**
   * 判断该 indexer 能否处理给定的文件扩展名。
   */
  supportsFile(filePath: string): boolean
}

/**
 * 仓库地图构建器端口。
 *
 * 接收 CodeIndexer 产出的原始索引，构建引用图、计算 PageRank、
 * 按 token 预算裁剪并格式化为树状字符串。
 */
export interface RepoMapBuilderPort {
  /**
   * 构建仓库地图文本。
   *
   * @param rootPath 工作区根路径
   * @param chatFilePaths 当前对话中已提及的文件（用于 personalization）
   * @param maxTokens 输出的 token 预算上限
   */
  buildRepoMap(
    rootPath: string,
    chatFilePaths: string[],
    maxTokens: number,
  ): Promise<RepoMap>

  /**
   * 直接从原始索引构建地图。
   */
  buildFromIndex(
    indices: FileSymbolIndex[],
    chatFilePaths: string[],
    maxTokens: number,
  ): RepoMap

  /**
   * 将 repo map 渲染为树状文本字符串。
   */
  toTreeString(repoMap: RepoMap): string
}
