import type { Skill } from '../../domain/skills/Skill'
import type { SkillRepositoryPort } from '../../domain/skills/SkillRepositoryPort'
import type { AssistantMode } from '../../domain/assistant/value-objects/AssistantMode'

/**
 * 技能列表的字符预算占比（相对于 context window 的 1%）。
 * 实际使用固定上限以避免过度占用。
 */
const SKILL_LISTING_BUDGET = 2000

/**
 * 技能服务。
 *
 * 核心职责：
 * 1. 扫描所有可用技能（L1 metadata）
 * 2. 生成 system prompt 的 skills listing block（带字符预算）
 * 3. 加载指定技能的完整指令（L2）
 * 4. 按当前 agent mode 过滤
 *
 * 渐进式加载：
 *   L1 → 启动时全量加载 name + description，注入 system prompt
 *   L2 → 被激活时加载完整 body，注入对话上下文
 */
export class SkillService {
  private skillsCache: Skill[] | null = null

  constructor(private readonly repository: SkillRepositoryPort) {}

  /**
   * 返回所有可用技能（含 name + description + body）。
   * 第一次访问时触发文件系统扫描，之后走缓存。
   */
  async getAllSkills(): Promise<Skill[]> {
    if (!this.skillsCache) {
      this.skillsCache = await this.repository.scan()
    }
    return this.skillsCache
  }

  /**
   * 返回当前模式下可用的技能。
   */
  async getSkillsForMode(mode: AssistantMode): Promise<Skill[]> {
    if (!this.skillsCache) {
      this.skillsCache = await this.repository.scanForMode(mode)
    }
    // scanForMode 已经按 mode 过滤了，但缓存可能来自 getAllSkills
    return (this.skillsCache ?? []).filter((skill) => {
      if (!skill.modes || skill.modes.length === 0) return true
      return skill.modes.includes(mode)
    })
  }

  /**
   * 生成 L1 listing block 注入 system prompt。
   *
   * 包含所有技能的 name + description，但受字符预算限制。
   * 超预算时，从最后面的技能开始裁剪 description（只保留 name）。
   * disableModelInvocation 的技能只列出名称，不列描述。
   */
  async buildListingBlock(mode: AssistantMode): Promise<string> {
    const skills = await this.getSkillsForMode(mode)
    if (skills.length === 0) {
      return ''
    }

    // 先构建完整 listing
    const lines: string[] = skills.map((skill) => {
      if (skill.disableModelInvocation) {
        return `- ${skill.name} (manual only)`
      }
      return skill.toListingLine()
    })

    // 检查字符预算
    let total = lines.join('\n').length
    if (total <= SKILL_LISTING_BUDGET) {
      return ['## Available Skills', ...lines].join('\n')
    }

    // 超预算：从末尾开始降级为 name-only
    const downgraded = [...lines]
    for (let i = downgraded.length - 1; i >= 0; i--) {
      if (total <= SKILL_LISTING_BUDGET) break
      const skill = skills[i]!
      const fullLine = downgraded[i]!
      const nameOnly = `- ${skill.name}`
      total -= fullLine.length - nameOnly.length
      downgraded[i] = nameOnly
    }

    return ['## Available Skills', ...downgraded].join('\n')
  }

  /**
   * 加载指定技能的完整指令（L2），用于注入对话上下文。
   * 返回 undefined 表示技能不存在。
   */
  async loadSkillBody(name: string): Promise<string | undefined> {
    const skill = await this.repository.load(name)
    return skill?.toPromptBlock()
  }

  /**
   * 获取技能详情（含元数据）。
   */
  async getSkill(name: string): Promise<Skill | undefined> {
    return this.repository.load(name)
  }

  /**
   * 判断技能是否存在。
   */
  async hasSkill(name: string): Promise<boolean> {
    return this.repository.has(name)
  }

  /**
   * 强制刷新缓存（文件变更后调用）。
   */
  invalidateCache(): void {
    this.skillsCache = null
  }
}
