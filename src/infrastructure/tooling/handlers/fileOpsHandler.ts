import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import type {
  ToolExecutionRequest,
  ToolExecutionResult,
} from '../../../application/ports/ToolExecutorPort'
import {
  MAX_DIRECTORY_ENTRIES,
  MAX_FILE_READ_CHARS,
  MAX_FILE_WRITE_CHARS,
  countOccurrences,
  isLikelyTextPath,
  parseJsonObject,
  replaceFirst,
  resolveWorkspacePath,
} from '../toolPathGuard'
import { describeError, toolFailure, toolSuccess } from './ToolHandler'

/** 解析后的 file-ops 请求，避免每个动作重复解 JSON。 */
export interface FileOpsRequest {
  action: string
  prompt: Record<string, unknown>
  resolvedPath: string
  request: ToolExecutionRequest
}

export function parseFileOpsRequest(
  request: ToolExecutionRequest,
): { ok: true; value: FileOpsRequest } | { ok: false; result: ToolExecutionResult } {
  const prompt = parseJsonObject(request.input)
  const action = typeof prompt.action === 'string' ? prompt.action.trim().toLowerCase() : 'read'
  const rawPath = typeof prompt.path === 'string' ? prompt.path.trim() : '.'
  const resolvedPath = resolveWorkspacePath(request.workspace.rootPath, rawPath)

  if (!resolvedPath) {
    return {
      ok: false,
      result: toolFailure(request.toolId, 'Path must stay inside the current workspace.'),
    }
  }

  return { ok: true, value: { action, prompt, resolvedPath, request } }
}

export async function runFileOps(input: FileOpsRequest): Promise<ToolExecutionResult> {
  switch (input.action) {
    case 'read':
      return readFileAction(input)
    case 'list':
      return listDirectoryAction(input)
    case 'write':
      return writeFileAction(input)
    case 'update':
    case 'patch':
      return patchFileAction(input)
    default:
      return toolFailure(
        input.request.toolId,
        'Unsupported file-ops action. Supported: read, list, write, update, patch.',
      )
  }
}

async function readFileAction(input: FileOpsRequest): Promise<ToolExecutionResult> {
  const { request, resolvedPath } = input

  try {
    const fileInfo = await stat(resolvedPath)
    if (!fileInfo.isFile()) {
      return toolFailure(request.toolId, 'The requested path is not a file.')
    }

    // 面向模型的截断：保护上下文窗口，与终端高度无关，因此按字符算。
    // 必须说明省了多少 —— 否则模型无从判断自己看到的是全文还是一角，
    // 会拿残缺内容当完整内容用。
    const content = await readFile(resolvedPath, 'utf8')
    const truncated =
      content.length > MAX_FILE_READ_CHARS
        ? `${content.slice(0, MAX_FILE_READ_CHARS)}\n\n[truncated: ${
            content.length - MAX_FILE_READ_CHARS
          } of ${content.length} characters omitted]`
        : content

    return toolSuccess(
      request.toolId,
      [`File: ${toRelativePath(request, resolvedPath)}`, '', truncated].join('\n'),
    )
  } catch (error) {
    return toolFailure(request.toolId, describeError(error, 'Failed to read the file.'))
  }
}

async function listDirectoryAction(input: FileOpsRequest): Promise<ToolExecutionResult> {
  const { request, resolvedPath } = input

  try {
    const directoryInfo = await stat(resolvedPath)
    if (!directoryInfo.isDirectory()) {
      return toolFailure(request.toolId, 'The requested path is not a directory.')
    }

    const entries = await readdir(resolvedPath, { withFileTypes: true })
    const lines = entries
      .filter((entry) => entry.name !== '.git' && entry.name !== 'node_modules')
      .slice(0, MAX_DIRECTORY_ENTRIES)
      .map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)

    return toolSuccess(
      request.toolId,
      [`Directory: ${toRelativePath(request, resolvedPath)}`, ...lines].join('\n'),
    )
  } catch (error) {
    return toolFailure(request.toolId, describeError(error, 'Failed to list the directory.'))
  }
}

async function writeFileAction(input: FileOpsRequest): Promise<ToolExecutionResult> {
  const { prompt, request, resolvedPath } = input
  const content = typeof prompt.content === 'string' ? prompt.content : null

  if (prompt.allowWrite !== true) {
    return toolFailure(
      request.toolId,
      'Write access requires explicit confirmation in the payload. Use {"action":"write","path":"...","content":"...","allowWrite":true}.',
    )
  }

  if (content === null) {
    return toolFailure(request.toolId, 'Missing required field "content" for file-ops write.')
  }

  if (!isLikelyTextPath(resolvedPath)) {
    return toolFailure(request.toolId, 'Only text-like files can be written in this build.')
  }

  if (content.length > MAX_FILE_WRITE_CHARS) {
    return toolFailure(
      request.toolId,
      `Write content is too large. Limit: ${MAX_FILE_WRITE_CHARS} characters.`,
    )
  }

  try {
    await mkdir(dirname(resolvedPath), { recursive: true })
    await writeFile(resolvedPath, content, 'utf8')

    return toolSuccess(
      request.toolId,
      [
        `File written: ${toRelativePath(request, resolvedPath)}`,
        `Characters: ${content.length}`,
      ].join('\n'),
    )
  } catch (error) {
    return toolFailure(request.toolId, describeError(error, 'Failed to write the file.'))
  }
}

/**
 * 定点替换。
 * 默认要求单次精确命中，避免模型一次改掉多处；全量替换必须显式声明 replaceAll。
 */
async function patchFileAction(input: FileOpsRequest): Promise<ToolExecutionResult> {
  const { prompt, request, resolvedPath } = input
  const oldText = typeof prompt.oldText === 'string' ? prompt.oldText : null
  const newText = typeof prompt.newText === 'string' ? prompt.newText : null
  const replaceAll = prompt.replaceAll === true
  const expectedCount = resolveExpectedCount(prompt.expectedCount, replaceAll)

  if (prompt.allowWrite !== true) {
    return toolFailure(
      request.toolId,
      'Patch access requires explicit confirmation in the payload. Use {"action":"update","path":"...","oldText":"...","newText":"...","allowWrite":true}.',
    )
  }

  if (oldText === null || newText === null) {
    return toolFailure(
      request.toolId,
      'Missing required fields "oldText" and/or "newText" for file-ops update.',
    )
  }

  if (!oldText) {
    return toolFailure(request.toolId, 'Field "oldText" cannot be empty for file-ops update.')
  }

  if (!isLikelyTextPath(resolvedPath)) {
    return toolFailure(request.toolId, 'Only text-like files can be patched in this build.')
  }

  try {
    const fileInfo = await stat(resolvedPath)
    if (!fileInfo.isFile()) {
      return toolFailure(request.toolId, 'The requested path is not a file.')
    }

    const currentContent = await readFile(resolvedPath, 'utf8')
    const matchCount = countOccurrences(currentContent, oldText)

    if (matchCount === 0) {
      return toolFailure(request.toolId, 'No matching content found for file-ops update.')
    }

    if (expectedCount !== undefined && matchCount !== expectedCount) {
      return toolFailure(
        request.toolId,
        `Expected ${expectedCount} match(es), but found ${matchCount}.`,
      )
    }

    const nextContent = replaceAll
      ? currentContent.split(oldText).join(newText)
      : replaceFirst(currentContent, oldText, newText)

    if (nextContent.length > MAX_FILE_WRITE_CHARS) {
      return toolFailure(
        request.toolId,
        `Patched content is too large. Limit: ${MAX_FILE_WRITE_CHARS} characters.`,
      )
    }

    await writeFile(resolvedPath, nextContent, 'utf8')

    return toolSuccess(
      request.toolId,
      [
        `File updated: ${toRelativePath(request, resolvedPath)}`,
        `Replacements: ${replaceAll ? matchCount : 1}`,
      ].join('\n'),
    )
  } catch (error) {
    return toolFailure(request.toolId, describeError(error, 'Failed to update the file.'))
  }
}

function resolveExpectedCount(rawValue: unknown, replaceAll: boolean): number | undefined {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return Math.max(1, Math.trunc(rawValue))
  }

  return replaceAll ? undefined : 1
}

function toRelativePath(request: ToolExecutionRequest, resolvedPath: string): string {
  return relative(request.workspace.rootPath, resolvedPath) || '.'
}
