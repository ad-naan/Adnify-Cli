import { describe, expect, test } from 'bun:test'
import { WorkspaceContext } from '../../../domain/workspace/entities/WorkspaceContext'
import type { ToolExecutionRequest, ToolProgressEvent } from '../../../application/ports/ToolExecutorPort'
import { handleTodoWrite } from './todoWriteHandler'

function makeRequest(
  payload: unknown,
  onProgress?: (event: ToolProgressEvent) => void,
): ToolExecutionRequest {
  return {
    toolId: 'todo-write',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    workspace: new WorkspaceContext({
      rootPath: '/tmp',
      isGitRepository: false,
      packageManager: 'bun',
      topLevelEntries: [],
    }),
    onProgress,
  }
}

describe('handleTodoWrite', () => {
  test('accepts a valid list and emits the full snapshot to onProgress', async () => {
    const events: ToolProgressEvent[] = []
    const result = await handleTodoWrite(
      makeRequest(
        {
          todos: [
            { content: 'Read the code', status: 'completed' },
            { content: 'Make the change', status: 'in_progress' },
            { content: 'Run tests', status: 'pending' },
          ],
        },
        (event) => events.push(event),
      ),
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('1/3 done')
    expect(events).toHaveLength(1)
    expect(events[0].todos).toHaveLength(3)
    expect(events[0].todos?.[1]).toEqual({ content: 'Make the change', status: 'in_progress' })
  })

  test('rejects more than one in_progress item', async () => {
    const result = await handleTodoWrite(
      makeRequest({
        todos: [
          { content: 'A', status: 'in_progress' },
          { content: 'B', status: 'in_progress' },
        ],
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('one todo may be in_progress')
  })

  test('rejects an invalid status', async () => {
    const result = await handleTodoWrite(
      makeRequest({ todos: [{ content: 'A', status: 'doing' }] }),
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('invalid "status"')
  })

  test('rejects empty content', async () => {
    const result = await handleTodoWrite(
      makeRequest({ todos: [{ content: '   ', status: 'pending' }] }),
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('non-empty "content"')
  })

  test('rejects a non-array todos field', async () => {
    const result = await handleTodoWrite(makeRequest({ todos: 'nope' }))
    expect(result.ok).toBe(false)
    expect(result.content).toContain('must be an array')
  })

  test('an empty list is valid and reports it cleared', async () => {
    const events: ToolProgressEvent[] = []
    const result = await handleTodoWrite(makeRequest({ todos: [] }, (event) => events.push(event)))

    expect(result.ok).toBe(true)
    expect(result.content).toContain('cleared')
    expect(events[0].todos).toEqual([])
  })
})
