import type { UserChoiceQuestion, UserInteractionPort } from '../../../application/ports/UserInteractionPort'
import type { ToolExecutionRequest, ToolExecutionResult } from '../../../application/ports/ToolExecutorPort'
import { parseJsonObject } from '../toolPathGuard'
import { toolFailure, toolSuccess } from './ToolHandler'

export function parseAskUserRequest(
  request: ToolExecutionRequest,
): { ok: true; questions: UserChoiceQuestion[] } | { ok: false; result: ToolExecutionResult } {
  const parsed = parseJsonObject(request.input)
  if (!Array.isArray(parsed.questions) || parsed.questions.length < 1 || parsed.questions.length > 3) {
    return { ok: false, result: toolFailure(request.toolId, 'ask-user requires 1 to 3 questions.') }
  }

  const questions: UserChoiceQuestion[] = []
  for (const [index, raw] of parsed.questions.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, result: toolFailure(request.toolId, `Question ${index + 1} must be an object.`) }
    }
    const question = raw as Record<string, unknown>
    const options = Array.isArray(question.options) ? question.options : []
    if (options.length < 2 || options.length > 3) {
      return { ok: false, result: toolFailure(request.toolId, `Question ${index + 1} requires 2 to 3 options.`) }
    }
    const normalizedOptions = options.map((option) => {
      if (!option || typeof option !== 'object' || Array.isArray(option)) return null
      const item = option as Record<string, unknown>
      return typeof item.label === 'string' && typeof item.description === 'string'
        ? { label: item.label.trim(), description: item.description.trim() }
        : null
    })
    if (normalizedOptions.some((option) => !option?.label)) {
      return { ok: false, result: toolFailure(request.toolId, `Question ${index + 1} has an invalid option.`) }
    }
    if (typeof question.id !== 'string' || typeof question.header !== 'string' || typeof question.question !== 'string') {
      return { ok: false, result: toolFailure(request.toolId, `Question ${index + 1} is missing id, header, or question.`) }
    }
    questions.push({
      id: question.id.trim(),
      header: question.header.trim(),
      question: question.question.trim(),
      options: normalizedOptions as Array<{ label: string; description: string }>,
    })
  }

  return { ok: true, questions }
}

export async function runAskUser(
  request: ToolExecutionRequest,
  interaction: UserInteractionPort,
): Promise<ToolExecutionResult> {
  const parsed = parseAskUserRequest(request)
  if (!parsed.ok) return parsed.result
  const answers = await interaction.requestChoices({ questions: parsed.questions }, request.abortSignal)
  return answers
    ? toolSuccess(request.toolId, JSON.stringify({ answers }))
    : toolFailure(request.toolId, 'User cancelled the interactive questions.')
}
