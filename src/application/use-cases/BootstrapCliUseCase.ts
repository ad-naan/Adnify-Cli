import { ASSISTANT_MODES } from '../../domain/assistant/value-objects/AssistantMode'
import type { BootstrapSnapshot } from '../dto/BootstrapSnapshot'
import type { AppI18n } from '../i18n/AppI18n'
import type { CliConfigPort } from '../ports/CliConfigPort'
import type { LoggerPort } from '../ports/LoggerPort'
import type { WorkspaceContextPort } from '../ports/WorkspaceContextPort'

export interface BootstrapCliCommand {
  cwd: string
}

/**
 * 负责生成 CLI 启动时需要的一次性快照。
 */
export class BootstrapCliUseCase {
  constructor(
    private readonly workspaceContextPort: WorkspaceContextPort,
    private readonly config: CliConfigPort,
    private readonly logger: LoggerPort,
    private readonly i18n: AppI18n,
  ) {}

  async execute(command: BootstrapCliCommand): Promise<BootstrapSnapshot> {
    this.logger.info(
      this.i18n.t('app.boot.runtimeStarting'),
      { cwd: command.cwd },
    )

    return {
      profile: this.config.getAssistantProfile(),
      workspace: await this.workspaceContextPort.inspect(command.cwd),
      modelConfig: this.config.getModelConfig(),
      providers: this.config.getProviders(),
      toolCatalog: this.config.getToolCatalog(),
      localCommands: this.config.getLocalCommands(),
      storage: this.config.getStorage(),
      supportedModes: [...ASSISTANT_MODES],
    }
  }
}
