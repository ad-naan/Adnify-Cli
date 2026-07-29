import { extname, resolve } from 'node:path'

export const MAX_FILE_READ_CHARS = 12_000
export const MAX_FILE_WRITE_CHARS = 80_000
export const MAX_DIRECTORY_ENTRIES = 40
export const MAX_SCAN_FILES = 200
export const DEFAULT_SEARCH_LIMIT = 8

export const TEXT_EXTENSIONS = new Set([
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

/** 工具入参统一是 JSON 字符串，解析失败时退回空对象，由各 handler 自行校验必填项。 */
export function parseJsonObject(input: string): Record<string, unknown> {
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

/**
 * 把候选路径限制在工作区内，越界返回 null。
 * 这是文件类工具的第一道边界，不依赖审批结果。
 */
export function resolveWorkspacePath(rootPath: string, candidatePath: string): string | null {
  const workspaceRoot = resolve(rootPath)
  const nextPath = resolve(workspaceRoot, candidatePath || '.')

  if (nextPath === workspaceRoot) {
    return nextPath
  }

  return nextPath.startsWith(`${workspaceRoot}\\`) || nextPath.startsWith(`${workspaceRoot}/`)
    ? nextPath
    : null
}

/** 当前构建只允许改文本类文件，避免误写二进制内容。 */
export function isLikelyTextPath(filePath: string): boolean {
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

export function replaceFirst(content: string, oldText: string, newText: string): string {
  const matchIndex = content.indexOf(oldText)
  if (matchIndex === -1) {
    return content
  }

  return content.slice(0, matchIndex) + newText + content.slice(matchIndex + oldText.length)
}

export function countOccurrences(content: string, search: string): number {
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
