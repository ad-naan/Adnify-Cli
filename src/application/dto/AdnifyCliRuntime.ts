import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'
import type { AppI18n } from '../i18n/AppI18n'
import type { ToolApprovalController } from '../ports/ToolApprovalPort'
import type {
  ApplyCliCommandUseCase,
  MemoryStoreLike,
  SkillStoreLike,
} from '../use-cases/ApplyCliCommandUseCase'
import type { UiPreferences } from './UiPreferences'
import type { BootstrapCliUseCase } from '../use-cases/BootstrapCliUseCase'
import type { CreateSessionUseCase } from '../use-cases/CreateSessionUseCase'
import type { ListSessionsUseCase } from '../use-cases/ListSessionsUseCase'
import type { ResolveStartupSessionUseCase } from '../use-cases/ResolveStartupSessionUseCase'
import type { SubmitPromptUseCase } from '../use-cases/SubmitPromptUseCase'

export interface AdnifyCliRuntime {
  i18n: AppI18n
  ui: UiPreferences
  useCases: {
    bootstrapCli: BootstrapCliUseCase
    createSession: CreateSessionUseCase
    listSessions: ListSessionsUseCase
    resolveStartupSession: ResolveStartupSessionUseCase
    submitPrompt: SubmitPromptUseCase
    applyCliCommand: ApplyCliCommandUseCase
  }
  switchModel: (providerName: string, modelName?: string) => ModelConfig | null
  applyModelConfig: (config: ModelConfig) => ModelConfig
  /** 高风险工具的待决审批队列，由终端层驱动。 */
  toolApproval: ToolApprovalController
  /** 跨会话项目记忆存储 */
  memoryStore?: MemoryStoreLike | null
  /** Skill 存储 — 用于 :skill 命令 */
  skillStore?: SkillStoreLike
  /** 已连接的 MCP 服务器名称列表 — 用于 :mcp 命令 */
  mcpServerList?: string[]
}
