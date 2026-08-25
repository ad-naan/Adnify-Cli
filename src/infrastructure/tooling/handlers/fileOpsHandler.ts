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
  resolveFileToolPath,
} from '../toolPathGuard'
import { describeError, toolFailure, toolSuccess } from './ToolHandler'
import {
  findTolerantMatch,
  reindentReplacement,
  type TolerantStrategy,
} from '../fuzzyMatch'

/** 解析后的 file-ops 请求，避免每个动作重复解 JSON。 */
export interface FileOpsRequest {
  action: string
  prompt: Record<string, unknown>
  resolvedPath: string
  scope: 'workspace' | 'outside'
  request: ToolExecutionRequest
}

export function parseFileOpsRequest(
  request: ToolExecutionRequest,
): { ok: true; value: FileOpsRequest } | { ok: false; result: ToolExecutionResult } {
  const prompt = parseJsonObject(request.input)
  const action = typeof prompt.action === 'string' ? prompt.action.trim().toLowerCase() : 'read'
  const rawPath = typeof prompt.path === 'string' ? prompt.path.trim() : '.'
  const resolved = resolveFileToolPath(request.workspace.rootPath, rawPath)

  if (!resolved) {
    return {
      ok: false,
      result: toolFailure(request.toolId, 'Path must stay inside the current workspace.'),
    }
  }

  return {
    ok: true,
    value: { action, prompt, resolvedPath: resolved.resolvedPath, scope: resolved.scope, request },
  }
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
    case 'multi-patch':
      return multiPatchAction(input)
    default:
      return toolFailure(
        input.request.toolId,
        'Unsupported file-ops action. Supported: read, list, write, update, patch, multi-patch.',
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
      // 精确匹配 0 命中:对单点替换尝试空白容错定位(全量替换风险高,维持严格)。
      const tolerant = replaceAll ? null : tryTolerantReplacement(currentContent, oldText, newText)

      if (!tolerant) {
        return toolFailure(request.toolId, 'No matching content found for file-ops update.')
      }

      if (tolerant.matchCount > 1) {
        return toolFailure(
          request.toolId,
          `No exact match found; ${tolerant.matchCount} whitespace-tolerant matches are ambiguous. Add more surrounding context to "oldText" to pin a single location.`,
        )
      }

      if (tolerant.content.length > MAX_FILE_WRITE_CHARS) {
        return toolFailure(
          request.toolId,
          `Patched content is too large. Limit: ${MAX_FILE_WRITE_CHARS} characters.`,
        )
      }

      await writeFile(resolvedPath, tolerant.content, 'utf8')

      return toolSuccess(
        request.toolId,
        [
          `File updated: ${toRelativePath(request, resolvedPath)}`,
          `Replacements: 1 (matched via ${tolerant.strategy} tolerance; exact text not found)`,
        ].join('\n'),
      )
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

/**
 * 多 hunk 原子替换(multi-patch)。
 *
 * 设计目标:模型一次改多处时,不再被迫发 N 次 update、中途失败留下半成品状态。
 * 所有 hunk 先在内存里依次验证并应用,任一失败则整批拒绝,磁盘内容不变;
 * 全部成功才写盘一次 —— 要么全成,要么全不动。
 */
async function multiPatchAction(input: FileOpsRequest): Promise<ToolExecutionResult> {
  const { prompt, request, resolvedPath } = input

  if (prompt.allowWrite !== true) {
    return toolFailure(
      request.toolId,
      'Patch access requires explicit confirmation in the payload. Use {"action":"multi-patch","path":"...","patches":[{"oldText":"...","newText":"..."}],"allowWrite":true}.',
    )
  }

  const patches = Array.isArray(prompt.patches) ? prompt.patches : null
  if (!patches || patches.length === 0) {
    return toolFailure(
      request.toolId,
      'Missing required field "patches" (non-empty array) for file-ops multi-patch.',
    )
  }
  if (patches.length > MAX_MULTI_PATCH_HUNKS) {
    return toolFailure(
      request.toolId,
      `Too many patches in one multi-patch. Limit: ${MAX_MULTI_PATCH_HUNKS}.`,
    )
  }

  const hunks: Array<{ oldText: string; newText: string; replaceAll: boolean; expectedCount?: number }> = []
  for (let index = 0; index < patches.length; index += 1) {
    const hunk = patches[index]
    if (typeof hunk !== 'object' || hunk === null) {
      return toolFailure(request.toolId, `patches[${index}] must be an object.`)
    }
    const record = hunk as Record<string, unknown>
    const oldText = typeof record.oldText === 'string' ? record.oldText : null
    const newText = typeof record.newText === 'string' ? record.newText : null
    if (oldText === null || newText === null || !oldText) {
      return toolFailure(
        request.toolId,
        `patches[${index}] requires non-empty "oldText" and string "newText".`,
      )
    }
    hunks.push({
      oldText,
      newText,
      replaceAll: record.replaceAll === true,
      expectedCount: resolveExpectedCount(record.expectedCount, record.replaceAll === true),
    })
  }

  if (!isLikelyTextPath(resolvedPath)) {
    return toolFailure(request.toolId, 'Only text-like files can be patched in this build.')
  }

  try {
    const fileInfo = await stat(resolvedPath)
    if (!fileInfo.isFile()) {
      return toolFailure(request.toolId, 'The requested path is not a file.')
    }

    let content = await readFile(resolvedPath, 'utf8')
    const notes: string[] = []

    // 逐 hunk 在内存中应用;序号从 1 开始,方便与模型提供的 patches 下标对应。
    for (let index = 0; index < hunks.length; index += 1) {
      const applied = applySingleHunk(content, hunks[index])
      if (!applied.ok) {
        return toolFailure(
          request.toolId,
          `Atomic rejection — nothing was written. patches[${index}] failed: ${applied.error}`,
        )
      }
      content = applied.content
      notes.push(applied.note ? `  #${index + 1}: ${applied.note}` : `  #${index + 1}: ok`)
    }

    if (content.length > MAX_FILE_WRITE_CHARS) {
      return toolFailure(
        request.toolId,
        `Patched content is too large. Limit: ${MAX_FILE_WRITE_CHARS} characters.`,
      )
    }

    await writeFile(resolvedPath, content, 'utf8')

    return toolSuccess(
      request.toolId,
      [
        `File updated: ${toRelativePath(request, resolvedPath)}`,
        `Hunks applied: ${hunks.length} (atomic — all or nothing)`,
        ...notes,
      ].join('\n'),
    )
  } catch (error) {
    return toolFailure(request.toolId, describeError(error, 'Failed to update the file.'))
  }
}

/**
 * 单个 hunk 的纯函数应用:精确命中 → expectedCount 校验 → 单点容错回退。
 * 与 patchFileAction 的单 hunk 语义保持一致,但不接触磁盘。
 */
function applySingleHunk(
  content: string,
  hunk: { oldText: string; newText: string; replaceAll: boolean; expectedCount?: number },
): { ok: true; content: string; note?: string } | { ok: false; error: string } {
  const matchCount = countOccurrences(content, hunk.oldText)

  if (matchCount === 0) {
    if (hunk.replaceAll) {
      return { ok: false, error: 'No matching content found.' }
    }
    const tolerant = tryTolerantReplacement(content, hunk.oldText, hunk.newText)
    if (!tolerant) {
      return { ok: false, error: 'No matching content found.' }
    }
    if (tolerant.matchCount > 1) {
      return {
        ok: false,
        error: `No exact match found; ${tolerant.matchCount} whitespace-tolerant matches are ambiguous. Add more surrounding context to "oldText" to pin a single location.`,
      }
    }
    return {
      ok: true,
      content: tolerant.content,
      note: `matched via ${tolerant.strategy} tolerance; exact text not found`,
    }
  }

  if (hunk.expectedCount !== undefined && matchCount !== hunk.expectedCount) {
    return { ok: false, error: `Expected ${hunk.expectedCount} match(es), but found ${matchCount}.` }
  }

  return {
    ok: true,
    content: hunk.replaceAll
      ? content.split(hunk.oldText).join(hunk.newText)
      : replaceFirst(content, hunk.oldText, hunk.newText),
    note: hunk.replaceAll ? `replaced ${matchCount} occurrence(s)` : undefined,
  }
}

const MAX_MULTI_PATCH_HUNKS = 20

function resolveExpectedCount(rawValue: unknown, replaceAll: boolean): number | undefined {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return Math.max(1, Math.trunc(rawValue))
  }

  return replaceAll ? undefined : 1
}

/**
 * 精确匹配失败后的容错替换。找到唯一命中才产出新内容;命中多处只回报数量交由调用方
 * 报歧义;无命中返回 null。缩进策略命中时对 newText 重排缩进,避免写回错误缩进。
 */
function tryTolerantReplacement(
  content: string,
  oldText: string,
  newText: string,
): { matchCount: number; strategy: TolerantStrategy; content: string } | null {
  const result = findTolerantMatch(content, oldText)
  if (!result.strategy || result.matches.length === 0) {
    return null
  }

  if (result.matches.length > 1) {
    return { matchCount: result.matches.length, strategy: result.strategy, content: '' }
  }

  const [match] = result.matches
  const matchedText = content.slice(match.start, match.end)
  const replacement =
    result.strategy === 'indentation'
      ? reindentReplacement(newText, oldText, matchedText)
      : newText
  const nextContent = content.slice(0, match.start) + replacement + content.slice(match.end)
  return { matchCount: 1, strategy: result.strategy, content: nextContent }
}

function toRelativePath(request: ToolExecutionRequest, resolvedPath: string): string {
  return relative(request.workspace.rootPath, resolvedPath) || '.'
}
