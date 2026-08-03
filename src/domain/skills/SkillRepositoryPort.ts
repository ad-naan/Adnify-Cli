import type { Skill } from './Skill'
import type { AssistantMode } from '../assistant/value-objects/AssistantMode'

/**
 * 技能仓库端口。
 *
 * 负责从文件系统扫描和加载技能。
 * 域层不关心具体存储位置或 IO 细节。
 */
export interface SkillRepositoryPort {
  /**
   * 扫描所有可用技能，返回 L1 列表（name + description）。
   * project skills 覆盖同名的 global skills。
   */
  scan(): Promise<Skill[]>

  /**
   * 获取指定技能的完整内容（L2）。
   * 返回 undefined 表示未找到。
   */
  load(name: string): Promise<Skill | undefined>

  /**
   * 判断指定技能是否存在。
   */
  has(name: string): Promise<boolean>

  /**
   * 返回按当前模式过滤后的技能列表。
   * 如果 skill 没声明 modes，则所有模式可用。
   * 如果声明了 modes，只在匹配的模式下返回。
   */
  scanForMode(mode: AssistantMode): Promise<Skill[]>
}
