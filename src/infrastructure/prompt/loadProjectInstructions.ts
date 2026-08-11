import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_INSTRUCTION_CHARS = 16_000

/**
 * Loads repository-owned coding instructions without making them part of the bundled prompt.
 * Product-native instructions and the common AGENTS.md convention take precedence, followed by
 * the repository's ordered .rules Markdown files.
 */
export async function loadProjectInstructions(workspaceRoot: string): Promise<string> {
  const sources: Array<{ label: string; path: string }> = [
    { label: '.adnify/instructions.md', path: join(workspaceRoot, '.adnify', 'instructions.md') },
    { label: 'AGENTS.md', path: join(workspaceRoot, 'AGENTS.md') },
  ]

  try {
    const ruleNames = (await readdir(join(workspaceRoot, '.rules')))
      .filter((name) => name.toLowerCase().endsWith('.md') && name.toLowerCase() !== 'readme.md')
      .sort((left, right) => left.localeCompare(right))
    sources.push(...ruleNames.map((name) => ({ label: `.rules/${name}`, path: join(workspaceRoot, '.rules', name) })))
  } catch {
    // A rules directory is optional.
  }

  const sections: string[] = []
  let remaining = MAX_INSTRUCTION_CHARS

  for (const source of sources) {
    if (remaining <= 0) break
    try {
      const content = (await readFile(source.path, 'utf8')).trim()
      if (!content) continue
      const selected = content.slice(0, remaining)
      sections.push(`### ${source.label}\n${selected}`)
      remaining -= selected.length
    } catch {
      // Individual instruction files are optional and should not block startup.
    }
  }

  return sections.join('\n\n')
}
