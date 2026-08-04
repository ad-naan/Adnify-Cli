import * as ts from 'typescript'
import * as path from 'node:path'
import * as fs from 'node:fs'
import type { CodeIndexerPort } from '../../application/ports/CodeIndexerPort'
import type { FileSymbolIndex, SymbolTag, SymbolKind } from '../../domain/workspace/value-objects/SymbolTag'
import type { LoggerPort } from '../../application/ports/LoggerPort'

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])

/** glob 形式的后缀列表，用于 ts.sys.readDirectory */
const SUPPORTED_EXTENSIONS_FOR_GLOB = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']

/** 默认排除的目录前缀（无论是否有 .gitignore） */
const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', '.cache', '.turbo', '__pycache__', '.vim', '.idea', '.vscode',
])

/** 索引保护性上限：防止超大型仓库 OOM */
const MAX_SOURCE_FILES = 8000

/** 符号提取最大嵌套深度：防止过深的类层次造成噪声 */
const MAX_SYMBOL_DEPTH = 3

/**
 * mtime 缓存条目。
 */
interface CacheEntry {
  mtimeMs: number
  index: FileSymbolIndex
}

/**
 * 使用 TypeScript 编译器引擎为 TS/JS 文件提供精确符号表和引用图。
 *
 * 设计决策：
 * 1. 直接嵌入 `ts.Program`（tsserver 底层引擎），零进程开销，启动快
 * 2. 支持 tsconfig.json 工程引用（monorepo）
 * 3. 文件级 mtime 缓存：仅重新解析变更过的文件
 * 4. .gitignore 感知：尊重仓库忽略规则
 * 5. 动态 import() / require() 引用提取
 * 6. per-file 错误隔离：单个文件解析失败不影响全局索引
 *
 * 提取的符号类型：
 * - class / interface / type / function / enum 声明
 * - method、property、accessor 级别符号
 * - namespace / module 声明
 * - 构造器参数属性（constructor parameter properties）
 * - 顶层 const (含箭头函数)
 */
export class TsLanguageServiceIndexer implements CodeIndexerPort {
  /** rootPath → Map<relativePath, CacheEntry> */
  private readonly cache = new Map<string, Map<string, CacheEntry>>()

  /** rootPath → 已排序的 exclude pattern 列表 */
  private readonly excludeCache = new Map<string, string[]>()

  constructor(
    private readonly logger: LoggerPort,
  ) {}

  supportsFile(filePath: string): boolean {
    const ext = path.extname(filePath)
    return SUPPORTED_EXTENSIONS.has(ext)
  }

  async indexWorkspace(rootPath: string): Promise<FileSymbolIndex[]> {
    const normalizedRoot = path.resolve(rootPath)

    // 1. Discover source files (respecting .gitignore, excludes, tsconfig)
    const sourceFiles = this.discoverSourceFiles(normalizedRoot)

    if (sourceFiles.length === 0) {
      this.logger.debug('No source files found', { rootPath: normalizedRoot })
      return []
    }

    if (sourceFiles.length > MAX_SOURCE_FILES) {
      this.logger.warn('Source file count exceeds safety limit, truncating', {
        count: sourceFiles.length,
        limit: MAX_SOURCE_FILES,
      })
    }

    const filesToIndex = sourceFiles.slice(0, MAX_SOURCE_FILES)

    // 2. Create TypeScript program
    const { program, compilerOptions } = this.createProgram(normalizedRoot, filesToIndex)

    // 3. Index each file with mtime cache & error isolation
    const rootCache = this.getOrCreateRootCache(normalizedRoot)
    const results: FileSymbolIndex[] = []

    for (const sourceFile of program.getSourceFiles()) {
      const filePath = sourceFile.fileName

      // Skip declaration files & node_modules
      if (filePath.includes('node_modules') || filePath.endsWith('.d.ts')) continue

      // Only include files under rootPath
      const relativePath = path.relative(normalizedRoot, filePath).replace(/\\/g, '/')
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue

      // Skip excluded files
      if (this.isExcluded(relativePath, normalizedRoot)) continue

      // Check mtime cache
      try {
        const stat = fs.statSync(filePath)
        const cached = rootCache.get(relativePath)
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          results.push(cached.index)
          continue
        }

        const index = this.indexSingleFile(sourceFile, program, normalizedRoot, compilerOptions)
        rootCache.set(relativePath, { mtimeMs: stat.mtimeMs, index })
        results.push(index)
      } catch (error) {
        this.logger.warn('Failed to index file, skipping', {
          file: relativePath,
          error: error instanceof Error ? error.message : String(error),
        })
        // Push a minimal entry so the file is still represented in the graph
        results.push({ path: relativePath, definitions: [], referencePaths: [] })
      }
    }

    this.logger.debug('Indexed workspace', {
      rootPath: normalizedRoot,
      fileCount: results.length,
      symbolCount: results.reduce((sum, f) => sum + f.definitions.length, 0),
      cachedCount: results.length,
    })

    return results
  }

  // ── Program creation ────────────────────────────────────────────

  private createProgram(
    rootPath: string,
    files: string[],
  ): { program: ts.Program; compilerOptions: ts.CompilerOptions } {
    const tsConfigPath = ts.findConfigFile(rootPath, ts.sys.fileExists, 'tsconfig.json')

    if (tsConfigPath) {
      const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile)
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        rootPath,
      )
      const program = ts.createProgram({
        rootNames: parsedConfig.fileNames,
        options: { ...parsedConfig.options, skipLibCheck: true, noEmit: true },
      })
      return { program, compilerOptions: parsedConfig.options }
    }

    // No tsconfig — fallback with sensible defaults
    const compilerOptions: ts.CompilerOptions = {
      allowJs: true,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    }

    const program = ts.createProgram({ rootNames: files, options: compilerOptions })
    return { program, compilerOptions }
  }

  // ── File discovery with .gitignore ──────────────────────────────

  private discoverSourceFiles(rootPath: string): string[] {
    const excludePatterns = this.loadExcludePatterns(rootPath)
    const allFiles = ts.sys.readDirectory(
      rootPath,
      SUPPORTED_EXTENSIONS_FOR_GLOB,
      excludePatterns,
      ['**/*'],
    )

    return allFiles.filter(
      (f) =>
        !f.includes('node_modules') &&
        !f.endsWith('.d.ts') &&
        !this.isPathInExcludedDir(f, rootPath),
    )
  }

  /**
   * 加载排除模式：合并 .gitignore 内容 + 默认排除目录。
   * .gitignore 模式被转换为 ts.sys.readDirectory 兼容的 glob 排除模式。
   */
  private loadExcludePatterns(rootPath: string): string[] {
    const cached = this.excludeCache.get(rootPath)
    if (cached) return cached

    const patterns: string[] = []

    // Default exclude dirs as glob patterns
    for (const dir of DEFAULT_EXCLUDE_DIRS) {
      patterns.push(`**/${dir}/**`)
    }

    // Parse .gitignore
    const gitignorePath = path.join(rootPath, '.gitignore')
    try {
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          // Convert gitignore pattern to glob
          patterns.push(this.gitignoreToGlob(trimmed))
        }
      }
    } catch {
      // .gitignore read failure is non-fatal
    }

    this.excludeCache.set(rootPath, patterns)
    return patterns
  }

  private gitignoreToGlob(pattern: string): string {
    // Strip leading /
    let p = pattern.replace(/^\/+/, '')
    // If it doesn't start with **, add prefix for nested matching
    if (!p.startsWith('**/')) {
      p = `**/${p}`
    }
    // Ensure directory patterns match contents
    if (p.endsWith('/')) {
      p = `${p}**`
    }
    return p
  }

  private isExcluded(relativePath: string, _rootPath: string): boolean {
    const parts = relativePath.split('/')
    for (const part of parts) {
      if (DEFAULT_EXCLUDE_DIRS.has(part)) return true
    }
    return false
  }

  private isPathInExcludedDir(absolutePath: string, rootPath: string): boolean {
    const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, '/')
    return this.isExcluded(relativePath, rootPath)
  }

  // ── Per-file indexing ───────────────────────────────────────────

  private indexSingleFile(
    sourceFile: ts.SourceFile,
    _program: ts.Program,
    rootPath: string,
    compilerOptions: ts.CompilerOptions,
  ): FileSymbolIndex {
    const relativePath = path.relative(rootPath, sourceFile.fileName).replace(/\\/g, '/')

    const definitions = this.extractSymbols(sourceFile)
    const referencePaths = this.extractReferences(sourceFile, compilerOptions, rootPath)

    return { path: relativePath, definitions, referencePaths }
  }

  /**
   * 从 AST 提取符号定义。
   *
   * 策略：广度优先递归，按 SyntaxKind 精确匹配声明节点。
   * 通过 level 控制最大深度，避免噪声。
   */
  private extractSymbols(sourceFile: ts.SourceFile): SymbolTag[] {
    const symbols: SymbolTag[] = []

    const visit = (node: ts.Node, level: number, parentQualifier?: string) => {
      if (level > MAX_SYMBOL_DEPTH) {
        ts.forEachChild(node, (child) => visit(child, level, parentQualifier))
        return
      }

      switch (node.kind) {
        // ── Top-level / class-level declarations ──
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.InterfaceDeclaration:
        case ts.SyntaxKind.TypeAliasDeclaration:
        case ts.SyntaxKind.EnumDeclaration:
        case ts.SyntaxKind.FunctionDeclaration: {
          const tag = this.createSymbolTag(node, sourceFile, level, parentQualifier)
          if (tag) {
            symbols.push(tag)
            // Visit children with new qualifier
            ts.forEachChild(node, (child) => visit(child, level + 1, tag.identifier))
          } else {
            ts.forEachChild(node, (child) => visit(child, level + 1, parentQualifier))
          }
          return
        }

        // ── Namespace / module declarations ──
        case ts.SyntaxKind.ModuleDeclaration: {
          const tag = this.createSymbolTag(node, sourceFile, level, parentQualifier)
          if (tag) {
            symbols.push(tag)
            // Visit body with namespace qualifier
            const body = (node as ts.ModuleDeclaration).body
            if (body) {
              visit(body, level + 1, tag.identifier)
            }
          }
          return
        }

        // ── Class/interface members ──
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.MethodSignature:
        case ts.SyntaxKind.PropertyDeclaration:
        case ts.SyntaxKind.PropertySignature:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor: {
          if (level > 0) {
            const tag = this.createSymbolTag(node, sourceFile, level, parentQualifier)
            if (tag) symbols.push(tag)
          }
          ts.forEachChild(node, (child) => visit(child, level + 1, parentQualifier))
          return
        }

        // ── Constructor parameter properties (`constructor(private foo: Bar)`) ──
        case ts.SyntaxKind.Constructor: {
          const ctor = node as ts.ConstructorDeclaration
          for (const param of ctor.parameters) {
            if (param.modifiers && param.modifiers.length > 0) {
              const name = param.name.getText(sourceFile)
              if (name) {
                const lineInfo = sourceFile.getLineAndCharacterOfPosition(param.getStart(sourceFile))
                symbols.push({
                  name,
                  kind: 'constructor-param' as SymbolKind,
                  line: lineInfo.line + 1,
                  level,
                  identifier: parentQualifier ? `${parentQualifier}#${name}` : name,
                })
              }
            }
          }
          ts.forEachChild(node, (child) => visit(child, level + 1, parentQualifier))
          return
        }

        // ── Enum members ──
        case ts.SyntaxKind.EnumMember: {
          if (level > 0) {
            const tag = this.createSymbolTag(node, sourceFile, level, parentQualifier)
            if (tag) symbols.push(tag)
          }
          return
        }

        // ── Top-level variable declarations (including arrow functions) ──
        case ts.SyntaxKind.VariableStatement: {
          if (level === 0) {
            const tag = this.createSymbolTag(node, sourceFile, level, parentQualifier)
            if (tag) symbols.push(tag)
          }
          ts.forEachChild(node, (child) => visit(child, level + 1, parentQualifier))
          return
        }

        default:
          ts.forEachChild(node, (child) => visit(child, level, parentQualifier))
      }
    }

    visit(sourceFile, 0)
    return symbols
  }

  private createSymbolTag(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    level: number,
    parentQualifier?: string,
  ): SymbolTag | null {
    let name: string | undefined
    let kind: SymbolKind = 'other'

    switch (node.kind) {
      case ts.SyntaxKind.ClassDeclaration:
        name = (node as ts.ClassDeclaration).name?.text
        kind = 'class'
        break
      case ts.SyntaxKind.InterfaceDeclaration:
        name = (node as ts.InterfaceDeclaration).name?.text
        kind = 'interface'
        break
      case ts.SyntaxKind.TypeAliasDeclaration:
        name = (node as ts.TypeAliasDeclaration).name.text
        kind = 'type'
        break
      case ts.SyntaxKind.EnumDeclaration:
        name = (node as ts.EnumDeclaration).name?.text
        kind = 'enum'
        break
      case ts.SyntaxKind.EnumMember: {
        const member = node as ts.EnumMember
        name = member.name.getText(sourceFile)
        kind = 'enum-member'
        break
      }
      case ts.SyntaxKind.FunctionDeclaration:
        name = (node as ts.FunctionDeclaration).name?.text
        kind = 'function'
        break
      case ts.SyntaxKind.MethodDeclaration:
      case ts.SyntaxKind.MethodSignature:
        name = (node as ts.MethodDeclaration | ts.MethodSignature).name?.getText(sourceFile)
        kind = 'method'
        break
      case ts.SyntaxKind.PropertyDeclaration:
      case ts.SyntaxKind.PropertySignature:
      case ts.SyntaxKind.GetAccessor:
      case ts.SyntaxKind.SetAccessor:
        name = (node as ts.PropertyDeclaration | ts.PropertySignature | ts.AccessorDeclaration).name?.getText(sourceFile)
        kind = 'property'
        break
      case ts.SyntaxKind.ModuleDeclaration: {
        const modDecl = node as ts.ModuleDeclaration
        name = typeof modDecl.name.text === 'string'
          ? modDecl.name.text
          : modDecl.name.getText(sourceFile)
        kind = modDecl.body?.kind === ts.SyntaxKind.ModuleDeclaration ? 'namespace' : 'module'
        break
      }
      case ts.SyntaxKind.VariableStatement: {
        const decl = (node as ts.VariableStatement).declarationList.declarations[0]
        name = decl?.name?.getText(sourceFile)
        // Detect arrow function assignments: `const foo = () => {}`
        if (name && decl?.initializer) {
          if (
            decl.initializer.kind === ts.SyntaxKind.ArrowFunction ||
            decl.initializer.kind === ts.SyntaxKind.FunctionExpression
          ) {
            kind = 'function'
          } else {
            kind = 'variable'
          }
        } else if (name) {
          kind = 'variable'
        }
        break
      }
    }

    if (!name) return null

    const lineAndChar = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const identifier = parentQualifier ? `${parentQualifier}#${name}` : name

    return { name, kind, line: lineAndChar.line + 1, level, identifier }
  }

  // ── Reference extraction ────────────────────────────────────────

  /**
   * 从文件中提取所有文件间引用路径。
   *
   * 捕获来源：
   * 1. import declarations: `import { X } from './path'`
   * 2. export declarations: `export * from './path'`
   * 3. dynamic imports: `import('./path')`
   * 4. require calls: `require('./path')`
   */
  private extractReferences(
    sourceFile: ts.SourceFile,
    compilerOptions: ts.CompilerOptions,
    rootPath: string,
  ): string[] {
    const refs: string[] = []
    const seen = new Set<string>()

    const visit = (node: ts.Node) => {
      // Static import / export declarations
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier
        if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
          const resolved = this.resolveModule(
            moduleSpecifier.text,
            sourceFile.fileName,
            compilerOptions,
            rootPath,
          )
          if (resolved && !seen.has(resolved)) {
            seen.add(resolved)
            refs.push(resolved)
          }
        }
      }

      // Dynamic import(): import("...")  — CallExpression with kind ImportCall
      if (node.kind === ts.SyntaxKind.CallExpression) {
        const callExpr = node as ts.CallExpression
        const isDynamicImport =
          callExpr.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (callExpr.expression.kind === ts.SyntaxKind.Identifier &&
            (callExpr.expression as ts.Identifier).text === 'require')

        if (isDynamicImport) {
          const arg = callExpr.arguments[0]
          if (arg && ts.isStringLiteral(arg)) {
            const resolved = this.resolveModule(
              arg.text,
              sourceFile.fileName,
              compilerOptions,
              rootPath,
            )
            if (resolved && !seen.has(resolved)) {
              seen.add(resolved)
              refs.push(resolved)
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    return refs
  }

  /**
   * 将 import 路径解析为工作区相对路径。
   * 跳过裸模块导入（npm 包）。
   */
  private resolveModule(
    specifier: string,
    containingFile: string,
    compilerOptions: ts.CompilerOptions,
    rootPath: string,
  ): string | null {
    // Skip bare module imports (npm packages)
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      return null
    }

    try {
      const result = ts.resolveModuleName(
        specifier,
        containingFile,
        compilerOptions,
        ts.sys,
      )

      const resolvedPath = result.resolvedModule?.resolvedFileName
      if (!resolvedPath || resolvedPath.includes('node_modules')) {
        return null
      }

      const relativePath = path.relative(rootPath, resolvedPath).replace(/\\/g, '/')
      if (relativePath.startsWith('..')) return null

      return relativePath
    } catch {
      return null
    }
  }

  // ── Cache management ────────────────────────────────────────────

  private getOrCreateRootCache(rootPath: string): Map<string, CacheEntry> {
    let cache = this.cache.get(rootPath)
    if (!cache) {
      cache = new Map()
      this.cache.set(rootPath, cache)
    }
    return cache
  }

  /**
   * 清除指定根路径的缓存。可在文件大量变更后调用以强制全量重建索引。
   */
  invalidateCache(rootPath?: string): void {
    if (rootPath) {
      this.cache.delete(rootPath)
      this.excludeCache.delete(rootPath)
    } else {
      this.cache.clear()
      this.excludeCache.clear()
    }
  }
}
