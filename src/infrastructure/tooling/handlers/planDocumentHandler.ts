import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolExecutionRequest, ToolExecutionResult } from '../../../application/ports/ToolExecutorPort'
import { parseJsonObject } from '../toolPathGuard'
import { describeError, toolFailure, toolSuccess } from './ToolHandler'

const MAX_PLAN_CHARS = 200_000

export async function handlePlanDocument(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
  const input = parseJsonObject(request.input)
  const action = typeof input.action === 'string' ? input.action : ''
  const plansDirectory = join(request.workspace.rootPath, '.adnify', 'plans')

  try {
    if (action === 'list') {
      await mkdir(plansDirectory, { recursive: true })
      const files = (await readdir(plansDirectory)).filter((name) => name.endsWith('.md')).sort()
      return toolSuccess(request.toolId, files.length ? files.join('\n') : 'No saved plan documents.')
    }

    const name = sanitizePlanName(
      typeof input.name === 'string' && input.name.trim()
        ? input.name
        : request.sessionId ?? 'current-plan',
    )
    const path = join(plansDirectory, `${name}.md`)

    if (action === 'read') {
      return toolSuccess(request.toolId, await readFile(path, 'utf8'))
    }

    if (action === 'write') {
      if (typeof input.content !== 'string' || !input.content.trim()) {
        return toolFailure(request.toolId, 'plan-document write requires non-empty content.')
      }
      if (input.content.length > MAX_PLAN_CHARS) {
        return toolFailure(request.toolId, `Plan document exceeds ${MAX_PLAN_CHARS} characters.`)
      }
      await mkdir(plansDirectory, { recursive: true })
      await writeFile(path, input.content, 'utf8')
      return toolSuccess(request.toolId, `Plan saved: .adnify/plans/${name}.md`)
    }

    return toolFailure(request.toolId, 'plan-document action must be write, read, or list.')
  } catch (error) {
    return toolFailure(request.toolId, describeError(error, 'Plan document operation failed.'))
  }
}

function sanitizePlanName(value: string): string {
  const normalized = value
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (normalized || 'current-plan').slice(0, 80)
}
