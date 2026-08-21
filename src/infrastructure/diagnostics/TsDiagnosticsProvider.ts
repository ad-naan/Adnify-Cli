import * as ts from 'typescript'
import * as path from 'node:path'
import * as fs from 'node:fs'
import type { CodeDiagnostic, DiagnosticsPort } from '../../application/ports/DiagnosticsPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])

/** 单个文件诊断上限：够模型定位问题即可，避免刷屏烧 token。 */
const MAX_DIAGNOSTICS_PER_FILE = 12

/**
 * 每个 rootPath 的增量语言服务上下文。
 *
 * LanguageService 是重复单文件诊断的正确原语：首轮构建后，后续编辑只需
 * bump 版本号即可增量重算，无需像 ts.createProgram 那样每次全量重建。
 */
interface ServiceContext {
  service: ts.LanguageService
  /** 归一化文件名 → 版本号；每次编辑后 +1，触发 LS 重读快照 */
  versions: Map<string, number>
  /** tsconfig 声明的项目文件集合 */
  rootFiles: Set<string>
  /** 项目之外、被临时编辑到的文件（如新建文件） */
  extraFiles: Set<string>
  options: ts.CompilerOptions
}

/**
 * 基于 TypeScript 增量 LanguageService 的写后诊断实现。
 *
 * 设计与 TsLanguageServiceIndexer 保持一致：直接嵌入 tsserver 底层引擎，
 * 零进程开销；尊重 tsconfig 工程配置；无 tsconfig 时回退到合理默认值。
 */
export class TsDiagnosticsProvider implements DiagnosticsPort {
  private readonly contexts = new Map<string, ServiceContext>()

  constructor(private readonly logger: LoggerPort) {}

  supportsFile(filePath: string): boolean {
    return SUPPORTED_EXTENSIONS.has(path.extname(filePath))
  }

  async getFileDiagnostics(rootPath: string, absoluteFilePath: string): Promise<CodeDiagnostic[]> {
    if (!this.supportsFile(absoluteFilePath)) {
      return []
    }

    try {
      const normalizedRoot = path.resolve(rootPath)
      const fileName = normalizePath(absoluteFilePath)
      const ctx = this.getOrCreateContext(normalizedRoot)

      // 该文件可能不在 tsconfig include 内（例如新建文件）——补进额外文件集。
      if (!ctx.rootFiles.has(fileName)) {
        ctx.extraFiles.add(fileName)
      }

      // 磁盘内容刚变，bump 版本让 LanguageService 丢弃旧快照重新读取。
      ctx.versions.set(fileName, (ctx.versions.get(fileName) ?? 0) + 1)

      const raw = [
        ...ctx.service.getSyntacticDiagnostics(fileName),
        ...ctx.service.getSemanticDiagnostics(fileName),
      ]

      return this.mapDiagnostics(raw, normalizedRoot, fileName)
    } catch (error) {
      // 诊断是建议性的：任何内部失败都退化为「无诊断」，绝不影响已落盘的写入。
      this.logger.debug('Diagnostics failed, skipping', {
        file: absoluteFilePath,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  /** 文件大量变更后可调用以强制重建语言服务。 */
  invalidate(rootPath?: string): void {
    if (rootPath) {
      this.contexts.get(path.resolve(rootPath))?.service.dispose()
      this.contexts.delete(path.resolve(rootPath))
    } else {
      for (const ctx of this.contexts.values()) ctx.service.dispose()
      this.contexts.clear()
    }
  }

  // ── 语言服务构建 ────────────────────────────────────────────────

  private getOrCreateContext(rootPath: string): ServiceContext {
    const existing = this.contexts.get(rootPath)
    if (existing) return existing

    const { fileNames, options } = this.resolveProject(rootPath)
    const rootFiles = new Set(fileNames.map(normalizePath))
    const extraFiles = new Set<string>()
    const versions = new Map<string, number>()

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => [...rootFiles, ...extraFiles],
      getScriptVersion: (fileName) => String(versions.get(normalizePath(fileName)) ?? 0),
      getScriptSnapshot: (fileName) => {
        try {
          return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'))
        } catch {
          return undefined
        }
      },
      getCurrentDirectory: () => rootPath,
      getCompilationSettings: () => options,
      getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    }

    const context: ServiceContext = {
      service: ts.createLanguageService(host, ts.createDocumentRegistry()),
      versions,
      rootFiles,
      extraFiles,
      options,
    }
    this.contexts.set(rootPath, context)
    return context
  }

  private resolveProject(rootPath: string): { fileNames: string[]; options: ts.CompilerOptions } {
    const tsConfigPath = ts.findConfigFile(rootPath, ts.sys.fileExists, 'tsconfig.json')
    if (tsConfigPath) {
      const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile)
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootPath)
      return {
        fileNames: parsed.fileNames,
        options: { ...parsed.options, skipLibCheck: true, noEmit: true },
      }
    }

    // 无 tsconfig — 与索引器一致的回退默认值。
    return {
      fileNames: [],
      options: {
        allowJs: true,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
        skipLibCheck: true,
        noEmit: true,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
      },
    }
  }

  private mapDiagnostics(
    raw: readonly ts.Diagnostic[],
    rootPath: string,
    fileName: string,
  ): CodeDiagnostic[] {
    const mapped: CodeDiagnostic[] = []

    for (const diag of raw) {
      // 只保留发生在被编辑文件上的诊断（语义诊断可能牵连其它文件）。
      if (!diag.file || normalizePath(diag.file.fileName) !== fileName) continue
      if (diag.category !== ts.DiagnosticCategory.Error && diag.category !== ts.DiagnosticCategory.Warning) {
        continue
      }

      const start = diag.start ?? 0
      const { line, character } = diag.file.getLineAndCharacterOfPosition(start)
      mapped.push({
        file: path.relative(rootPath, diag.file.fileName).replace(/\\/g, '/'),
        line: line + 1,
        column: character + 1,
        severity: diag.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        code: diag.code,
        message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
      })
    }

    mapped.sort((a, b) => a.line - b.line || a.column - b.column)
    return mapped.slice(0, MAX_DIAGNOSTICS_PER_FILE)
  }
}

/** TS 内部一律用正斜杠绝对路径；统一归一化以便版本表和过滤比对。 */
function normalizePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/')
}
