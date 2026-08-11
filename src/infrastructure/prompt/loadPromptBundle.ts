import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AssistantProfile } from '../../domain/assistant/entities/AssistantProfile'
import { ToolDescriptor } from '../../domain/tooling/entities/ToolDescriptor'
import type { AssistantMode } from '../../domain/assistant/value-objects/AssistantMode'
import type { PromptBundle } from './PromptBundle'

type Frontmatter = Record<string, string>

const moduleDirectory = fileURLToPath(new URL('.', import.meta.url))
const PROMPT_ROOT = basename(moduleDirectory) === 'dist'
  ? join(moduleDirectory, '../prompts')
  : join(moduleDirectory, '../../../prompts')

export async function loadPromptBundle(): Promise<PromptBundle> {
  const profileDocument = await readMarkdownDocument(join(PROMPT_ROOT, 'assistant/profile.md'))
  const coreDocument = await readMarkdownDocument(join(PROMPT_ROOT, 'system/core.md'))
  const chatModeDocument = await readMarkdownDocument(join(PROMPT_ROOT, 'system/modes/chat.md'))
  const agentModeDocument = await readMarkdownDocument(join(PROMPT_ROOT, 'system/modes/agent.md'))
  const planModeDocument = await readMarkdownDocument(join(PROMPT_ROOT, 'system/modes/plan.md'))
  const localCommandsDocument = await readMarkdownDocument(join(PROMPT_ROOT, 'commands/local-commands.md'))

  const toolFiles = [
    'tools/workspace-read.md',
    'tools/file-ops.md',
    'tools/shell-runner.md',
    'tools/search-index.md',
    'tools/glob-search.md',
    'tools/web-fetch.md',
    'tools/web-search.md',
    'tools/task.md',
    'tools/ask-user.md',
    'tools/workflow-phase.md',
    'tools/runtime-control.md',
  ]

  const tools = await Promise.all(
    toolFiles.map(async (relativePath) => {
      const document = await readMarkdownDocument(join(PROMPT_ROOT, relativePath))

      return new ToolDescriptor({
        id: getRequired(document.frontmatter, 'id', relativePath),
        name: getRequired(document.frontmatter, 'name', relativePath),
        description: collapseMarkdown(document.body),
        category: getRequired(document.frontmatter, 'category', relativePath),
        riskLevel: parseRiskLevel(getRequired(document.frontmatter, 'riskLevel', relativePath)),
      })
    }),
  )

  return {
    profile: new AssistantProfile({
      id: getRequired(profileDocument.frontmatter, 'id', 'assistant/profile.md'),
      name: getRequired(profileDocument.frontmatter, 'name', 'assistant/profile.md'),
      author: getRequired(profileDocument.frontmatter, 'author', 'assistant/profile.md'),
      tagline: getRequired(profileDocument.frontmatter, 'tagline', 'assistant/profile.md'),
      description: collapseMarkdown(profileDocument.body),
      defaultMode: parseMode(
        getRequired(profileDocument.frontmatter, 'defaultMode', 'assistant/profile.md'),
      ),
    }),
    promptSet: {
      core: coreDocument.body.trim(),
      modes: {
        chat: chatModeDocument.body.trim(),
        agent: agentModeDocument.body.trim(),
        plan: planModeDocument.body.trim(),
      },
    },
    toolCatalog: tools,
    localCommands: extractCommands(localCommandsDocument.body),
  }
}

async function readMarkdownDocument(path: string): Promise<{ frontmatter: Frontmatter; body: string }> {
  const content = await readFile(path, 'utf8')
  return parseFrontmatter(content)
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: {}, body: normalized.trim() }
  }

  const endIndex = normalized.indexOf('\n---\n', 4)
  if (endIndex === -1) {
    throw new Error('Invalid markdown frontmatter: missing closing delimiter')
  }

  const frontmatterBlock = normalized.slice(4, endIndex)
  const body = normalized.slice(endIndex + 5).trim()
  const frontmatter: Frontmatter = {}

  for (const rawLine of frontmatterBlock.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      throw new Error(`Invalid frontmatter line: ${line}`)
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    frontmatter[key] = stripQuotes(value)
  }

  return { frontmatter, body }
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function collapseMarkdown(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(/^[-#*\s]+/, '').trim())
    .filter(Boolean)
    .join(' ')
}

function extractCommands(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
}

function getRequired(frontmatter: Frontmatter, key: string, source: string): string {
  const value = frontmatter[key]
  if (!value) {
    throw new Error(`Missing required frontmatter "${key}" in ${source}`)
  }

  return value
}

function parseMode(value: string): AssistantMode {
  switch (value) {
    case 'chat':
    case 'agent':
    case 'plan':
      return value
    default:
      throw new Error(`Unsupported assistant mode: ${value}`)
  }
}

function parseRiskLevel(value: string): 'safe' | 'careful' | 'dangerous' {
  switch (value) {
    case 'safe':
    case 'careful':
    case 'dangerous':
      return value
    default:
      throw new Error(`Unsupported tool risk level: ${value}`)
  }
}
