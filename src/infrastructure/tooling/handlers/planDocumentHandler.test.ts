import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceContext } from '../../../domain/workspace/entities/WorkspaceContext'
import { handlePlanDocument } from './planDocumentHandler'

describe('planDocumentHandler', () => {
  test('writes plans only under the app-owned planning directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'adnify-plan-'))
    const workspace = new WorkspaceContext({ rootPath: root, isGitRepository: true, packageManager: 'bun', topLevelEntries: [] })
    try {
      const result = await handlePlanDocument({
        toolId: 'plan-document',
        input: JSON.stringify({ action: 'write', name: '../Release Plan.md', content: '# Release\n\n- verify' }),
        workspace,
        sessionId: 'session-1',
      })

      expect(result.ok).toBe(true)
      expect(result.content).toContain('.adnify/plans/release-plan.md')
      expect(await readFile(join(root, '.adnify', 'plans', 'release-plan.md'), 'utf8')).toContain('# Release')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
