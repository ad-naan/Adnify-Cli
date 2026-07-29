import { readFile, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { extname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SCAN_FILES,
  TEXT_EXTENSIONS,
  parseJsonObject,
} from '../toolPathGuard'
import { toolFailure, toolSuccess, type ToolHandler } from './ToolHandler'

const execFileAsync = promisify(execFile)

/** 优先用 ripgrep，缺失时回退到有限范围的手工扫描。 */
export const handleSearchIndex: ToolHandler = async (request) => {
  const prompt = parseJsonObject(request.input)
  const query = typeof prompt.query === 'string' ? prompt.query.trim() : ''
  const limit =
    typeof prompt.limit === 'number' && Number.isFinite(prompt.limit)
      ? Math.max(1, Math.min(20, Math.trunc(prompt.limit)))
      : DEFAULT_SEARCH_LIMIT

  if (!query) {
    return toolFailure(request.toolId, 'Missing required field "query".')
  }

  const rgResult = await tryRipgrepSearch(request.workspace.rootPath, query, limit)
  if (rgResult) {
    return toolSuccess(request.toolId, rgResult)
  }

  return toolSuccess(
    request.toolId,
    await fallbackSearch(request.workspace.rootPath, query, limit),
  )
}

async function tryRipgrepSearch(
  rootPath: string,
  query: string,
  limit: number,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'rg',
      [
        '--line-number',
        '--no-heading',
        '--color',
        'never',
        '--max-count',
        String(limit),
        query,
        '.',
      ],
      { cwd: rootPath, windowsHide: true, maxBuffer: 1024 * 1024 },
    )

    const trimmed = stdout.trim()
    return trimmed || 'No matches found.'
  } catch {
    return null
  }
}

async function fallbackSearch(rootPath: string, query: string, limit: number): Promise<string> {
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
