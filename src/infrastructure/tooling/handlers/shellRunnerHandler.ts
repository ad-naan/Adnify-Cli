import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  ToolExecutionRequest,
  ToolExecutionResult,
} from '../../../application/ports/ToolExecutorPort'
import type { ShellCommandClassification } from '../classifyShellCommand'
import { classifyShellCommand } from '../classifyShellCommand'
import { parseJsonObject } from '../toolPathGuard'
import { describeError, toolFailure } from './ToolHandler'

const execFileAsync = promisify(execFile)

/** 解析后的 shell-runner 请求，分类结果供 executor 判断是否需要审批。 */
export interface ShellRunnerRequest {
  argv: string[]
  classification: Extract<ShellCommandClassification, { ok: true }>
  request: ToolExecutionRequest
}

export function parseShellRunnerRequest(
  request: ToolExecutionRequest,
): { ok: true; value: ShellRunnerRequest } | { ok: false; result: ToolExecutionResult } {
  const prompt = parseJsonObject(request.input)
  const argv = Array.isArray(prompt.argv)
    ? prompt.argv.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []

  if (argv.length === 0) {
    return {
      ok: false,
      result: toolFailure(
        request.toolId,
        'Missing required field "argv". Example: {"argv":["rg","useCliController","src"]}',
      ),
    }
  }

  const classification = classifyShellCommand(argv)
  if (!classification.ok) {
    return { ok: false, result: toolFailure(request.toolId, classification.reason) }
  }

  return { ok: true, value: { argv, classification, request } }
}

export async function runShellCommand(input: ShellRunnerRequest): Promise<ToolExecutionResult> {
  const { argv, request } = input

  try {
    const { stdout, stderr } = await execFileAsync(argv[0]!, argv.slice(1), {
      cwd: request.workspace.rootPath,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })

    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
    return { toolId: request.toolId, ok: true, content: output || 'Command completed with no output.' }
  } catch (error) {
    return toolFailure(request.toolId, describeError(error, 'Shell command execution failed.'))
  }
}
