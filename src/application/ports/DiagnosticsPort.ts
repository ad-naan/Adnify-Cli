/**
 * 代码诊断端口。
 *
 * 在文件写入落盘后，对单个文件做一次「写后诊断」——把编译器/语言服务器的
 * 类型与语法错误立即反馈给模型，使其在同一轮就能修正，而不必等到一整轮
 * 独立的 typecheck。
 *
 * 架构设计为可扩展：
 * - TsDiagnosticsProvider：基于 TypeScript 增量 LanguageService，为 TS/JS 提供精确诊断。
 * - 未来可添加 LspDiagnosticsProvider：通过 JSON-RPC 连接 gopls / pyright 等外部语言服务器。
 */
export type DiagnosticSeverity = 'error' | 'warning'

export interface CodeDiagnostic {
  /** 工作区相对路径 */
  file: string
  /** 1-based 行号 */
  line: number
  /** 1-based 列号 */
  column: number
  severity: DiagnosticSeverity
  /** 诊断码，例如 TS2322 里的 2322 */
  code: number
  message: string
}

export interface DiagnosticsPort {
  /** 该 provider 能否诊断给定文件扩展名。 */
  supportsFile(filePath: string): boolean

  /**
   * 对单个文件做写后诊断。
   *
   * @param rootPath 工作区根路径
   * @param absoluteFilePath 被编辑文件的绝对路径
   * @returns 该文件上的诊断列表（按行号升序）；诊断本身是建议性的，
   *          实现应在内部吞掉自身错误并返回空数组，绝不因诊断失败而抛出。
   */
  getFileDiagnostics(rootPath: string, absoluteFilePath: string): Promise<CodeDiagnostic[]>
}
