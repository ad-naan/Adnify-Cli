/**
 * 技能实体。
 *
 * 表示一个可按需加载的指令包。
 * Skills 的本质是 prompt 注入：启动时只加载 name + description（L1），
 * 被激活时才加载完整指令正文（L2），需要时再读取 scripts/references（L3）。
 *
 * 遵循 agentskills.io 开放标准（渐进式加载），但使用 Adnify 自己的目录约定。
 */
export interface SkillProps {
  /** 唯一标识，来自目录名 */
  name: string
  /** 1-1024 字符，描述何时触发 */
  description: string
  /** 完整指令正文（L2），被激活时才加载 */
  body: string
  /** skill 所在目录的绝对路径，用于引用 scripts/references */
  dir: string
  /** 来源层级 */
  source: SkillSource
  /** 可选：兼容性描述 */
  compatibility?: string
  /** 可选：预批准工具列表 */
  allowedTools?: string[]
  /** 可选：是否禁止模型自动激活（仅手动调用） */
  disableModelInvocation?: boolean
  /** 可选：模式命中（仅特定 mode 下可用） */
  modes?: string[]
}

export type SkillSource = 'project' | 'global'

export class Skill {
  private readonly props: SkillProps

  constructor(props: SkillProps) {
    this.props = { ...props }
  }

  get name(): string {
    return this.props.name
  }

  get description(): string {
    return this.props.description
  }

  get body(): string {
    return this.props.body
  }

  get dir(): string {
    return this.props.dir
  }

  get source(): SkillSource {
    return this.props.source
  }

  get compatibility(): string | undefined {
    return this.props.compatibility
  }

  get allowedTools(): string[] | undefined {
    return this.props.allowedTools ? [...this.props.allowedTools] : undefined
  }

  get disableModelInvocation(): boolean {
    return this.props.disableModelInvocation ?? false
  }

  get modes(): string[] | undefined {
    return this.props.modes ? [...this.props.modes] : undefined
  }

  /**
   * 生成 L1 listing 行（name + description），注入 system prompt。
   */
  toListingLine(): string {
    return `- ${this.name}: ${this.description}`
  }

  /**
   * 生成完整指令块（L2），被激活时注入。
   */
  toPromptBlock(): string {
    return [
      `## Skill: ${this.name}`,
      this.body,
    ].join('\n')
  }
}
