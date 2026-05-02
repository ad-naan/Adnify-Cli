import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  ToolExecutionRequest,
  ToolExecutionResult,
} from '../../application/ports/ToolExecutorPort'
import type { ToolExecutorPort } from '../../application/ports/ToolExecutorPort'

const execFileAsync = promisify(execFile)
const DEFAULT_SEARCH_LIMIT = 8
const DEFAULT_GLOB_LIMIT = 20
const DEFAULT_SHELL_TIMEOUT_MS = 30_000
const MAX_SHELL_TIMEOUT_MS = 120_000
const MAX_SCAN_FILES = 200
const MAX_DIRECTORY_ENTRIES = 40
const MAX_FILE_READ_CHARS = 12_000
const MAX_FILE_WRITE_CHARS = 80_000
const MAX_WEB_FETCH_CHARS = 20_000
const DEFAULT_WEB_SEARCH_LIMIT = 5
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.toml',
  '.css',
  '.scss',
  '.html',
  '.sh',
  '.ps1',
  '.env',
])
const ALLOWED_TEXT_FILENAMES = new Set([
  'readme',
  'license',
  '.gitignore',
  '.gitattributes',
  '.npmrc',
  '.prettierrc',
  '.prettierignore',
  '.eslintrc',
  '.eslintignore',
  '.editorconfig',
  '.env',
  '.env.example',
  '.rules',
])

type ExecRunner = (
  file: string,
  args?: readonly string[] | null,
  options?: {
    cwd?: string
    windowsHide?: boolean
    maxBuffer?: number
    timeout?: number
  },
) => Promise<{
  stdout: string
  stderr: string
}>

export class LocalToolExecutor implements ToolExecutorPort {
  constructor(private readonly execRunner: ExecRunner = execFileAsync) {}

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    switch (request.toolId) {
      case 'workspace-read':
        return this.executeWorkspaceRead(request)
      case 'search-index':
        return this.executeSearchIndex(request)
      case 'glob-search':
        return this.executeGlobSearch(request)
      case 'file-ops':
        return this.executeFileOps(request)
      case 'shell-runner':
        return this.executeShellRunner(request)
      case 'web-fetch':
        return this.executeWebFetch(request)
      case 'web-search':
        return this.executeWebSearch(request)
      default:
        return {
          toolId: request.toolId,
          ok: false,
          content: `Tool "${request.toolId}" is not implemented yet.`,
        }
    }
  }

  private async executeWorkspaceRead(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult> {
    const prompt = parseJsonObject(request.input)
    const focus = typeof prompt.focus === 'string' ? prompt.focus : 'workspace'
    const entries = request.workspace.topLevelEntries.slice(0, 12).join(', ') || '(empty)'

    return {
      toolId: request.toolId,
      ok: true,
      content: [
        `Focus: ${focus}`,
        `Root: ${request.workspace.rootPath}`,
        `Git: ${request.workspace.isGitRepository ? 'yes' : 'no'}`,
        `Package manager: ${request.workspace.packageManager}`,
        `Top-level entries: ${entries}`,
      ].join('\n'),
    }
  }

  private async executeSearchIndex(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const prompt = parseJsonObject(request.input)
    const query = typeof prompt.query === 'string' ? prompt.query.trim() : ''
    const limit =
      typeof prompt.limit === 'number' && Number.isFinite(prompt.limit)
        ? Math.max(1, Math.min(20, Math.trunc(prompt.limit)))
        : DEFAULT_SEARCH_LIMIT

    if (!query) {
      return {
        toolId: request.toolId,
        ok: false,
        content: 'Missing required field "query".',
      }
    }

    const rgResult = await this.tryRipgrepSearch(request.workspace.rootPath, query, limit)
    if (rgResult) {
      return {
        toolId: request.toolId,
        ok: true,
        content: rgResult,
      }
    }

    return {
      toolId: request.toolId,
      ok: true,
      content: await this.fallbackSearch(request.workspace.rootPath, query, limit),
    }
  }

  private async executeGlobSearch(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const prompt = parseJsonObject(request.input)
    const pattern = typeof prompt.pattern === 'string' ? prompt.pattern.trim() : ''
    const rawPath = typeof prompt.path === 'string' ? prompt.path.trim() : '.'
    const limit =
      typeof prompt.limit === 'number' && Number.isFinite(prompt.limit)
        ? Math.max(1, Math.min(100, Math.trunc(prompt.limit)))
        : DEFAULT_GLOB_LIMIT

    if (!pattern) {
      return {
        toolId: request.toolId,
        ok: false,
        content: 'Missing required field "pattern". Example: {"pattern":"src/**/*.ts"}',
      }
    }

    const resolvedPath = resolveWorkspacePath(request.workspace.rootPath, rawPath)
    if (!resolvedPath) {
      return {
        toolId: request.toolId,
        ok: false,
        content: 'Path must stay inside the current workspace.',
      }
    }

    const relativeBase = relative(request.workspace.rootPath, resolvedPath) || '.'

    const rgResult = await this.tryRipgrepGlob(request.workspace.rootPath, relativeBase, pattern, limit)
    const matches =
      rgResult && rgResult.length > 0
        ? rgResult
        : await this.fallbackGlobSearch(request.workspace.rootPath, resolvedPath, pattern, limit)

    if (matches.length === 0) {
      return {
        toolId: request.toolId,
        ok: true,
        content: `Pattern: ${pattern}\nBase: ${relativeBase}\nNo matches found.`,
      }
    }

    return {
      toolId: request.toolId,
      ok: true,
      content: [
        `Pattern: ${pattern}`,
        `Base: ${relativeBase}`,
        '',
        ...matches,
      ].join('\n'),
    }
  }

  private async executeFileOps(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const prompt = parseJsonObject(request.input)
    const action = typeof prompt.action === 'string' ? prompt.action.trim().toLowerCase() : 'read'
    const rawPath = typeof prompt.path === 'string' ? prompt.path.trim() : '.'

    const resolvedPath = resolveWorkspacePath(request.workspace.rootPath, rawPath)
    if (!resolvedPath) {
      return {
        toolId: request.toolId,
        ok: false,
        content: 'Path must stay inside the current workspace.',
      }
    }

    if (action === 'read') {
      try {
        const fileInfo = await stat(resolvedPath)
        if (!fileInfo.isFile()) {
          return {
            toolId: request.toolId,
            ok: false,
            content: 'The requested path is not a file.',
          }
        }

        const content = await readFile(resolvedPath, 'utf8')
        const relativePath = relative(request.workspace.rootPath, resolvedPath) || '.'
        const truncated =
          content.length > MAX_FILE_READ_CHARS
            ? `${content.slice(0, MAX_FILE_READ_CHARS)}\n\n[truncated]`
            : content

        return {
          toolId: request.toolId,
          ok: true,
          content: [`File: ${relativePath}`, '', truncated].join('\n'),
        }
      } catch (error) {
        return {
          toolId: request.toolId,
          ok: false,
          content: error instanceof Error ? error.message : 'Failed to read the file.',
        }
      }
    }

    if (action === 'list') {
      try {
        const directoryInfo = await stat(resolvedPath)
        if (!directoryInfo.isDirectory()) {
          return {
            toolId: request.toolId,
            ok: false,
            content: 'The requested path is not a directory.',
          }
        }

        const entries = await readdir(resolvedPath, { withFileTypes: true })
        const lines = entries
          .filter((entry) => entry.name !== '.git' && entry.name !== 'node_modules')
          .slice(0, MAX_DIRECTORY_ENTRIES)
          .map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)

        return {
          toolId: request.toolId,
          ok: true,
          content: [
            `Directory: ${relative(request.workspace.rootPath, resolvedPath) || '.'}`,
            ...lines,
          ].join('\n'),
        }
      } catch (error) {
        return {
          toolId: request.toolId,
          ok: false,
          content: error instanceof Error ? error.message : 'Failed to list the directory.',
        }
      }
    }

    if (action === 'write') {
      const content = typeof prompt.content === 'string' ? prompt.content : null
      const allowWrite = prompt.allowWrite === true

      if (!allowWrite) {
        return {
          toolId: request.toolId,
          ok: false,
          content:
            'Write access requires explicit confirmation in the payload. Use {"action":"write","path":"...","content":"...","allowWrite":true}.',
        }
      }

      if (content === null) {
        return {
          toolId: request.toolId,
          ok: false,
          content: 'Missing required field "content" for file-ops write.',
        }
      }

      if (!isLikelyTextPath(resolvedPath)) {
        return {
          toolId: request.toolId,
          ok: false,
          content: 'Only text-like files can be written in this build.',
        }
      }

      if (content.length > MAX_FILE_WRITE_CHARS) {
        return {
          toolId: request.toolId,
          ok: false,
          content: `Write content is too large. Limit: ${MAX_FILE_WRITE_CHARS} characters.`,
        }
      }

      try {
        await mkdir(dirname(resolvedPath), { recursive: true })
        await writeFile(resolvedPath, content, 'utf8')

        const relativePath = relative(request.workspace.rootPath, resolvedPath) || '.'
        return {
          toolId: request.toolId,
          ok: true,
          content: [
            `File written: ${relativePath}`,
            `Characters: ${content.length}`,
          ].join('\n'),
        }
      } catch (error) {
        return {
          toolId: request.toolId,
          ok: false,
          content: error instanceof Error ? error.message : 'Failed to write the file.',
        }
      }
    }

    if (action === 'update' || action === 'patch') {
      const allowWrite = prompt.allowWrite === true
      const oldText = typeof prompt.oldText === 'string' ? prompt.oldText : null
      const newText = typeof prompt.newText === 'string' ? prompt.newText : null
      const replaceAll = prompt.replaceAll === true
      const expectedCount =
        typeof prompt.expectedCount === 'number' && Number.isFinite(prompt.expectedCount)
          ? Math.max(1, Math.trunc(prompt.expectedCount))
          : replaceAll
            ? undefined
            : 1

      if (!allowWrite) {
        return {
          toolId: request.toolId,
          ok: false,
          content:
            'Patch access requires explicit confirmation in the payload. Use {"action":"update","path":"...","oldText":"...","newText":"...","allowWrite":true}.',
        }
      }

      if (oldText === null || newText === null) {
        return {
          toolId: request.toolId,
          ok: false,
          content: 'Missing required fields "oldText" and/or "newText" for file-ops update.',
        }
      }

      if (!oldText) {
        return {
          toolId: request.toolId,
          ok: false,
          content: 'Field "oldText" cannot be empty for file-ops update.',
        }
      }

      if (!isLikelyTextPath(resolvedPath)) {
        return {
          toolId: request.toolId,
          ok: false,
          content: 'Only text-like files can be patched in this build.',
        }
      }

      try {
        const fileInfo = await stat(resolvedPath)
        if (!fileInfo.isFile()) {
          return {
            toolId: request.toolId,
            ok: false,
            content: 'The requested path is not a file.',
          }
        }

        const currentContent = await readFile(resolvedPath, 'utf8')
        const matchCount = countOccurrences(currentContent, oldText)

        if (matchCount === 0) {
          return {
            toolId: request.toolId,
            ok: false,
            content: 'No matching content found for file-ops update.',
          }
        }

        if (expectedCount !== undefined && matchCount !== expectedCount) {
          return {
            toolId: request.toolId,
            ok: false,
            content: `Expected ${expectedCount} match(es), but found ${matchCount}.`,
          }
        }

        const nextContent = replaceAll
          ? currentContent.split(oldText).join(newText)
          : replaceFirst(currentContent, oldText, newText)

        if (nextContent.length > MAX_FILE_WRITE_CHARS) {
          return {
            toolId: request.toolId,
            ok: false,
            content: `Patched content is too large. Limit: ${MAX_FILE_WRITE_CHARS} characters.`,
          }
        }

        await writeFile(resolvedPath, nextContent, 'utf8')

        const relativePath = relative(request.workspace.rootPath, resolvedPath) || '.'
        return {
          toolId: request.toolId,
          ok: true,
          content: [
            `File updated: ${relativePath}`,
            `Replacements: ${replaceAll ? matchCount : 1}`,
          ].join('\n'),
        }
      } catch (error) {
        return {
          toolId: request.toolId,
          ok: false,
          content: error instanceof Error ? error.message : 'Failed to update the file.',
        }
      }
    }

    return {
      toolId: request.toolId,
      ok: false,
      content: 'Unsupported file-ops action. Supported: read, list, write, update, patch.',
    }
  }

  private async executeShellRunner(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult> {
    const prompt = parseJsonObject(request.input)
    const argv = Array.isArray(prompt.argv)
      ? prompt.argv.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : []
    const timeoutMs =
      typeof prompt.timeoutMs === 'number' && Number.isFinite(prompt.timeoutMs)
        ? Math.max(1_000, Math.min(MAX_SHELL_TIMEOUT_MS, Math.trunc(prompt.timeoutMs)))
        : DEFAULT_SHELL_TIMEOUT_MS

    if (argv.length === 0) {
      return {
        toolId: request.toolId,
        ok: false,
        content:
          'Missing required field "argv". Example: {"argv":["rg","useCliController","src"]}',
      }
    }

    const validation = validateShellCommand(argv, request.approvalGranted === true)
    if (!validation.ok) {
      return {
        toolId: request.toolId,
        ok: false,
        content: validation.reason,
      }
    }

    try {
      const { stdout, stderr } = await this.execRunner(argv[0]!, argv.slice(1), {
        cwd: request.workspace.rootPath,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: timeoutMs,
      })

      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      return {
        toolId: request.toolId,
        ok: true,
        content: output || 'Command completed with no output.',
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Shell command execution failed.'
      return {
        toolId: request.toolId,
        ok: false,
        content: message,
      }
    }
  }

  private async executeWebFetch(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const prompt = parseJsonObject(request.input)
    const url = typeof prompt.url === 'string' ? prompt.url.trim() : ''

    if (!url) {
      return {
        toolId: request.toolId,
        ok: false,
        content: 'Missing required field "url". Example: {"url":"https://example.com/docs"}',
      }
    }

    if (!isHttpUrl(url)) {
      return {
        toolId: request.toolId,
        ok: false,
        content: 'Only http and https URLs are supported.',
      }
    }

    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'Adnify-Cli/0.1',
          accept: 'text/plain,text/markdown,text/html,application/json;q=0.9,*/*;q=0.1',
        },
      })

      if (!response.ok) {
        return {
          toolId: request.toolId,
          ok: false,
          content: `Request failed with status ${response.status} ${response.statusText}.`,
        }
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (
        contentType &&
        !contentType.includes('text/') &&
        !contentType.includes('json') &&
        !contentType.includes('xml') &&
        !contentType.includes('javascript')
      ) {
        return {
          toolId: request.toolId,
          ok: false,
          content: `Unsupported content type: ${contentType}. Only text-like responses are supported.`,
        }
      }

      const rawContent = await response.text()
      const content = rawContent.length > MAX_WEB_FETCH_CHARS
        ? `${rawContent.slice(0, MAX_WEB_FETCH_CHARS)}\n\n[truncated]`
        : rawContent

      return {
        toolId: request.toolId,
        ok: true,
        content: [
          `URL: ${url}`,
          `Content-Type: ${contentType || 'unknown'}`,
          '',
          content,
        ].join('\n'),
      }
    } catch (error) {
      return {
        toolId: request.toolId,
        ok: false,
        content: error instanceof Error ? error.message : 'Web fetch failed.',
      }
    }
  }

  private async executeWebSearch(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const prompt = parseJsonObject(request.input)
    const query = typeof prompt.query === 'string' ? prompt.query.trim() : ''
    const domain = typeof prompt.domain === 'string' ? prompt.domain.trim() : ''
    const limit =
      typeof prompt.limit === 'number' && Number.isFinite(prompt.limit)
        ? Math.max(1, Math.min(10, Math.trunc(prompt.limit)))
        : DEFAULT_WEB_SEARCH_LIMIT

    if (!query) {
      return {
        toolId: request.toolId,
        ok: false,
        content: 'Missing required field "query". Example: {"query":"Ink React terminal UI"}',
      }
    }

    const effectiveQuery = domain ? `${query} site:${domain}` : query
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(effectiveQuery)}`

    try {
      const response = await fetch(searchUrl, {
        headers: {
          'user-agent': 'Adnify-Cli/0.1',
          accept: 'text/html,application/xhtml+xml',
        },
      })

      if (!response.ok) {
        return {
          toolId: request.toolId,
          ok: false,
          content: `Request failed with status ${response.status} ${response.statusText}.`,
        }
      }

      const html = await response.text()
      const results = extractDuckDuckGoResults(html, limit)

      if (results.length === 0) {
        return {
          toolId: request.toolId,
          ok: true,
          content: `Query: ${effectiveQuery}\nNo results found.`,
        }
      }

      return {
        toolId: request.toolId,
        ok: true,
        content: [
          `Query: ${effectiveQuery}`,
          '',
          ...results.map((result, index) =>
            `${index + 1}. ${result.title}\n${result.url}${result.snippet ? `\n${result.snippet}` : ''}`,
          ),
        ].join('\n\n'),
      }
    } catch (error) {
      return {
        toolId: request.toolId,
        ok: false,
        content: error instanceof Error ? error.message : 'Web search failed.',
      }
    }
  }

  private async tryRipgrepSearch(
    rootPath: string,
    query: string,
    limit: number,
  ): Promise<string | null> {
    try {
      const { stdout } = await this.execRunner(
        'rg',
        ['--line-number', '--no-heading', '--color', 'never', '--max-count', String(limit), query, '.'],
        { cwd: rootPath, windowsHide: true, maxBuffer: 1024 * 1024 },
      )

      const trimmed = stdout.trim()
      return trimmed || 'No matches found.'
    } catch {
      return null
    }
  }

  private async tryRipgrepGlob(
    rootPath: string,
    relativeBase: string,
    pattern: string,
    limit: number,
  ): Promise<string[] | null> {
    try {
      const args = ['--files', '--color', 'never', '-g', pattern]
      if (relativeBase !== '.') {
        args.push(relativeBase)
      }

      const { stdout } = await this.execRunner('rg', args, {
        cwd: rootPath,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      })

      return stdout
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, limit)
    } catch {
      return null
    }
  }

  private async fallbackSearch(rootPath: string, query: string, limit: number): Promise<string> {
    const files = await collectSearchableFiles(rootPath, MAX_SCAN_FILES)
    const matches: string[] = []

    for (const filePath of files) {
      if (matches.length >= limit) {
        break
      }

      let content: string
      try {
        content = await readFile(filePath, 'utf8')
      } catch {
        continue
      }

      const lines = content.split(/\r?\n/g)
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (!line || !line.includes(query)) {
          continue
        }

        matches.push(`${relative(rootPath, filePath)}:${index + 1}:${line.trim()}`)
        if (matches.length >= limit) {
          break
        }
      }
    }

    return matches.length > 0 ? matches.join('\n') : 'No matches found.'
  }

  private async fallbackGlobSearch(
    rootPath: string,
    basePath: string,
    pattern: string,
    limit: number,
  ): Promise<string[]> {
    const files = await collectAllFiles(basePath, Math.max(10_000, limit * 200))
    const matcher = createGlobMatcher(pattern)

    return files
      .map((filePath) => relative(rootPath, filePath))
      .filter((filePath) => matcher(filePath.replaceAll('\\', '/')))
      .slice(0, limit)
  }
}

async function collectSearchableFiles(rootPath: string, limit: number): Promise<string[]> {
  const queue = [resolve(rootPath)]
  const files: string[] = []

  while (queue.length > 0 && files.length < limit) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (files.length >= limit) {
        break
      }

      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue
      }

      const nextPath = join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(nextPath)
        continue
      }

      if (TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(nextPath)
      }
    }
  }

  return files
}

async function collectAllFiles(rootPath: string, limit: number): Promise<string[]> {
  const queue = [resolve(rootPath)]
  const files: string[] = []

  while (queue.length > 0 && files.length < limit) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (files.length >= limit) {
        break
      }

      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue
      }

      const nextPath = join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(nextPath)
        continue
      }

      files.push(nextPath)
    }
  }

  return files
}

function parseJsonObject(input: string): Record<string, unknown> {
  if (!input.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(input)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function resolveWorkspacePath(rootPath: string, candidatePath: string): string | null {
  const workspaceRoot = resolve(rootPath)
  const nextPath = resolve(workspaceRoot, candidatePath || '.')

  if (nextPath === workspaceRoot) {
    return nextPath
  }

  return nextPath.startsWith(`${workspaceRoot}\\`) || nextPath.startsWith(`${workspaceRoot}/`)
    ? nextPath
    : null
}

function isLikelyTextPath(filePath: string): boolean {
  const normalizedName = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const extension = extname(normalizedName)

  if (TEXT_EXTENSIONS.has(extension)) {
    return true
  }

  if (ALLOWED_TEXT_FILENAMES.has(normalizedName)) {
    return true
  }

  return normalizedName.startsWith('.')
}

function replaceFirst(content: string, oldText: string, newText: string): string {
  const matchIndex = content.indexOf(oldText)
  if (matchIndex === -1) {
    return content
  }

  return (
    content.slice(0, matchIndex) +
    newText +
    content.slice(matchIndex + oldText.length)
  )
}

function countOccurrences(content: string, search: string): number {
  let count = 0
  let currentIndex = 0

  while (currentIndex <= content.length) {
    const matchIndex = content.indexOf(search, currentIndex)
    if (matchIndex === -1) {
      break
    }

    count += 1
    currentIndex = matchIndex + search.length
  }

  return count
}

function validateShellCommand(
  argv: string[],
  approvalGranted: boolean,
): { ok: true } | { ok: false; reason: string } {
  const command = argv[0]?.toLowerCase()
  if (!command) {
    return { ok: false, reason: 'Missing command name.' }
  }

  if (isReadonlyShellCommand(argv)) {
    return { ok: true }
  }

  if (!approvalGranted) {
    return {
      ok: false,
      reason:
        'This shell command requires explicit approval before execution. Without approval, only read-only commands are allowed: rg, git status/diff/log/show/branch/rev-parse.',
    }
  }

  if (isBlockedApprovedShellCommand(command)) {
    return {
      ok: false,
      reason:
        'Approved shell execution does not allow launching nested shell interpreters. Use workspace development commands directly: bun, bunx, npm, npx, node, git, rg.',
    }
  }

  if (!isApprovedShellExecutable(command)) {
    return {
      ok: false,
      reason:
        'Approved shell execution is limited to workspace development commands: bun, bunx, npm, npx, node, git, rg.',
    }
  }

  return { ok: true }
}

function isReadonlyShellCommand(argv: string[]): boolean {
  const command = argv[0]?.toLowerCase()
  if (!command) {
    return false
  }

  if (command === 'rg') {
    return true
  }

  if (command !== 'git') {
    return false
  }

  const subcommand = argv[1]?.toLowerCase()
  const allowed = new Set(['status', 'diff', 'log', 'show', 'branch', 'rev-parse'])
  return Boolean(subcommand && allowed.has(subcommand))
}

function isApprovedShellExecutable(command: string): boolean {
  return (
    command === 'bun' ||
    command === 'bunx' ||
    command === 'npm' ||
    command === 'npx' ||
    command === 'node' ||
    command === 'git' ||
    command === 'rg'
  )
}

function isBlockedApprovedShellCommand(command: string): boolean {
  return (
    command === 'cmd' ||
    command === 'powershell' ||
    command === 'pwsh' ||
    command === 'sh' ||
    command === 'bash'
  )
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function extractDuckDuckGoResults(
  html: string,
  limit: number,
): Array<{ title: string; url: string; snippet: string }> {
  const matches = [...html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
  const results: Array<{ title: string; url: string; snippet: string }> = []

  for (const [_, href = '', rawTitle = ''] of matches) {
    if (results.length >= limit) {
      break
    }

    const url = normalizeDuckDuckGoResultUrl(decodeHtmlEntities(href))
    const title = stripHtmlTags(decodeHtmlEntities(rawTitle)).trim()

    if (!url || !title) {
      continue
    }

    results.push({
      title,
      url,
      snippet: '',
    })
  }

  return results
}

function normalizeDuckDuckGoResultUrl(value: string): string {
  if (!value) {
    return ''
  }

  if (value.startsWith('//')) {
    return `https:${value}`
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value
  }

  if (value.startsWith('/l/?')) {
    try {
      const url = new URL(`https://html.duckduckgo.com${value}`)
      return url.searchParams.get('uddg') ?? ''
    } catch {
      return ''
    }
  }

  return ''
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ')
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
}

function createGlobMatcher(pattern: string): (candidate: string) => boolean {
  const normalizedPattern = pattern.replaceAll('\\', '/')
  const regex = new RegExp(`^${globToRegex(normalizedPattern)}$`, 'i')
  return (candidate: string) => regex.test(candidate)
}

function globToRegex(pattern: string): string {
  let regex = ''

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    const next = pattern[index + 1]

    if (char === '*' && next === '*') {
      const afterNext = pattern[index + 2]
      if (afterNext === '/') {
        regex += '(?:.*/)?'
        index += 2
      } else {
        regex += '.*'
        index += 1
      }
      continue
    }

    if (char === '*') {
      regex += '[^/]*'
      continue
    }

    if (char === '?') {
      regex += '[^/]'
      continue
    }

    if ('\\.[]{}()+-^$|'.includes(char)) {
      regex += `\\${char}`
      continue
    }

    regex += char
  }

  return regex
}
