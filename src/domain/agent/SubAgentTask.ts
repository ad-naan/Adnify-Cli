/**
 * 子代理任务实体。
 *
 * 表示从主 Agent 拆分出的一个独立子任务，携带专项指令和上下文。
 * 子代理在自己的消息上下文中运行，结果汇总到主代理。
 */
export interface SubAgentTaskProps {
  id: string
  title: string
  instruction: string
  contextSummary?: string
  priority: SubAgentPriority
  role: SubAgentRole
  status: SubAgentStatus
  result?: string
  error?: string
  createdAt: Date
  completedAt?: Date
}

export type SubAgentPriority = 'low' | 'normal' | 'high'
export type SubAgentRole = 'general' | 'explore' | 'review' | 'test'

export type SubAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export class SubAgentTask {
  private readonly props: SubAgentTaskProps

  constructor(props: SubAgentTaskProps) {
    this.props = { ...props }
  }

  static create(params: {
    id: string
    title: string
    instruction: string
    contextSummary?: string
    priority?: SubAgentPriority
    role?: SubAgentRole
    createdAt?: Date
  }): SubAgentTask {
    return new SubAgentTask({
      id: params.id,
      title: params.title,
      instruction: params.instruction,
      contextSummary: params.contextSummary,
      priority: params.priority ?? 'normal',
      role: params.role ?? 'general',
      status: 'pending',
      createdAt: params.createdAt ?? new Date(),
    })
  }

  get id(): string {
    return this.props.id
  }

  get title(): string {
    return this.props.title
  }

  get instruction(): string {
    return this.props.instruction
  }

  get contextSummary(): string | undefined {
    return this.props.contextSummary
  }

  get priority(): SubAgentPriority {
    return this.props.priority
  }

  get role(): SubAgentRole {
    return this.props.role
  }

  get status(): SubAgentStatus {
    return this.props.status
  }

  get result(): string | undefined {
    return this.props.result
  }

  get error(): string | undefined {
    return this.props.error
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get completedAt(): Date | undefined {
    return this.props.completedAt
  }

  markRunning(): void {
    if (this.props.status !== 'pending') return
    this.props.status = 'running'
  }

  markCompleted(result: string): void {
    this.props.status = 'completed'
    this.props.result = result
    this.props.completedAt = new Date()
  }

  markFailed(error: string): void {
    this.props.status = 'failed'
    this.props.error = error
    this.props.completedAt = new Date()
  }

  markCancelled(): void {
    this.props.status = 'cancelled'
    this.props.completedAt = new Date()
  }

  isTerminal(): boolean {
    return (
      this.props.status === 'completed' ||
      this.props.status === 'failed' ||
      this.props.status === 'cancelled'
    )
  }

  toPromptBlock(): string {
    const lines = [
      `### Sub-Task: ${this.title}`,
      `Instruction: ${this.instruction}`,
      `Role: ${this.role}`,
    ]

    if (this.contextSummary) {
      lines.push(`Context: ${this.contextSummary}`)
    }

    if (this.status === 'completed' && this.result) {
      lines.push(`Result: ${this.result}`)
    } else if (this.status === 'failed' && this.error) {
      lines.push(`Error: ${this.error}`)
    }

    return lines.join('\n')
  }
}
