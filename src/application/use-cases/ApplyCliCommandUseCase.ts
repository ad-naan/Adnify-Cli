import type {
  StorageSettingsSnapshot,
  StorageSettingsUpdateResult,
} from '../dto/StorageSettingsSnapshot'
import { ASSISTANT_MODES, isAssistantMode } from '../../domain/assistant/value-objects/AssistantMode'
import type { ConversationSession } from '../../domain/session/aggregates/ConversationSession'
import type { ToolDescriptor } from '../../domain/tooling/entities/ToolDescriptor'
import type { BootstrapSnapshot } from '../dto/BootstrapSnapshot'
import type { AppI18n } from '../i18n/AppI18n'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { LoggerPort } from '../ports/LoggerPort'
import type { ModelConfigStorePort } from '../ports/ModelConfigStorePort'
import type { SessionRepositoryPort } from '../ports/SessionRepositoryPort'
import type { StorageSettingsPort } from '../ports/StorageSettingsPort'
import type { ToolApprovalController } from '../ports/ToolApprovalPort'
import type { PermissionMode } from '../dto/UiPreferences'
import type { ModelConfig, ModelProvider } from '../../domain/assistant/value-objects/ModelConfig'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  createCliCommandInputContent,
  createCliCommandOutputContent,
} from '../support/CliTranscriptMarkup'
import { formatWorkspaceSummary } from '../support/formatWorkspaceSummary'
import { PROVIDER_PRESETS } from '../../infrastructure/config/providerPresets'

const execFileAsync = promisify(execFile)

export interface ModelSwitcher {
  switchModel: (providerName: string, modelName?: string) => { model: string; baseUrl: string } | null
}

export interface ConfigUpdater {
  applyModelConfig: (config: ModelConfig) => ModelConfig
}

export interface ApplyCliCommandCommand {
  sessionId: string
  commandLine: string
  bootstrap: BootstrapSnapshot
  configUpdater?: ConfigUpdater
  modelSwitcher?: ModelSwitcher
  gitRunner?: GitRunner
  memoryStore?: MemoryStoreLike
  skillStore?: SkillStoreLike
  mcpServerList?: string[]
  checkpointStore?: CheckpointStoreLike
  permissionController?: ToolApprovalController
}

export interface MemoryStoreLike {
  list(): Promise<Array<{ id: string; content: string; createdAt: string }>>
  add(content: string): Promise<{ id: string; content: string; createdAt: string }>
  remove(id: string): Promise<boolean>
  clear(): Promise<void>
  toPromptBlock(): Promise<string>
}

export interface SkillStoreLike {
  listSkills(): Promise<Array<{ name: string; description: string }>>
  getSkillBody(name: string): Promise<string | undefined>
}

/**
 * 文件级检查点存储。
 * 与 git 检查点（:checkpoint/:undo）互补 —— 这里回滚的是单次工具写入，不依赖 git。
 */
export interface CheckpointStoreLike {
  listSnapshots(): Array<{
    id: string
    description: string
    createdAt: number
    entries: Array<{ relativePath: string }>
  }>
  restore(snapshotId: string): Array<{ relativePath: string }> | null
}

export interface ApplyCliCommandResult {
  session: ConversationSession
  statusLine: string
  shouldExit?: boolean
}

export interface GitRunner {
  currentBranch: (workspacePath: string) => Promise<string>
  branchTrackingSummary: (workspacePath: string) => Promise<string>
  statusShort: (workspacePath: string) => Promise<string>
  lastCommitSummary: (workspacePath: string) => Promise<string>
  diffCheck: (workspacePath: string) => Promise<string>
  diffStat: (workspacePath: string) => Promise<string>
  diffPatch: (workspacePath: string) => Promise<string>
}

export class ApplyCliCommandUseCase {
  constructor(
    private readonly sessionRepository: SessionRepositoryPort,
    private readonly storageSettings: StorageSettingsPort,
    private readonly modelConfigStore: ModelConfigStorePort,
    private readonly idGenerator: IdGeneratorPort,
    private readonly clock: ClockPort,
    private readonly logger: LoggerPort,
    private readonly i18n: AppI18n,
  ) {}

  async execute(command: ApplyCliCommandCommand): Promise<ApplyCliCommandResult> {
    const session = await this.sessionRepository.findById(command.sessionId)
    if (!session) {
      throw new Error(`Session not found: ${command.sessionId}`)
    }

    const now = this.clock.now()
    const normalizedCommand = normalizeCommandLine(command.commandLine)
    const [verb = '', ...args] = normalizedCommand.split(/\s+/).filter(Boolean)
    const rawArgs = normalizedCommand.slice(verb.length).trim()

    const addCommandInput = (): void => {
      session.addUserMessage(
        this.idGenerator.next(),
        now,
        createCliCommandInputContent(toDisplayCommand(normalizedCommand)),
      )
    }

    const addCommandOutput = (
      content: string,
      options: { title?: string; tone?: 'default' | 'info' | 'success' | 'warning' | 'danger' } = {},
    ): void => {
      session.addSystemMessage(
        this.idGenerator.next(),
        now,
        createCliCommandOutputContent(content, options),
      )
    }

    const persist = async (
      statusLine: string,
      options: { shouldExit?: boolean } = {},
    ): Promise<ApplyCliCommandResult> => {
      await this.sessionRepository.save(session)
      return {
        session,
        statusLine,
        shouldExit: options.shouldExit,
      }
    }

    switch (verb) {
      case 'help': {
        addCommandInput()
        addCommandOutput(
          [
            this.i18n.t('cli.help.title'),
            ...command.bootstrap.localCommands.map((item) => `- ${item}`),
          ].join('\n'),
          { title: this.i18n.t('transcript.commands'), tone: 'info' },
        )
        return persist(this.i18n.t('cli.help.status'))
      }

      case 'mode': {
        addCommandInput()
        const nextMode = args[0]

        if (!nextMode || !isAssistantMode(nextMode)) {
          addCommandOutput(
            this.i18n.t('cli.mode.invalidOutput', {
              modes: ASSISTANT_MODES.join(', '),
            }),
            {
              title: this.i18n.t('transcript.mode'),
              tone: 'warning',
            },
          )
          return persist(this.i18n.t('cli.mode.invalidStatus'))
        }

        session.switchMode(nextMode, now)
        addCommandOutput(this.i18n.t('cli.mode.changedOutput', { mode: nextMode }), {
          title: this.i18n.t('transcript.mode'),
          tone: 'success',
        })
        return persist(this.i18n.t('cli.mode.changedStatus', { mode: nextMode }))
      }

      case 'workspace': {
        addCommandInput()
        addCommandOutput(formatWorkspaceSummary(command.bootstrap.workspace, this.i18n), {
          title: this.i18n.t('transcript.workspace'),
          tone: 'info',
        })
        return persist(this.i18n.t('cli.workspace.status'))
      }

      case 'status': {
        addCommandInput()
        const storage = (await this.storageSettings.inspect()).effectiveStorage
        const modelConfig = command.bootstrap.modelConfig
        const lines = [
          this.i18n.t('cli.status.title'),
          formatKeyValueLine('workspace', command.bootstrap.workspace.rootPath),
          formatKeyValueLine('mode', session.mode),
          formatKeyValueLine('model', modelConfig.model),
          formatKeyValueLine('provider', modelConfig.provider),
          formatKeyValueLine(
            'configured',
            this.i18n.t(modelConfig.apiKey ? 'common.yes' : 'common.no'),
          ),
          formatKeyValueLine('session', formatShortSessionId(session.id)),
          formatKeyValueLine('storage', storage.dataRoot),
          formatKeyValueLine(
            'git',
            this.i18n.t(command.bootstrap.workspace.isGitRepository ? 'common.yes' : 'common.no'),
          ),
        ]

        if (!command.bootstrap.workspace.isGitRepository) {
          lines.push('', this.i18n.t('cli.status.notGit'))
          addCommandOutput(lines.join('\n'), {
            title: this.i18n.t('transcript.command'),
            tone: 'info',
          })
          return persist(this.i18n.t('cli.status.status'))
        }

        try {
          const gitRunner = command.gitRunner ?? defaultGitRunner
          const [branch, trackingSummary, statusShort, lastCommitSummary] = await Promise.all([
            gitRunner.currentBranch(command.bootstrap.workspace.rootPath),
            gitRunner.branchTrackingSummary(command.bootstrap.workspace.rootPath),
            gitRunner.statusShort(command.bootstrap.workspace.rootPath),
            gitRunner.lastCommitSummary(command.bootstrap.workspace.rootPath),
          ])
          const trimmedStatus = statusShort.trim()
          const parsedStatus = parseGitStatusShort(trimmedStatus)
          const tracking = parseBranchTrackingSummary(trackingSummary)

          lines.push(formatKeyValueLine('branch', branch.trim() || this.i18n.t('workspace.none')))
          if (tracking) {
            lines.push(formatKeyValueLine('remote', formatBranchTrackingSummary(tracking, this.i18n)))
          }
          lines.push(
            formatKeyValueLine(
              'commit',
              lastCommitSummary.trim() || this.i18n.t('cli.status.noCommits'),
            ),
          )
          lines.push('')
          lines.push(this.i18n.t('cli.status.gitChanges'))
          lines.push(
            trimmedStatus
              ? formatGitStatusSummary(parsedStatus, this.i18n)
              : this.i18n.t('cli.status.clean'),
          )

          addCommandOutput(lines.join('\n'), {
            title: this.i18n.t('transcript.command'),
            tone: trimmedStatus ? 'warning' : 'info',
          })
          return persist(this.i18n.t('cli.status.status'))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          addCommandOutput(this.i18n.t('cli.status.failed', { message }), {
            title: this.i18n.t('transcript.command'),
            tone: 'danger',
          })
          return persist(this.i18n.t('cli.status.failed', { message }))
        }
      }

      case 'tools': {
        addCommandInput()
        const toolsText = [
          this.i18n.t('cli.tools.title'),
          this.i18n.t('cli.tools.summary', {
            count: command.bootstrap.toolCatalog.length,
          }),
          '',
          ...formatToolCatalog(command.bootstrap.toolCatalog, this.i18n),
        ].join('\n')

        addCommandOutput(toolsText, {
          title: this.i18n.t('transcript.tools'),
          tone: 'info',
        })
        return persist(this.i18n.t('cli.tools.status'))
      }

      case 'review': {
        addCommandInput()

        if (!command.bootstrap.workspace.isGitRepository) {
          addCommandOutput(this.i18n.t('cli.review.notGit'), {
            title: this.i18n.t('transcript.command'),
            tone: 'warning',
          })
          return persist(this.i18n.t('cli.review.notGit'))
        }

        try {
          const gitRunner = command.gitRunner ?? defaultGitRunner
          const [diffCheck, diffStat, statusShort] = await Promise.all([
            gitRunner.diffCheck(command.bootstrap.workspace.rootPath),
            gitRunner.diffStat(command.bootstrap.workspace.rootPath),
            gitRunner.statusShort(command.bootstrap.workspace.rootPath),
          ])

          const trimmedCheck = diffCheck.trim()
          const trimmedStat = diffStat.trim()
          const parsedStatus = parseGitStatusShort(statusShort.trim())
          const priorityFiles = rankPriorityReviewFiles(parsedStatus).slice(0, 5)
          const stagedFocus = parsedStatus.staged.slice(0, 5)
          const unstagedFocus = parsedStatus.unstaged.slice(0, 5)

          const reviewText = trimmedCheck
            ? [
                this.i18n.t('cli.review.title'),
                '',
                this.i18n.t('cli.review.findings'),
                trimmedCheck,
                '',
                this.i18n.t('cli.review.summary'),
                formatGitStatusCounts(parsedStatus, this.i18n),
                '',
                this.i18n.t('cli.review.changedFiles'),
                trimmedStat || this.i18n.t('workspace.none'),
                '',
                this.i18n.t('cli.review.stagedFocus'),
                ...formatPriorityReviewFiles(stagedFocus, this.i18n),
                '',
                this.i18n.t('cli.review.unstagedFocus'),
                ...formatPriorityReviewFiles(unstagedFocus, this.i18n),
                '',
                this.i18n.t('cli.review.priorityFiles'),
                ...formatPriorityReviewFiles(priorityFiles, this.i18n),
              ].join('\n')
            : trimmedStat
              ? [
                  this.i18n.t('cli.review.title'),
                  '',
                  this.i18n.t('cli.review.clean'),
                  '',
                  this.i18n.t('cli.review.summary'),
                  formatGitStatusCounts(parsedStatus, this.i18n),
                  '',
                  this.i18n.t('cli.review.changedFiles'),
                  trimmedStat,
                  '',
                  this.i18n.t('cli.review.stagedFocus'),
                  ...formatPriorityReviewFiles(stagedFocus, this.i18n),
                  '',
                  this.i18n.t('cli.review.unstagedFocus'),
                  ...formatPriorityReviewFiles(unstagedFocus, this.i18n),
                  '',
                  this.i18n.t('cli.review.priorityFiles'),
                  ...formatPriorityReviewFiles(priorityFiles, this.i18n),
                ].join('\n')
              : [
                  this.i18n.t('cli.review.title'),
                  '',
                  this.i18n.t('cli.review.noChanges'),
                ].join('\n')

          addCommandOutput(reviewText, {
            title: this.i18n.t('transcript.command'),
            tone: trimmedCheck ? 'warning' : 'info',
          })
          return persist(this.i18n.t('cli.review.status'))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          addCommandOutput(this.i18n.t('cli.review.failed', { message }), {
            title: this.i18n.t('transcript.command'),
            tone: 'danger',
          })
          return persist(this.i18n.t('cli.review.failed', { message }))
        }
      }

      case 'diff': {
        addCommandInput()

        if (!command.bootstrap.workspace.isGitRepository) {
          addCommandOutput(this.i18n.t('cli.diff.notGit'), {
            title: this.i18n.t('transcript.command'),
            tone: 'warning',
          })
          return persist(this.i18n.t('cli.diff.notGit'))
        }

        try {
          const gitRunner = command.gitRunner ?? defaultGitRunner
          const diffPatch = await gitRunner.diffPatch(command.bootstrap.workspace.rootPath)
          const trimmedPatch = diffPatch.trim()

          addCommandOutput(
            trimmedPatch
              ? [this.i18n.t('cli.diff.title'), '', trimLargeBlock(trimmedPatch, this.i18n)].join('\n')
              : [this.i18n.t('cli.diff.title'), '', this.i18n.t('cli.diff.noChanges')].join('\n'),
            {
              title: this.i18n.t('transcript.command'),
              tone: 'info',
            },
          )
          return persist(this.i18n.t('cli.diff.status'))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          addCommandOutput(this.i18n.t('cli.diff.failed', { message }), {
            title: this.i18n.t('transcript.command'),
            tone: 'danger',
          })
          return persist(this.i18n.t('cli.diff.failed', { message }))
        }
      }

      case 'doctor': {
        addCommandInput()
        const storage = (await this.storageSettings.inspect()).effectiveStorage
        const modelConfig = command.bootstrap.modelConfig
        const isConfigured = Boolean(modelConfig.apiKey)
        const doctorText = [
          this.i18n.t('cli.doctor.title'),
          formatKeyValueLine('workspace', command.bootstrap.workspace.rootPath),
          formatKeyValueLine(
            'git',
            this.i18n.t(command.bootstrap.workspace.isGitRepository ? 'common.yes' : 'common.no'),
          ),
          formatKeyValueLine('package', command.bootstrap.workspace.packageManager),
          formatKeyValueLine('model', modelConfig.model),
          formatKeyValueLine('provider', modelConfig.provider),
          formatKeyValueLine(
            'configured',
            this.i18n.t(isConfigured ? 'common.yes' : 'common.no'),
          ),
          formatKeyValueLine('baseUrl', modelConfig.baseUrl),
          formatKeyValueLine('tools', String(command.bootstrap.toolCatalog.length)),
          formatKeyValueLine('storage', storage.dataRoot),
          formatKeyValueLine('session', formatShortSessionId(session.id)),
          '',
          isConfigured
            ? this.i18n.t('cli.doctor.ready')
            : this.i18n.t('cli.doctor.setupRequired'),
        ].join('\n')

        addCommandOutput(doctorText, {
          title: this.i18n.t('transcript.command'),
          tone: isConfigured ? 'info' : 'warning',
        })
        return persist(this.i18n.t('cli.doctor.status'))
      }

      case 'model': {
        addCommandInput()
        const modelConfig = command.bootstrap.modelConfig
        const providers = command.bootstrap.providers
        const configPath = (await this.storageSettings.inspect()).effectiveStorage.configPath

        if (!args[0]) {
          const providerList = Object.entries(providers).map(
            ([name, provider]) => `- ${name}: ${provider.models.join(', ')} (${provider.baseUrl})`,
          )

          addCommandOutput(
            [
              this.i18n.t('cli.model.current', {
                model: modelConfig.model,
                baseUrl: modelConfig.baseUrl,
              }),
              '',
              providerList.length > 0
                ? [this.i18n.t('cli.model.providersTitle'), ...providerList].join('\n')
                : this.i18n
                    .t('cli.model.noProviders')
                    .replace('~/.adnify-cli/config.json', configPath),
              '',
              this.i18n.t('cli.model.usage'),
              this.i18n.t('cli.model.example'),
            ].join('\n'),
            { title: this.i18n.t('transcript.model'), tone: 'info' },
          )
          return persist(
            this.i18n.t('cli.model.switchedStatus', {
              model: modelConfig.model,
            }),
          )
        }

        const providerName = args[0]
        const modelName = args[1]

        if (!command.modelSwitcher) {
          addCommandOutput(this.i18n.t('cli.model.unavailable'), {
            title: this.i18n.t('transcript.model'),
            tone: 'warning',
          })
          return persist(this.i18n.t('cli.model.unavailableStatus'))
        }

        const result = command.modelSwitcher.switchModel(providerName, modelName)
        if (!result) {
          addCommandOutput(
            this.i18n.t('cli.model.providerMissing', {
              provider: providerName,
              available: Object.keys(providers).join(', ') || this.i18n.t('workspace.none'),
            }),
            {
              title: this.i18n.t('transcript.model'),
              tone: 'warning',
            },
          )
          return persist(
            this.i18n.t('cli.model.providerMissingStatus', {
              provider: providerName,
            }),
          )
        }

        addCommandOutput(
          this.i18n.t('cli.model.switchedOutput', {
            model: result.model,
            baseUrl: result.baseUrl,
          }),
          {
            title: this.i18n.t('transcript.model'),
            tone: 'success',
          },
        )
        return persist(this.i18n.t('cli.model.switchedStatus', { model: result.model }))
      }

      case 'config': {
        addCommandInput()
        const subcommand = args[0]?.toLowerCase()

        if (subcommand === 'set') {
          const field = args[1]?.toLowerCase()
          const value = field === 'provider'
            ? args[2] ?? ''
            : rawArgs.replace(/^set\s+\S+\s*/i, '').trim()

          if (!field || !value) {
            addCommandOutput(formatConfigCommandHelp(this.i18n), {
              title: this.i18n.t('transcript.config'),
              tone: 'warning',
            })
            return persist(this.i18n.t('cli.config.commandInvalidStatus'))
          }

          const nextConfigResult = updateModelConfigField(
            command.bootstrap.modelConfig,
            field,
            value,
            this.i18n,
          )
          if (!nextConfigResult.ok) {
            addCommandOutput(
              [nextConfigResult.message, '', formatConfigCommandHelp(this.i18n)].join('\n'),
              {
                title: this.i18n.t('transcript.config'),
                tone: 'warning',
              },
            )
            return persist(this.i18n.t('cli.config.commandInvalidStatus'))
          }

          let nextConfig = nextConfigResult.config
          if (field === 'provider') {
            const providerName = args[2] ?? ''
            const explicitModel = args[3]
            const preset = PROVIDER_PRESETS.find((item) => item.provider === providerName)
            nextConfig = {
              ...nextConfig,
              baseUrl: preset?.baseUrl ?? nextConfig.baseUrl,
              model: explicitModel ?? preset?.defaultModel ?? nextConfig.model,
            }
          }

          await this.modelConfigStore.save(nextConfig)
          const activeConfig = command.configUpdater?.applyModelConfig(nextConfig)
          const finalConfig = activeConfig ?? nextConfig

          addCommandOutput(formatConfigUpdatedText(finalConfig, field, this.i18n), {
            title: this.i18n.t('transcript.config'),
            tone: 'success',
          })
          return persist(this.i18n.t('cli.config.updatedStatus'))
        }

        if (subcommand === 'clear') {
          const field = args[1]?.toLowerCase()

          if (!field) {
            addCommandOutput(formatConfigCommandHelp(this.i18n), {
              title: this.i18n.t('transcript.config'),
              tone: 'warning',
            })
            return persist(this.i18n.t('cli.config.commandInvalidStatus'))
          }

          const nextConfigResult = clearModelConfigField(
            command.bootstrap.modelConfig,
            field,
            this.i18n,
          )
          if (!nextConfigResult.ok) {
            addCommandOutput(
              [nextConfigResult.message, '', formatConfigCommandHelp(this.i18n)].join('\n'),
              {
                title: this.i18n.t('transcript.config'),
                tone: 'warning',
              },
            )
            return persist(this.i18n.t('cli.config.commandInvalidStatus'))
          }

          await this.modelConfigStore.save(nextConfigResult.config)
          const activeConfig = command.configUpdater?.applyModelConfig(nextConfigResult.config)
          const finalConfig = activeConfig ?? nextConfigResult.config

          addCommandOutput(formatConfigClearedText(finalConfig, field, this.i18n), {
            title: this.i18n.t('transcript.config'),
            tone: 'success',
          })
          return persist(this.i18n.t('cli.config.updatedStatus'))
        }

        const modelConfig = command.bootstrap.modelConfig
        const storage = (await this.storageSettings.inspect()).effectiveStorage
        const maskedKey = modelConfig.apiKey
          ? `${modelConfig.apiKey.slice(0, 6)}...${modelConfig.apiKey.slice(-4)}`
          : this.i18n.t('cli.config.unset')
        const howToFile = this.i18n
          .t('cli.config.howToFile')
          .replace('~/.adnify-cli/config.json', storage.configPath)
        const howToEnv = `${this.i18n.t('cli.config.howToEnv')}, ADNIFY_HOME`

        const configText = [
          this.i18n.t('cli.config.title'),
          formatKeyValueLine('provider', modelConfig.provider),
          formatKeyValueLine('apiKey', maskedKey),
          formatKeyValueLine('baseUrl', modelConfig.baseUrl),
          formatKeyValueLine('model', modelConfig.model),
          formatKeyValueLine('maxTokens', String(modelConfig.maxTokens)),
          formatKeyValueLine('temperature', String(modelConfig.temperature)),
          formatKeyValueLine('timeout', `${modelConfig.timeoutMs}ms`),
          formatKeyValueLine('dataRoot', storage.dataRoot),
          formatKeyValueLine('config', storage.configPath),
          formatKeyValueLine('sessions', storage.sessionsDir),
          '',
          formatConfigCommandHelp(this.i18n),
          '',
          this.i18n.t('cli.config.howTo'),
          howToFile,
          howToEnv,
        ].join('\n')

        addCommandOutput(configText, {
          title: this.i18n.t('transcript.config'),
          tone: 'info',
        })
        return persist(this.i18n.t('cli.config.status'))
      }

      case 'language':
      case 'lang': {
        addCommandInput()
        const requested = args[0]

        if (!requested) {
          const message = [
            this.i18n.t('cli.language.current', { value: this.i18n.locale }),
            this.i18n.t('cli.language.usage'),
          ].join('\n')
          addCommandOutput(message, {
            title: this.i18n.t('transcript.config'),
            tone: 'info',
          })
          return persist(this.i18n.t('cli.language.current', { value: this.i18n.locale }))
        }

        const normalizedInput = requested.toLowerCase()
        const locale = normalizedInput === 'zh' || normalizedInput === 'zh-cn'
          ? 'zh-CN'
          : normalizedInput === 'en' || normalizedInput === 'en-us'
            ? 'en'
            : null

        if (!locale) {
          const message = this.i18n.t('cli.language.invalid', { value: requested })
          addCommandOutput(message, {
            title: this.i18n.t('transcript.config'),
            tone: 'warning',
          })
          return persist(message)
        }

        if (!this.storageSettings.setLocale) {
          throw new Error('Language settings are unavailable in this runtime')
        }
        await this.storageSettings.setLocale(locale)
        const message = this.i18n.t('cli.language.saved', { value: locale })
        addCommandOutput(message, {
          title: this.i18n.t('transcript.config'),
          tone: 'success',
        })
        return persist(message)
      }

      case 'animation': {
        addCommandInput()
        const level = args[0]?.toLowerCase()

        if (level !== 'off' && level !== 'minimal' && level !== 'full') {
          const message = level
            ? this.i18n.t('cli.animation.invalid', { value: level })
            : this.i18n.t('cli.animation.usage')
          addCommandOutput(message, {
            title: this.i18n.t('transcript.config'),
            tone: level ? 'warning' : 'info',
          })
          return persist(message)
        }

        if (!this.storageSettings.setAnimationLevel) {
          throw new Error('Animation settings are unavailable in this runtime')
        }
        await this.storageSettings.setAnimationLevel(level)
        const message = this.i18n.t('cli.animation.saved', { value: level })
        addCommandOutput(message, {
          title: this.i18n.t('transcript.config'),
          tone: 'success',
        })
        return persist(message)
      }

      case 'permissions':
      case 'permission': {
        addCommandInput()
        const requested = args[0]?.toLowerCase()
        const modes: PermissionMode[] = ['manual', 'workspace', 'auto', 'plan']

        if (!requested) {
          const current = command.permissionController?.getMode() ?? 'workspace'
          const message = [
            this.i18n.t('cli.permissions.current', { value: current }),
            this.i18n.t('cli.permissions.usage'),
          ].join('\n')
          addCommandOutput(message, { title: this.i18n.t('transcript.config'), tone: 'info' })
          return persist(message)
        }

        if (!modes.includes(requested as PermissionMode)) {
          const message = this.i18n.t('cli.permissions.invalid', { value: requested })
          addCommandOutput(message, { title: this.i18n.t('transcript.config'), tone: 'warning' })
          return persist(message)
        }

        const mode = requested as PermissionMode
        if (!this.storageSettings.setPermissionMode || !command.permissionController) {
          throw new Error('Permission settings are unavailable in this runtime')
        }
        await this.storageSettings.setPermissionMode(mode)
        command.permissionController.setMode(mode)
        const message = this.i18n.t('cli.permissions.saved', { value: mode })
        addCommandOutput(message, { title: this.i18n.t('transcript.config'), tone: 'success' })
        return persist(message)
      }

      case 'session': {
        addCommandInput()
        addCommandOutput(formatCurrentSession(session, this.i18n), {
          title: this.i18n.t('transcript.session'),
          tone: 'info',
        })
        return persist(this.i18n.t('cli.session.status'))
      }

      case 'storage': {
        addCommandInput()
        const subcommand = args[0]?.toLowerCase()

        if (subcommand === 'set') {
          const nextPath = rawArgs.replace(/^set\s+/i, '').trim()

          if (!nextPath) {
            addCommandOutput(
              [this.i18n.t('cli.storage.setMissingPath'), this.i18n.t('cli.storage.usage')].join(
                '\n',
              ),
              {
                title: this.i18n.t('transcript.config'),
                tone: 'warning',
              },
            )
            return persist(this.i18n.t('cli.storage.invalidStatus'))
          }

          const result = await this.storageSettings.setDataDirectory(nextPath)
          addCommandOutput(formatStorageUpdate(result, this.i18n, 'set'), {
            title: this.i18n.t('transcript.config'),
            tone: 'success',
          })
          return persist(this.i18n.t('cli.storage.updatedStatus'))
        }

        if (subcommand === 'reset') {
          const result = await this.storageSettings.resetDataDirectory()
          addCommandOutput(formatStorageUpdate(result, this.i18n, 'reset'), {
            title: this.i18n.t('transcript.config'),
            tone: 'success',
          })
          return persist(this.i18n.t('cli.storage.resetStatus'))
        }

        const snapshot = await this.storageSettings.inspect()
        addCommandOutput(formatStorageSnapshot(snapshot, this.i18n), {
          title: this.i18n.t('transcript.config'),
          tone: 'info',
        })
        return persist(this.i18n.t('cli.storage.status'))
      }

      case 'sessions': {
        addCommandInput()
        const sessions = await this.sessionRepository.listByWorkspace(session.workspacePath, 8)
        const lines =
          sessions.length > 0
            ? [
                this.i18n.t('cli.sessions.columns'),
                ...sessions.map((item, index) => formatSessionLine(item, index, session.id)),
              ]
            : [this.i18n.t('cli.sessions.empty')]

        addCommandOutput(
          [this.i18n.t('cli.sessions.title'), ...lines, '', this.i18n.t('cli.sessions.hint')].join(
            '\n',
          ),
          {
            title: this.i18n.t('transcript.session'),
            tone: 'info',
          },
        )

        return persist(this.i18n.t('cli.sessions.status'))
      }

      case 'resume': {
        const sessions = await this.sessionRepository.listByWorkspace(session.workspacePath, 12)
        const resumeMatch = resolveResumeTarget(args.join(' '), session.id, sessions)

        if (resumeMatch.kind !== 'matched') {
          addCommandInput()
          addCommandOutput(formatResumeFailure(resumeMatch, sessions, session.id, this.i18n), {
            title: this.i18n.t('transcript.session'),
            tone: 'warning',
          })
          return persist(this.i18n.t('cli.resume.failedStatus'))
        }

        this.logger.info('Resumed session from local history', {
          previousSessionId: session.id,
          nextSessionId: resumeMatch.session.id,
        })

        return {
          session: resumeMatch.session,
          statusLine: this.i18n.t('cli.resume.status', {
            id: formatShortSessionId(resumeMatch.session.id),
          }),
        }
      }

      case 'clear': {
        session.clearConversation(now)
        return persist(this.i18n.t('cli.clear.status'))
      }

      case 'memory': {
        addCommandInput()
        const subArg = args[0]

        if (command.memoryStore) {
          if (subArg === 'clear') {
            await command.memoryStore.clear()
            addCommandOutput('All project memories cleared.', {
              title: this.i18n.t('transcript.command'),
              tone: 'success',
            })
            return persist('Cleared all memories.')
          }

          if (subArg === 'list' || !subArg) {
            const entries = await command.memoryStore.list()
            const text =
              entries.length > 0
                ? [
                    `Project memories (${entries.length}):`,
                    ...entries.map(
                      (e: { id: string; content: string; createdAt: string }, i: number) =>
                        `[${i + 1}] ${e.content}`,
                    ),
                  ].join('\n')
                : 'No memories saved yet. Use :memory <content> to save a fact.'
            addCommandOutput(text, { title: this.i18n.t('transcript.command'), tone: 'info' })
            return persist(`Showing ${entries.length} memor${entries.length === 1 ? 'y' : 'ies'}.`)
          }

          // :memory <content> — save a new memory
          const memoryContent = rawArgs.trim()
          if (memoryContent) {
            const entry = await command.memoryStore.add(memoryContent)
            addCommandOutput(`Memory saved: ${entry.content}`, {
              title: this.i18n.t('transcript.command'),
              tone: 'success',
            })
            return persist('Memory saved for future sessions.')
          }
        }

        addCommandOutput(
          'Memory store not available. Usage: :memory <content> | :memory list | :memory clear',
          { title: this.i18n.t('transcript.command'), tone: 'warning' },
        )
        return persist('Memory store not available.')
      }

      case 'checkpoint': {
        addCommandInput()

        if (!command.bootstrap.workspace.isGitRepository) {
          addCommandOutput('Not a git repository — checkpoint requires git.', {
            title: this.i18n.t('transcript.command'),
            tone: 'warning',
          })
          return persist('Checkpoint requires git.')
        }

        try {
          const message = rawArgs.trim() || `adnify-checkpoint: ${new Date().toISOString()}`
          const workspacePath = command.bootstrap.workspace.rootPath
          await execFileAsync('git', ['add', '-A'], { cwd: workspacePath, windowsHide: true })
          await execFileAsync('git', ['commit', '-m', message, '--no-verify'], {
            cwd: workspacePath,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
          })
          const { stdout: logOut } = await execFileAsync(
            'git',
            ['log', '--oneline', '-1'],
            { cwd: workspacePath, windowsHide: true },
          )
          addCommandOutput(
            ['Checkpoint created.', logOut.trim()].join('\n'),
            { title: this.i18n.t('transcript.command'), tone: 'success' },
          )
          return persist('Checkpoint committed.')
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          const hint = msg.includes('nothing to commit')
            ? 'Nothing to commit — working tree is clean.'
            : `Checkpoint failed: ${msg}`
          addCommandOutput(hint, {
            title: this.i18n.t('transcript.command'),
            tone: msg.includes('nothing to commit') ? 'info' : 'danger',
          })
          return persist(hint)
        }
      }

      case 'undo': {
        addCommandInput()

        if (!command.bootstrap.workspace.isGitRepository) {
          addCommandOutput('Not a git repository — undo requires git.', {
            title: this.i18n.t('transcript.command'),
            tone: 'warning',
          })
          return persist('Undo requires git.')
        }

        try {
          const workspacePath = command.bootstrap.workspace.rootPath
          // Undo last commit, keeping changes in working tree
          await execFileAsync('git', ['reset', '--soft', 'HEAD~1'], {
            cwd: workspacePath,
            windowsHide: true,
          })
          const { stdout: statusOut } = await execFileAsync(
            'git',
            ['status', '--short'],
            { cwd: workspacePath, windowsHide: true },
          )
          addCommandOutput(
            [
              'Reverted last commit (changes kept in staging).',
              statusOut.trim() || 'Working tree clean.',
            ].join('\n'),
            { title: this.i18n.t('transcript.command'), tone: 'success' },
          )
          return persist('Undid last checkpoint.')
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          addCommandOutput(`Undo failed: ${msg}`, {
            title: this.i18n.t('transcript.command'),
            tone: 'danger',
          })
          return persist(`Undo failed: ${msg}`)
        }
      }

      case 'restore': {
        addCommandInput()

        if (!command.checkpointStore) {
          addCommandOutput('Checkpoint store not available.', {
            title: this.i18n.t('transcript.command'),
            tone: 'warning',
          })
          return persist('Checkpoint store not available.')
        }

        const snapshots = command.checkpointStore.listSnapshots()

        // `:restore` with no argument lists the rollback points.
        if (!args[0]) {
          if (snapshots.length === 0) {
            addCommandOutput(
              'No file checkpoints yet. They are captured automatically before each approved file write.',
              { title: this.i18n.t('transcript.command'), tone: 'info' },
            )
            return persist('No file checkpoints.')
          }

          const text = [
            `File checkpoints (${snapshots.length}), newest first:`,
            ...snapshots.slice(0, 20).map((snapshot, index) => {
              const files = snapshot.entries.map((entry) => entry.relativePath).join(', ')
              return `[${index + 1}] ${snapshot.id}  ${snapshot.description}${files ? ` — ${files}` : ''}`
            }),
            '',
            'Use :restore <id> to roll one back.',
          ].join('\n')

          addCommandOutput(text, { title: this.i18n.t('transcript.command'), tone: 'info' })
          return persist(`Showing ${snapshots.length} checkpoint(s).`)
        }

        // Accept either the snapshot id or its 1-based index from the listing above.
        const selector = args[0].trim()
        const byIndex = Number.parseInt(selector, 10)
        const target =
          Number.isFinite(byIndex) && String(byIndex) === selector
            ? snapshots[byIndex - 1]
            : snapshots.find((snapshot) => snapshot.id === selector)

        if (!target) {
          addCommandOutput(`No checkpoint matches "${selector}". Use :restore to list them.`, {
            title: this.i18n.t('transcript.command'),
            tone: 'warning',
          })
          return persist(`Unknown checkpoint "${selector}".`)
        }

        const restored = command.checkpointStore.restore(target.id)
        if (!restored) {
          addCommandOutput(`Failed to restore checkpoint ${target.id}.`, {
            title: this.i18n.t('transcript.command'),
            tone: 'danger',
          })
          return persist(`Restore failed for ${target.id}.`)
        }

        addCommandOutput(
          [
            `Restored ${restored.length} file(s) from ${target.id}:`,
            ...restored.map((entry) => `  ${entry.relativePath}`),
          ].join('\n'),
          { title: this.i18n.t('transcript.command'), tone: 'success' },
        )
        return persist(`Restored ${restored.length} file(s).`)
      }

      case 'context': {
        addCommandInput()
        const messages = session.getMessages()
        const userMessages = messages.filter((m) => m.role === 'user')
        const assistantMessages = messages.filter((m) => m.role === 'assistant')
        const systemMessages = messages.filter((m) => m.role === 'system')

        const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
        const approxTokens = Math.ceil(totalChars / 4)

        const text = [
          'Context window summary:',
          formatKeyValueLine('messages', String(messages.length)),
          formatKeyValueLine('user', String(userMessages.length)),
          formatKeyValueLine('assistant', String(assistantMessages.length)),
          formatKeyValueLine('system', String(systemMessages.length)),
          formatKeyValueLine('totalChars', String(totalChars)),
          formatKeyValueLine('approxTokens', String(approxTokens)),
          formatKeyValueLine('maxTokens', String(command.bootstrap.modelConfig.maxTokens)),
          '',
          approxTokens > command.bootstrap.modelConfig.maxTokens * 0.7
            ? 'Warning: context is approaching token limit. Consider :clear to reset.'
            : 'Context looks healthy.',
        ].join('\n')

        addCommandOutput(text, {
          title: this.i18n.t('transcript.command'),
          tone: 'info',
        })
        return persist('Context summary displayed.')
      }

      case 'exit': {
        addCommandInput()
        addCommandOutput(this.i18n.t('cli.exit.output'), {
          title: this.i18n.t('transcript.session'),
          tone: 'info',
        })

        this.logger.info('User requested CLI exit', { sessionId: command.sessionId })
        return persist(this.i18n.t('cli.exit.status'), { shouldExit: true })
      }

      case 'skill': {
        addCommandInput()
        const subArg = args[0]
        const skillStore = command.skillStore

        if (!skillStore) {
          addCommandOutput('Skills are not available in this session.', {
            title: this.i18n.t('transcript.command'),
            tone: 'warning',
          })
          return persist('Skills not available.')
        }

        if (subArg === 'list' || !subArg) {
          const skills = await skillStore.listSkills()
          if (skills.length === 0) {
            addCommandOutput(
              'No skills found. Create a skill by adding a SKILL.md file to .adnify/skills/<name>/ or your global data directory.',
              { title: this.i18n.t('transcript.command'), tone: 'info' },
            )
            return persist('No skills available.')
          }
          const text = [
            `Available skills (${skills.length}):`,
            ...skills.map((s) => `- ${s.name}: ${s.description}`),
          ].join('\n')
          addCommandOutput(text, { title: this.i18n.t('transcript.command'), tone: 'info' })
          return persist(`Listed ${skills.length} skill(s).`)
        }

        // :skill <name> — show full skill body
        const skillBody = await skillStore.getSkillBody(subArg)
        if (!skillBody) {
          addCommandOutput(`Skill "${subArg}" not found. Use :skill list to see available skills.`, {
            title: this.i18n.t('transcript.command'),
            tone: 'warning',
          })
          return persist(`Skill "${subArg}" not found.`)
        }

        addCommandOutput(skillBody, {
          title: this.i18n.t('transcript.command'),
          tone: 'info',
        })
        return persist(`Loaded skill: ${subArg}`)
      }

      case 'mcp': {
        addCommandInput()
        const servers = command.mcpServerList ?? []

        if (servers.length === 0) {
          addCommandOutput(
            'No MCP servers connected. Configure them in config.json under "mcpServers".',
            { title: this.i18n.t('transcript.command'), tone: 'info' },
          )
          return persist('No MCP servers connected.')
        }

        const text = [
          `Connected MCP servers (${servers.length}):`,
          ...servers.map((s) => `- ${s}`),
        ].join('\n')
        addCommandOutput(text, { title: this.i18n.t('transcript.command'), tone: 'info' })
        return persist(`Listed ${servers.length} MCP server(s).`)
      }

      default: {
        addCommandInput()
        addCommandOutput(
          this.i18n.t('cli.unknown.output', {
            command: verb || '<empty>',
          }),
          {
            title: this.i18n.t('transcript.command'),
            tone: 'warning',
          },
        )
        return persist(this.i18n.t('cli.unknown.status'))
      }
    }
  }
}

const defaultGitRunner: GitRunner = {
  currentBranch: async (workspacePath) =>
    runGitCommand(workspacePath, ['branch', '--show-current']),
  branchTrackingSummary: async (workspacePath) =>
    runGitCommand(workspacePath, ['status', '--short', '--branch']),
  statusShort: async (workspacePath) => runGitCommand(workspacePath, ['status', '--short']),
  lastCommitSummary: async (workspacePath) =>
    runGitCommand(workspacePath, ['log', '-1', '--pretty=format:%h %s']),
  diffCheck: async (workspacePath) => runGitCommand(workspacePath, ['diff', '--check']),
  diffStat: async (workspacePath) => runGitCommand(workspacePath, ['diff', '--stat']),
  diffPatch: async (workspacePath) =>
    runGitCommand(workspacePath, ['diff', '--no-ext-diff', '--unified=3']),
}

async function runGitCommand(workspacePath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: workspacePath,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'stdout' in error &&
      typeof (error as { stdout?: unknown }).stdout === 'string'
    ) {
      return ((error as { stdout: string }).stdout ?? '').trim()
    }

    throw error instanceof Error ? error : new Error(String(error))
  }
}

function normalizeCommandLine(commandLine: string): string {
  return commandLine.trim().replace(/^[:/]/, '').trim()
}

function toDisplayCommand(commandLine: string): string {
  return commandLine ? `/${commandLine}` : '/'
}

function formatToolLine(tool: ToolDescriptor, i18n: AppI18n): string {
  return `- ${localizeToolName(tool, i18n)} ${formatToolRiskBadge(tool, i18n)}: ${localizeToolDescription(tool, i18n)}`
}

/**
 * 超大块内容的兜底截断。
 *
 * 输出进的是会话区，而会话区现在可以滚动，所以不需要为「屏幕放不下」而截断 ——
 * 用户翻得到。这里只防病理情况（几十万行的 diff 会拖垮渲染），
 * 因此阈值放得很宽，并且必须说清楚省掉了多少，不能只留一句「truncated」。
 */
function trimLargeBlock(content: string, i18n: AppI18n, maxLength = 200_000): string {
  if (content.length <= maxLength) {
    return content
  }

  const omitted = content.length - maxLength

  return `${content.slice(0, maxLength)}\n\n${i18n.t('cli.output.omittedChars', { count: omitted })}`
}

function formatToolCatalog(tools: ToolDescriptor[], i18n: AppI18n): string[] {
  const grouped = new Map<string, ToolDescriptor[]>()

  for (const tool of tools) {
    const existing = grouped.get(tool.category) ?? []
    existing.push(tool)
    grouped.set(tool.category, existing)
  }

  const lines: string[] = []
  for (const [category, entries] of grouped.entries()) {
    if (lines.length > 0) {
      lines.push('')
    }

    lines.push(`# ${formatToolCategory(category, i18n)}`)
    for (const tool of entries) {
      lines.push(formatToolLine(tool, i18n))
    }
  }

  return lines
}

function formatToolCategory(category: string, i18n: AppI18n): string {
  return i18n.maybeT(`tool.category.${category}`) ?? category
}

function formatToolRiskBadge(tool: ToolDescriptor, i18n: AppI18n): string {
  return `[${localizeToolRisk(tool, i18n)}]`
}

function localizeToolRisk(tool: ToolDescriptor, i18n: AppI18n): string {
  const key = `tool.risk.${tool.riskLevel}`
  return i18n.maybeT(key) ?? tool.riskLevel
}

interface ParsedGitStatus {
  staged: string[]
  unstaged: string[]
  untracked: string[]
}

interface BranchTrackingSummary {
  upstream: string
  ahead: number
  behind: number
}

function parseGitStatusShort(statusShort: string): ParsedGitStatus {
  const parsed: ParsedGitStatus = {
    staged: [],
    unstaged: [],
    untracked: [],
  }

  for (const line of statusShort.split('\n')) {
    if (!line) {
      continue
    }

    const x = line[0] ?? ' '
    const y = line[1] ?? ' '
    const file = line.slice(3).trim()
    if (!file) {
      continue
    }

    if (x === '?' && y === '?') {
      parsed.untracked.push(file)
      continue
    }

    if (x !== ' ') {
      parsed.staged.push(file)
    }

    if (y !== ' ') {
      parsed.unstaged.push(file)
    }
  }

  return parsed
}

function parseBranchTrackingSummary(statusOutput: string): BranchTrackingSummary | null {
  const firstLine = statusOutput.split('\n')[0]?.trim() ?? ''
  if (!firstLine.startsWith('## ')) {
    return null
  }

  const content = firstLine.slice(3)
  const match = content.match(/^[^.]+\.\.\.([^\s]+)(?: \[(.+)\])?$/)
  if (!match) {
    return null
  }

  const upstream = match[1]?.trim()
  const details = match[2]?.trim() ?? ''
  if (!upstream) {
    return null
  }

  const aheadMatch = details.match(/ahead (\d+)/)
  const behindMatch = details.match(/behind (\d+)/)

  return {
    upstream,
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1] ?? '0', 10) : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1] ?? '0', 10) : 0,
  }
}

function formatBranchTrackingSummary(summary: BranchTrackingSummary, i18n: AppI18n): string {
  if (summary.ahead === 0 && summary.behind === 0) {
    return `${summary.upstream} (${i18n.t('cli.status.upToDate')})`
  }

  const parts: string[] = []
  if (summary.ahead > 0) {
    parts.push(i18n.t('cli.status.aheadBy', { count: summary.ahead }))
  }
  if (summary.behind > 0) {
    parts.push(i18n.t('cli.status.behindBy', { count: summary.behind }))
  }

  return `${summary.upstream} (${parts.join(', ')})`
}

function formatGitStatusSummary(parsed: ParsedGitStatus, i18n: AppI18n): string {
  const lines: string[] = []
  const summaryParts = buildGitStatusCountParts(parsed, i18n)

  if (summaryParts.length > 0) {
    lines.push(summaryParts.join('  '), '')
  }

  if (parsed.staged.length > 0) {
    lines.push(i18n.t('cli.status.staged'))
    lines.push(...parsed.staged.map((file) => `- ${file}`))
  }

  if (parsed.unstaged.length > 0) {
    if (lines.length > 0) {
      lines.push('')
    }
    lines.push(i18n.t('cli.status.unstaged'))
    lines.push(...parsed.unstaged.map((file) => `- ${file}`))
  }

  if (parsed.untracked.length > 0) {
    if (lines.length > 0) {
      lines.push('')
    }
    lines.push(i18n.t('cli.status.untracked'))
    lines.push(...parsed.untracked.map((file) => `- ${file}`))
  }

  return lines.join('\n') || i18n.t('cli.status.clean')
}

function formatGitStatusCounts(parsed: ParsedGitStatus, i18n: AppI18n): string {
  const summaryParts = buildGitStatusCountParts(parsed, i18n)
  return summaryParts.join('  ') || i18n.t('cli.status.clean')
}

function buildGitStatusCountParts(parsed: ParsedGitStatus, i18n: AppI18n): string[] {
  const summaryParts: string[] = []

  if (parsed.staged.length > 0) {
    summaryParts.push(i18n.t('cli.status.countStaged', { count: parsed.staged.length }))
  }

  if (parsed.unstaged.length > 0) {
    summaryParts.push(i18n.t('cli.status.countUnstaged', { count: parsed.unstaged.length }))
  }

  if (parsed.untracked.length > 0) {
    summaryParts.push(i18n.t('cli.status.countUntracked', { count: parsed.untracked.length }))
  }

  return summaryParts
}

function rankPriorityReviewFiles(parsed: ParsedGitStatus): string[] {
  const seen = new Set<string>()
  const ordered = [...parsed.unstaged, ...parsed.staged, ...parsed.untracked]
  const files: { file: string; score: number }[] = []

  for (const file of ordered) {
    if (!file || seen.has(file)) {
      continue
    }
    seen.add(file)
    files.push({ file, score: reviewPriorityScore(file, parsed) })
  }

  return files.sort((left, right) => right.score - left.score).map((item) => item.file)
}

function reviewPriorityScore(file: string, parsed: ParsedGitStatus): number {
  let score = 0

  if (parsed.unstaged.includes(file)) {
    score += 3
  }
  if (parsed.staged.includes(file)) {
    score += 2
  }
  if (parsed.untracked.includes(file)) {
    score += 1
  }
  if (/test|spec/i.test(file)) {
    score -= 1
  }
  if (/src\//i.test(file)) {
    score += 1
  }

  return score
}

function formatPriorityReviewFiles(files: string[], i18n: AppI18n): string[] {
  if (files.length === 0) {
    return [i18n.t('workspace.none')]
  }

  return files.map((file) => `- ${file}`)
}

function localizeToolName(tool: ToolDescriptor, i18n: AppI18n): string {
  return i18n.maybeT(`tool.${tool.id}.name`) ?? tool.name
}

function localizeToolDescription(tool: ToolDescriptor, i18n: AppI18n): string {
  return i18n.maybeT(`tool.${tool.id}.description`) ?? tool.description
}

function formatShortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

function formatSessionLine(
  session: ConversationSession,
  index: number,
  currentSessionId: string,
): string {
  const marker = session.id === currentSessionId ? '>' : ' '
  const updatedAt = session.updatedAt.toISOString().replace('T', ' ').slice(5, 16)
  const messageCount = `${session.getMessages().length}m`

  return `${index + 1}. ${marker} [${formatShortSessionId(session.id)}]  ${session.mode.padEnd(5, ' ')}  ${messageCount.padStart(4, ' ')}  ${updatedAt}  ${session.title}`
}

type ResumeMatchResult =
  | { kind: 'matched'; session: ConversationSession }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; matches: ConversationSession[] }

function resolveResumeTarget(
  rawQuery: string,
  currentSessionId: string,
  sessions: ConversationSession[],
): ResumeMatchResult {
  const query = rawQuery.trim()
  const resumableSessions = sessions.filter((item) => item.id !== currentSessionId)

  if (!query) {
    const first = resumableSessions[0]
    return first ? { kind: 'matched', session: first } : { kind: 'missing' }
  }

  const byIndex = Number.parseInt(query, 10)
  if (!Number.isNaN(byIndex) && byIndex >= 1 && byIndex <= sessions.length) {
    const indexed = sessions[byIndex - 1]
    if (!indexed || indexed.id === currentSessionId) {
      return { kind: 'missing' }
    }

    return { kind: 'matched', session: indexed }
  }

  const byIdPrefix = resumableSessions.filter((item) => item.id.startsWith(query))
  if (byIdPrefix.length === 1) {
    return { kind: 'matched', session: byIdPrefix[0]! }
  }
  if (byIdPrefix.length > 1) {
    return { kind: 'ambiguous', matches: byIdPrefix.slice(0, 5) }
  }

  const normalizedQuery = query.toLowerCase()
  const byTitle = resumableSessions.filter((item) =>
    item.title.toLowerCase().includes(normalizedQuery),
  )
  if (byTitle.length === 1) {
    return { kind: 'matched', session: byTitle[0]! }
  }
  if (byTitle.length > 1) {
    return { kind: 'ambiguous', matches: byTitle.slice(0, 5) }
  }

  return { kind: 'missing' }
}

function formatResumeFailure(
  match: Exclude<ResumeMatchResult, { kind: 'matched' }>,
  sessions: ConversationSession[],
  currentSessionId: string,
  i18n: AppI18n,
): string {
  if (match.kind === 'ambiguous') {
    return [
      i18n.t('cli.resume.ambiguous'),
      ...match.matches.map((session, index) =>
        formatResumeCandidateLine(session, index + 1, currentSessionId, i18n),
      ),
    ].join('\n')
  }

  const resumableSessions = sessions.filter((item) => item.id !== currentSessionId).slice(0, 3)
  if (resumableSessions.length === 0) {
    return i18n.t('cli.resume.notFound')
  }

  return [
    i18n.t('cli.resume.notFound'),
    '',
    i18n.t('cli.resume.suggestions'),
    ...resumableSessions.map((session, index) =>
      formatResumeCandidateLine(session, index + 1, currentSessionId, i18n),
    ),
  ].join('\n')
}

function formatResumeCandidateLine(
  session: ConversationSession,
  index: number,
  currentSessionId: string,
  i18n: AppI18n,
): string {
  const marker = session.id === currentSessionId ? '>' : '-'
  return `${index}. ${marker} [${formatShortSessionId(session.id)}] ${session.title} (${session.mode})`
}

function formatStorageSnapshot(snapshot: StorageSettingsSnapshot, i18n: AppI18n): string {
  const lines = [
    i18n.t('cli.storage.title'),
    formatKeyValueLine('source', localizeStorageSource(snapshot.effectiveStorage.source, i18n)),
    formatKeyValueLine('root', snapshot.effectiveStorage.dataRoot),
    formatKeyValueLine('config', snapshot.effectiveStorage.configPath),
    formatKeyValueLine('sessions', snapshot.effectiveStorage.sessionsDir),
    formatKeyValueLine('settings', snapshot.settingsPath),
    formatKeyValueLine(
      'custom',
      snapshot.configuredDataRoot ?? i18n.t('cli.storage.customRootUnset'),
    ),
    '',
    i18n.t('cli.storage.usage'),
  ]

  if (snapshot.effectiveStorage.source === 'env') {
    lines.push('', i18n.t('cli.storage.envOverride'))
  }

  return lines.join('\n')
}

function formatCurrentSession(session: ConversationSession, i18n: AppI18n): string {
  return [
    i18n.t('cli.session.title'),
    formatKeyValueLine('id', session.id),
    formatKeyValueLine('short', formatShortSessionId(session.id)),
    formatKeyValueLine('title', session.title),
    formatKeyValueLine('mode', session.mode),
    formatKeyValueLine('messages', String(session.getMessages().length)),
    formatKeyValueLine('updated', session.updatedAt.toISOString()),
    formatKeyValueLine('workspace', session.workspacePath),
  ].join('\n')
}

function formatConfigCommandHelp(i18n: AppI18n): string {
  return [
    i18n.t('cli.config.commandHelpTitle'),
    i18n.t('cli.config.commandHelpSetProvider'),
    i18n.t('cli.config.commandHelpSetModel'),
    i18n.t('cli.config.commandHelpSetApiKey'),
    i18n.t('cli.config.commandHelpSetBaseUrl'),
    i18n.t('cli.config.commandHelpSetMaxTokens'),
    i18n.t('cli.config.commandHelpSetTemperature'),
    i18n.t('cli.config.commandHelpSetTimeout'),
    i18n.t('cli.config.commandHelpClearApiKey'),
    i18n.t('cli.config.commandHelpInit'),
  ].join('\n')
}

function formatConfigUpdatedText(config: ModelConfig, field: string, i18n: AppI18n): string {
  return [
    i18n.t('cli.config.updated'),
    formatKeyValueLine('field', field),
    formatKeyValueLine('provider', config.provider),
    formatKeyValueLine('model', config.model),
    formatKeyValueLine('baseUrl', config.baseUrl),
  ].join('\n')
}

function formatConfigClearedText(config: ModelConfig, field: string, i18n: AppI18n): string {
  return [
    i18n.t('cli.config.cleared'),
    formatKeyValueLine('field', field),
    formatKeyValueLine('provider', config.provider),
    formatKeyValueLine('model', config.model),
    formatKeyValueLine('baseUrl', config.baseUrl),
  ].join('\n')
}

function updateModelConfigField(
  config: ModelConfig,
  field: string,
  rawValue: string,
  i18n: AppI18n,
): { ok: true; config: ModelConfig } | { ok: false; message: string } {
  const value = rawValue.trim()
  switch (field) {
    case 'provider': {
      if (!isModelProvider(value)) {
        return { ok: false, message: i18n.t('cli.config.errorUnsupportedProvider', { value }) }
      }

      return {
        ok: true,
        config: {
          ...config,
          provider: value,
        },
      }
    }
    case 'model':
      return {
        ok: true,
        config: {
          ...config,
          model: value,
        },
      }
    case 'api-key':
    case 'apikey':
    case 'key':
      return {
        ok: true,
        config: {
          ...config,
          apiKey: value,
        },
      }
    case 'base-url':
    case 'baseurl':
      return {
        ok: true,
        config: {
          ...config,
          baseUrl: value,
        },
      }
    case 'max-tokens':
    case 'maxtokens': {
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { ok: false, message: i18n.t('cli.config.errorInvalidMaxTokens', { value }) }
      }

      return {
        ok: true,
        config: {
          ...config,
          maxTokens: parsed,
        },
      }
    }
    case 'temperature': {
      const parsed = Number.parseFloat(value)
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
        return { ok: false, message: i18n.t('cli.config.errorInvalidTemperature', { value }) }
      }

      return {
        ok: true,
        config: {
          ...config,
          temperature: parsed,
        },
      }
    }
    case 'timeout':
    case 'timeout-ms':
    case 'timeoutms': {
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { ok: false, message: i18n.t('cli.config.errorInvalidTimeout', { value }) }
      }

      return {
        ok: true,
        config: {
          ...config,
          timeoutMs: parsed,
        },
      }
    }
    default:
      return { ok: false, message: i18n.t('cli.config.errorUnsupportedField', { value: field }) }
  }
}

function clearModelConfigField(
  config: ModelConfig,
  field: string,
  i18n: AppI18n,
): { ok: true; config: ModelConfig } | { ok: false; message: string } {
  switch (field) {
    case 'api-key':
    case 'apikey':
    case 'key':
      return {
        ok: true,
        config: {
          ...config,
          apiKey: '',
        },
      }
    default:
      return {
        ok: false,
        message: i18n.t('cli.config.errorUnsupportedClearField', { value: field }),
      }
  }
}

function isModelProvider(value: string): value is ModelProvider {
  return (
    value === 'openai-compatible' ||
    value === 'openai-responses' ||
    value === 'anthropic' ||
    value === 'google'
  )
}

function formatStorageUpdate(
  result: StorageSettingsUpdateResult,
  i18n: AppI18n,
  action: 'set' | 'reset',
): string {
  const lines = [
    action === 'set' ? i18n.t('cli.storage.updated') : i18n.t('cli.storage.reset'),
    formatKeyValueLine('root', result.effectiveStorage.dataRoot),
    formatKeyValueLine('config', result.effectiveStorage.configPath),
    formatKeyValueLine('sessions', result.effectiveStorage.sessionsDir),
    formatKeyValueLine('settings', result.settingsPath),
    formatKeyValueLine(
      'custom',
      result.configuredDataRoot ?? i18n.t('cli.storage.customRootUnset'),
    ),
  ]

  if (result.migratedConfig) {
    lines.push(i18n.t('cli.storage.configMigrated'))
  }

  if (result.migratedSessions) {
    lines.push(i18n.t('cli.storage.sessionsMigrated'))
  }

  if (!result.migratedConfig && !result.migratedSessions && action === 'set') {
    lines.push(i18n.t('cli.storage.migrationSkipped'))
  }

  if (result.effectiveStorage.source === 'env') {
    lines.push(i18n.t('cli.storage.envOverride'))
  }

  if (result.requiresRestart) {
    lines.push(i18n.t('cli.storage.restartHint'))
  }

  return lines.join('\n')
}

function localizeStorageSource(source: 'default' | 'env' | 'settings', i18n: AppI18n): string {
  switch (source) {
    case 'env':
      return i18n.t('cli.storage.sourceEnv')
    case 'settings':
      return i18n.t('cli.storage.sourceSettings')
    case 'default':
    default:
      return i18n.t('cli.storage.sourceDefault')
  }
}

function formatKeyValueLine(label: string, value: string): string {
  return `- ${label.padEnd(9, ' ')} ${value}`
}
