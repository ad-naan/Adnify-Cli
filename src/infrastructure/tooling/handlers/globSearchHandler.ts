import { readdir } from 'node:fs/promises'
import {relative } from 'node:path'
import { parseJsonObject } from '../toolPathGuard'
import { toolFailure, toolSuccess, type ToolHandler } from './ToolHandler'

const MAX_GLOB_RESULTS = 100
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '.nuxt',
  '.output',
  'build',
  '.cache',
  'coverage',
  '.turbo',
])

/**
 * 将 glob pattern 转为 RegExp。
 * 支持: `*` (单层), `**` (多层), `?` (单字符), `{a,b}` (枚举), `[abc]` (字符集)。
 */
function globToRegex(pattern: string): RegExp {
  let regex = ''
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]

    if (char === '*' && pattern[i + 1] === '*') {
      regex += '.*'
      i += 2
      if (pattern[i] === '/') i++
    } else if (char === '*') {
      regex += '[^/]*'
      i++
    } else if (char === '?') {
      regex += '[^/]'
      i++
    } else if (char === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1) {
        regex += '\\{'
        i++
      } else {
        const options = pattern.slice(i + 1, end).split(',').join('|')
        regex += `(?:${options})`
        i = end + 1
      }
    } else if (char === '[') {
      const end = pattern.indexOf(']', i)
      if (end === -1) {
        regex += '\\['
        i++
      } else {
        regex += pattern.slice(i, end + 1)
        i = end + 1
      }
    } else if ('.+^$()|\\'.includes(char)) {
      regex += `\\${char}`
      i++
    } else {
      regex += char
      i++
    }
  }

  return new RegExp(`^${regex}$`)
}

async function collectGlobMatches(
  rootPath: string,
  dirPath: string,
  patterns: RegExp[],
  results: string[],
): Promise<void> {
  if (results.length >= MAX_GLOB_RESULTS) return

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (results.length >= MAX_GLOB_RESULTS) return

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const childPath = `${dirPath}/${entry.name}`
      // Check if the directory path itself matches any pattern
      const relPath = relative(rootPath, childPath).replace(/\\/g, '/')
      if (patterns.some((p) => p.test(relPath))) {
        results.push(`${relPath}/`)
      }
      await collectGlobMatches(rootPath, childPath, patterns, results)
    } else {
      const relPath = relative(rootPath, `${dirPath}/${entry.name}`).replace(/\\/g, '/')
      if (patterns.some((p) => p.test(relPath))) {
        results.push(relPath)
      }
    }
  }
}

/** Match files by glob-style patterns inside the workspace. */
export const handleGlobSearch: ToolHandler = async (request) => {
  const params = parseJsonObject(request.input)
  const pattern = typeof params.pattern === 'string' ? params.pattern.trim() : ''
  const patternsRaw = Array.isArray(params.patterns) ? (params.patterns as unknown[]) : []
  const patterns: string[] = patternsRaw
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter(Boolean)

  if (pattern) patterns.push(pattern)
  if (patterns.length === 0) {
    return toolFailure(request.toolId, 'Missing required field "pattern" or "patterns". Example: {"pattern":"src/**/*.ts"}')
  }

  const regexes = patterns.map((p) => globToRegex(p))
  const results: string[] = []
  await collectGlobMatches(request.workspace.rootPath, request.workspace.rootPath, regexes, results)

  if (results.length === 0) {
    return toolSuccess(request.toolId, `No files matched patterns: ${patterns.join(', ')}`)
  }

  const header = results.length >= MAX_GLOB_RESULTS
    ? `Found ${results.length}+ files (truncated):`
    : `Found ${results.length} file(s):`

  return toolSuccess(request.toolId, `${header}\n${results.join('\n')}`)
}
