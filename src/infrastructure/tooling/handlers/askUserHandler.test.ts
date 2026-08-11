import { describe, expect, test } from 'bun:test'
import { WorkspaceContext } from '../../../domain/workspace/entities/WorkspaceContext'
import { parseAskUserRequest, runAskUser } from './askUserHandler'

function request(input: string) {
  return {
    toolId: 'ask-user',
    input,
    workspace: new WorkspaceContext({
      rootPath: process.cwd(),
      isGitRepository: true,
      packageManager: 'bun',
      topLevelEntries: [],
    }),
  }
}

describe('askUserHandler', () => {
  test('validates the question and option limits', () => {
    expect(parseAskUserRequest(request('{"questions":[]}')).ok).toBe(false)
    expect(parseAskUserRequest(request(JSON.stringify({
      questions: [{ id: 'x', header: 'X', question: 'Choose', options: [{ label: 'one', description: 'only' }] }],
    }))).ok).toBe(false)
  })

  test('returns selected answers as a standard tool result', async () => {
    const result = await runAskUser(request(JSON.stringify({
      questions: [{
        id: 'scope',
        header: 'Scope',
        question: 'Choose scope',
        options: [
          { label: 'Small', description: 'Minimal' },
          { label: 'Full', description: 'Complete' },
        ],
      }],
    })), {
      requestChoices: async () => [{ questionId: 'scope', selectedIndex: 1, label: 'Full' }],
    })

    expect(result.ok).toBe(true)
    expect(result.content).toContain('"label":"Full"')
  })
})
