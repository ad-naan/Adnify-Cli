import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Skill, type SkillSource } from '../../domain/skills/Skill'
import type { SkillRepositoryPort } from '../../domain/skills/SkillRepositoryPort'
import type { AssistantMode } from '../../domain/assistant/value-objects/AssistantMode'

interface FsSkillRepositoryOptions {
  /** 项目根路径：扫描 <workspaceRoot>/.adnify/skills/ */
  workspaceRoot: string
  /** 全局数据目录：扫描 <dataRoot>/skills/ */
  dataRoot: string
}

interface ParsedSkillFile {
  name: string
  description: string
  body: string
  compatibility?: string
  allowedTools?: string[]
  disableModelInvocation?: boolean
  modes?: string[]
}

/**
 * 文件系统技能仓库。
 *
 * 扫描两个层级的技能目录（Adnify 约定）：
 *
 * - Project:  <workspaceRoot>/.adnify/skills/<name>/SKILL.md   (版本控制共享)
 * - Global:   <dataRoot>/skills/<name>/SKILL.md                (个人全局)
 *
 * Project skills 覆盖同名的 global skills。
 *
 * SKILL.md 使用 YAML frontmatter + Markdown body 格式。
 */
export class FsSkillRepository implements SkillRepositoryPort {
  private readonly projectSkillsDir: string
  private readonly globalSkillsDir: string
  private cache: Map<string, Skill> | null = null

  constructor(options: FsSkillRepositoryOptions) {
    this.projectSkillsDir = join(options.workspaceRoot, '.adnify', 'skills')
    this.globalSkillsDir = join(options.dataRoot, 'skills')
  }

  async scan(): Promise<Skill[]> {
    const [projectSkills, globalSkills] = await Promise.all([
      this.scanDir(this.projectSkillsDir, 'project'),
      this.scanDir(this.globalSkillsDir, 'global'),
    ])

    // project 覆盖 global 同名
    const merged = new Map<string, Skill>()
    for (const skill of globalSkills) {
      merged.set(skill.name, skill)
    }
    for (const skill of projectSkills) {
      merged.set(skill.name, skill)
    }

    this.cache = new Map(merged)
    return [...merged.values()]
  }

  async load(name: string): Promise<Skill | undefined> {
    if (!this.cache) {
      await this.scan()
    }
    return this.cache?.get(name)
  }

  async has(name: string): Promise<boolean> {
    if (!this.cache) {
      await this.scan()
    }
    return this.cache?.has(name) ?? false
  }

  async scanForMode(mode: AssistantMode): Promise<Skill[]> {
    const all = await this.scan()
    return all.filter((skill) => {
      if (!skill.modes || skill.modes.length === 0) return true
      return skill.modes.includes(mode)
    })
  }

  private async scanDir(dir: string, source: SkillSource): Promise<Skill[]> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return []
    }

    const skills: Skill[] = []

    for (const entry of entries) {
      const skillDir = join(dir, entry)
      const skillFile = join(skillDir, 'SKILL.md')

      try {
        const fileStat = await stat(skillFile)
        if (!fileStat.isFile()) continue
      } catch {
        continue
      }

      try {
        const raw = await readFile(skillFile, 'utf8')
        const parsed = parseSkillMarkdown(raw)
        if (!parsed) continue

        // name 必须与目录名匹配
        const name = parsed.name || entry
        if (name !== entry) continue

        skills.push(
          new Skill({
            name,
            description: parsed.description,
            body: parsed.body,
            dir: skillDir,
            source,
            compatibility: parsed.compatibility,
            allowedTools: parsed.allowedTools,
            disableModelInvocation: parsed.disableModelInvocation,
            modes: parsed.modes,
          }),
        )
      } catch {
        // 解析失败，跳过此 skill
        continue
      }
    }

    return skills
  }
}

/**
 * 解析 SKILL.md 的 frontmatter + body。
 * 复用 Adnify 现有的 frontmatter 解析风格，不引入外部 YAML 库。
 */
function parseSkillMarkdown(content: string): ParsedSkillFile | null {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return null
  }

  const endIndex = normalized.indexOf('\n---\n', 4)
  if (endIndex === -1) {
    return null
  }

  const frontmatterBlock = normalized.slice(4, endIndex)
  const body = normalized.slice(endIndex + 5).trim()

  if (!body) {
    return null
  }

  const fm = parseFrontmatter(frontmatterBlock)

  const name = (fm['name'] ?? '').trim()
  const description = (fm['description'] ?? '').trim()

  if (!name || !description) {
    return null
  }

  // 验证 name 格式：1-64 字符，小写字母+数字+连字符
  if (!isValidSkillName(name)) {
    return null
  }

  // description 上限 1024
  if (description.length > 1024) {
    return null
  }

  const result: ParsedSkillFile = { name, description, body }

  if (fm['compatibility']) {
    result.compatibility = (fm['compatibility'] ?? '').trim().slice(0, 500)
  }

  if (fm['allowed-tools']) {
    result.allowedTools = (fm['allowed-tools'] as string)
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  if (fm['disable-model-invocation']) {
    result.disableModelInvocation = (fm['disable-model-invocation'] as string).trim() === 'true'
  }

  if (fm['modes']) {
    result.modes = (fm['modes'] as string)
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  return result
}

function parseFrontmatter(block: string): Record<string, string> {
  const result: Record<string, string> = {}

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue

    const key = line.slice(0, colonIndex).trim()
    const value = stripQuotes(line.slice(colonIndex + 1).trim())
    result[key] = value
  }

  return result
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

function isValidSkillName(name: string): boolean {
  // 1-64 chars, lowercase alphanumeric + hyphens, no leading/trailing/consecutive hyphens
  return /^(?=[a-z0-9])(([a-z0-9]|-(?=[a-z0-9])){0,63}[a-z0-9])$/.test(name)
}
