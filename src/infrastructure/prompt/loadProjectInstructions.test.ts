import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadProjectInstructions } from './loadProjectInstructions'

describe('loadProjectInstructions', () => {
  test('loads native, AGENTS, and ordered rule files while skipping the rules README', async () => {
    const parent = join(process.cwd(), '.tmp')
    await mkdir(parent, { recursive: true })
    const root = await mkdtemp(join(parent, 'project-instructions-'))
    await mkdir(join(root, '.adnify'), { recursive: true })
    await mkdir(join(root, '.rules'), { recursive: true })
    await writeFile(join(root, '.adnify', 'instructions.md'), 'native rule', 'utf8')
    await writeFile(join(root, 'AGENTS.md'), 'agent rule', 'utf8')
    await writeFile(join(root, '.rules', '20-style.md'), 'style rule', 'utf8')
    await writeFile(join(root, '.rules', '10-core.md'), 'core rule', 'utf8')
    await writeFile(join(root, '.rules', 'README.md'), 'ignore me', 'utf8')

    const result = await loadProjectInstructions(root)

    expect(result).toContain('### .adnify/instructions.md\nnative rule')
    expect(result).toContain('### AGENTS.md\nagent rule')
    expect(result.indexOf('core rule')).toBeLessThan(result.indexOf('style rule'))
    expect(result).not.toContain('ignore me')
  })
})
