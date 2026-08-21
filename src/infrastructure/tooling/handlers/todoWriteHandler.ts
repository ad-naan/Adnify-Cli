import type {
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolTodoItem,
} from '../../../application/ports/ToolExecutorPort'
import { parseJsonObject } from '../toolPathGuard'
import { toolFailure, toolSuccess } from './ToolHandler'

const VALID_STATUSES = new Set<ToolTodoItem['status']>(['pending', 'in_progress', 'completed'])
const MAX_TODOS = 40

const STATUS_GLYPH: Record<ToolTodoItem['status'], string> = {
  pending: '○',
  in_progress: '◉',
  completed: '✓',
}

/**
 * 待办清单工具。声明式覆盖:模型每次带全量列表,handler 校验后既把成品清单作为
 * 结果内容回给模型(重新锚定它的计划),又通过 onProgress 把结构化快照推给常驻 dock。
 *
 * 只更新清单,不执行任何步骤。约束「至多一个 in_progress」是刻意的:强制模型串行推进,
 * 避免它一次声明一堆并行进行中却其实没做。
 */
export async function handleTodoWrite(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
  const prompt = parseJsonObject(request.input)
  const rawTodos = prompt.todos

  if (!Array.isArray(rawTodos)) {
    return toolFailure(
      request.toolId,
      'Field "todos" must be an array. Send the complete checklist every call.',
    )
  }

  if (rawTodos.length > MAX_TODOS) {
    return toolFailure(
      request.toolId,
      `Too many todos (${rawTodos.length}). Keep the list under ${MAX_TODOS} focused items.`,
    )
  }

  const todos: ToolTodoItem[] = []
  for (const [index, entry] of rawTodos.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return toolFailure(request.toolId, `Todo #${index + 1} must be an object with content and status.`)
    }

    const record = entry as Record<string, unknown>
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    const status = record.status

    if (!content) {
      return toolFailure(request.toolId, `Todo #${index + 1} is missing non-empty "content".`)
    }

    if (typeof status !== 'string' || !VALID_STATUSES.has(status as ToolTodoItem['status'])) {
      return toolFailure(
        request.toolId,
        `Todo #${index + 1} has invalid "status". Use pending, in_progress, or completed.`,
      )
    }

    todos.push({ content, status: status as ToolTodoItem['status'] })
  }

  const inProgress = todos.filter((todo) => todo.status === 'in_progress').length
  if (inProgress > 1) {
    return toolFailure(
      request.toolId,
      `Only one todo may be in_progress at a time (found ${inProgress}). Finish or reset the others.`,
    )
  }

  // 推给常驻 dock —— 全量快照,UI 直接替换整张列表。
  request.onProgress?.({ toolId: request.toolId, message: 'Updated todo list.', todos })

  return toolSuccess(request.toolId, renderTodoList(todos))
}

function renderTodoList(todos: ToolTodoItem[]): string {
  if (todos.length === 0) {
    return 'Todo list cleared.'
  }

  const completed = todos.filter((todo) => todo.status === 'completed').length
  const lines = todos.map((todo) => {
    const label = todo.status === 'in_progress' ? `${todo.content} (in progress)` : todo.content
    return `  ${STATUS_GLYPH[todo.status]} ${label}`
  })

  return [`Todo list (${completed}/${todos.length} done):`, ...lines].join('\n')
}
