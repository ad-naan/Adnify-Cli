import type { AdnifyCliRuntime } from '../../application/dto/AdnifyCliRuntime'
import {
  createAppI18n,
  resolveAppLocaleFromEnv,
} from '../../application/i18n/AppI18n'
import type { LoggerPort } from '../../application/ports/LoggerPort'
import { ApplyCliCommandUseCase } from '../../application/use-cases/ApplyCliCommandUseCase'
import { BootstrapCliUseCase } from '../../application/use-cases/BootstrapCliUseCase'
import { CreateSessionUseCase } from '../../application/use-cases/CreateSessionUseCase'
import { ListSessionsUseCase } from '../../application/use-cases/ListSessionsUseCase'
import { ResolveStartupSessionUseCase } from '../../application/use-cases/ResolveStartupSessionUseCase'
import { SubmitPromptUseCase } from '../../application/use-cases/SubmitPromptUseCase'
import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'
import type { ModelConfigStorePort } from '../../application/ports/ModelConfigStorePort'
import type { ToolExecutorPort } from '../../application/ports/ToolExecutorPort'
import { DefaultCliConfigAdapter } from '../config/DefaultCliConfigAdapter'
import { AiSdkGateway } from '../llm/AiSdkGateway'
import { ModelAssistantResponder } from '../llm/ModelAssistantResponder'
import { ModelContextCompactor } from '../llm/ModelContextCompactor'
import { UnconfiguredAssistantResponder } from '../llm/UnconfiguredAssistantResponder'
import { ConsoleLogger } from '../logging/ConsoleLogger'
import { FileSessionRepository } from '../persistence/FileSessionRepository'
import { loadPromptBundle } from '../prompt/loadPromptBundle'
import { FileStorageSettingsAdapter } from '../storage/FileStorageSettingsAdapter'
import { resolveAppStorage } from '../storage/resolveAppStorage'
import { CryptoIdGenerator } from '../system/CryptoIdGenerator'
import { SystemClock } from '../system/SystemClock'
import { LocalToolExecutor } from '../tooling/LocalToolExecutor'
import { PendingToolApprovalAdapter } from '../tooling/PendingToolApprovalAdapter'
import { LocalWorkspaceContextService } from '../workspace/LocalWorkspaceContextService'
import { FsSkillRepository } from '../skills/FsSkillRepository'
import { SkillService } from '../skills/SkillService'
import { McpRegistry } from '../mcp/McpClient'
import { DefaultHookRegistry } from '../hooks/DefaultHookRegistry'
import { resolveUiPreferences } from './resolveUiPreferences'
import { TsLanguageServiceIndexer } from '../indexing/TsLanguageServiceIndexer'
import { GraphRepoMapBuilder } from '../indexing/GraphRepoMapBuilder'

export type { AdnifyCliRuntime }

export async function createRuntime(): Promise<AdnifyCliRuntime> {
  const logger = new ConsoleLogger()
  const i18n = createAppI18n(resolveAppLocaleFromEnv())
  const ui = resolveUiPreferences()
  const config = new DefaultCliConfigAdapter()
  const storage = await resolveAppStorage()
  const storageSettings = new FileStorageSettingsAdapter()
  config.setStorage(storage)
  const sessionRepository = new FileSessionRepository(storage)
  const idGenerator = new CryptoIdGenerator()
  const clock = new SystemClock()
  const workspaceContextService = new LocalWorkspaceContextService()
  const toolApproval = new PendingToolApprovalAdapter()
  const hookRegistry = new DefaultHookRegistry(logger)

  const skillRepository = new FsSkillRepository({
    workspaceRoot: process.cwd(),
    dataRoot: storage.dataRoot,
  })
  const skillService = new SkillService(skillRepository)

  const promptBundle = await loadPromptBundle()
  config.setPromptBundle(promptBundle)

  const { loadModelConfig, loadProviders, loadMcpServers } = await import('../config/loadLocalConfig')
  const { writeModelConfig } = await import('../config/writeLocalConfig')
  const modelConfig = await loadModelConfig()
  const providers = await loadProviders()
  config.setModelConfig(modelConfig)
  config.setProviders(providers)
  const modelConfigStore: ModelConfigStorePort = {
    save: writeModelConfig,
  }

  // Connect MCP servers (if configured) — non-blocking, failures are logged
  const mcpRegistry = new McpRegistry(logger)
  const mcpServers = await loadMcpServers()
  if (mcpServers.length > 0) {
    for (const serverConfig of mcpServers) {
      try {
        await mcpRegistry.addServer(serverConfig)
      } catch (error) {
        logger.warn('Failed to connect MCP server', {
          name: serverConfig.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  // Recreate tool executor with MCP registry support
  const toolExecutor = new LocalToolExecutor(toolApproval, mcpRegistry)

  // Code indexer + repo map builder (shared singletons, reused across model switches)
  const codeIndexer = new TsLanguageServiceIndexer(logger)
  const repoMapBuilder = new GraphRepoMapBuilder(logger)

  const initialStack = createResponderStack(modelConfig, config, toolExecutor, logger, i18n, skillService, repoMapBuilder, codeIndexer, hookRegistry)
  let currentResponder = initialStack.responder
  let currentGateway = initialStack.gateway

  const submitPrompt = new SubmitPromptUseCase(
    sessionRepository,
    workspaceContextService,
    currentResponder,
    config,
    idGenerator,
    clock,
    logger,
    i18n,
  )
  const createSession = new CreateSessionUseCase(
    sessionRepository,
    idGenerator,
    clock,
    logger,
    i18n,
  )
  const resolveStartupSession = new ResolveStartupSessionUseCase(
    sessionRepository,
    createSession,
    logger,
  )

  const activateModelConfig = (newConfig: ModelConfig): ModelConfig => {
    config.setModelConfig(newConfig)

    if (currentGateway && currentResponder instanceof ModelAssistantResponder && newConfig.apiKey) {
      currentGateway.updateConfig(newConfig)
      currentResponder.updateGateway(currentGateway, newConfig)
      logger.info('Model config updated via AI SDK', {
        model: newConfig.model,
        provider: newConfig.provider,
      })
      return newConfig
    }

    const newStack = createResponderStack(newConfig, config, toolExecutor, logger, i18n, skillService, repoMapBuilder, codeIndexer, hookRegistry)
    currentResponder = newStack.responder
    currentGateway = newStack.gateway
    submitPrompt.updateResponder(currentResponder)
    logger.info('Model config updated (new responder)', {
      model: newConfig.model,
      provider: newConfig.provider,
    })
    return newConfig
  }

  const switchModel = (providerName: string, modelName?: string): ModelConfig | null => {
    const newConfig = config.switchModel(providerName, modelName)
    if (!newConfig) {
      return null
    }

    return activateModelConfig(newConfig)
  }

  return {
    i18n,
    ui,
    useCases: {
      bootstrapCli: new BootstrapCliUseCase(workspaceContextService, config, logger, i18n),
      createSession,
      listSessions: new ListSessionsUseCase(sessionRepository),
      resolveStartupSession,
      submitPrompt,
      applyCliCommand: new ApplyCliCommandUseCase(
        sessionRepository,
        storageSettings,
        modelConfigStore,
        idGenerator,
        clock,
        logger,
        i18n,
      ),
    },
    switchModel,
    applyModelConfig: activateModelConfig,
    toolApproval,
    memoryStore: null,
    skillStore: skillService,
    mcpServerList: mcpRegistry.getConnectedServers(),
    hooks: hookRegistry,
  }
}

function createResponderStack(
  modelConfig: ModelConfig,
  config: DefaultCliConfigAdapter,
  toolExecutor: ToolExecutorPort,
  logger: LoggerPort,
  i18n: ReturnType<typeof createAppI18n>,
  skillService?: SkillService,
  repoMapBuilder?: GraphRepoMapBuilder,
  codeIndexer?: TsLanguageServiceIndexer,
  hookRegistry?: DefaultHookRegistry,
) {
  if (!modelConfig.apiKey) {
    logger.info('No API key configured, using unconfigured responder')
    return { responder: new UnconfiguredAssistantResponder(logger, i18n), gateway: null }
  }

  logger.info('Using AI SDK gateway', {
    provider: modelConfig.provider,
    model: modelConfig.model,
    baseUrl: modelConfig.baseUrl,
  })

  const gateway = new AiSdkGateway(modelConfig, logger)
  const compactor = new ModelContextCompactor(gateway, modelConfig.maxTokens, logger, modelConfig.model)
  const responder = new ModelAssistantResponder(
    gateway,
    modelConfig,
    config,
    toolExecutor,
    logger,
    i18n,
    skillService,
    compactor,
    repoMapBuilder,
    codeIndexer,
    hookRegistry,
  )
  return { responder, gateway }
}
