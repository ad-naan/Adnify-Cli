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
import type { ModelConfig, ModelProvider } from '../../domain/assistant/value-objects/ModelConfig'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  createCliCommandInputContent,
  createCliCommandOutputContent,
} from '../support/CliTranscriptMarkup'
import { formatWorkspaceSummary } from '../support/formatWorkspaceSummary'

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
}

export interface ApplyCliCommandResult {
  session: ConversationSession
  statusLine: string
  shouldExit?: boolean
}

export interface GitRunner {
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

      case 'tools': {
        addCommandInput()
        const toolsText = [
          this.i18n.t('cli.tools.title'),
          ...command.bootstrap.toolCatalog.map((tool) => formatToolLine(tool, this.i18n)),
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
          const [diffCheck, diffStat] = await Promise.all([
            gitRunner.diffCheck(command.bootstrap.workspace.rootPath),
            gitRunner.diffStat(command.bootstrap.workspace.rootPath),
          ])

          const trimmedCheck = diffCheck.trim()
          const trimmedStat = diffStat.trim()

          const reviewText = trimmedCheck
            ? [
                this.i18n.t('cli.review.title'),
                '',
                this.i18n.t('cli.review.findings'),
                trimmedCheck,
                '',
                this.i18n.t('cli.review.changedFiles'),
                trimmedStat || this.i18n.t('workspace.none'),
              ].join('\n')
            : trimmedStat
              ? [
                  this.i18n.t('cli.review.title'),
                  '',
                  this.i18n.t('cli.review.clean'),
                  '',
                  this.i18n.t('cli.review.changedFiles'),
                  trimmedStat,
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
              ? [this.i18n.t('cli.diff.title'), '', trimLargeBlock(trimmedPatch)].join('\n')
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
          const value = rawArgs.replace(/^set\s+\S+\s*/i, '').trim()

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

          await this.modelConfigStore.save(nextConfigResult.config)
          const activeConfig = command.configUpdater?.applyModelConfig(nextConfigResult.config)
          const finalConfig = activeConfig ?? nextConfigResult.config

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
                '#  *  id        mode    msgs  updated      title',
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
        const target = resolveResumeTarget(args.join(' '), session.id, sessions)

        if (!target) {
          addCommandInput()
          addCommandOutput(this.i18n.t('cli.resume.notFound'), {
            title: this.i18n.t('transcript.session'),
            tone: 'warning',
          })
          return persist(this.i18n.t('cli.resume.failedStatus'))
        }

        this.logger.info('Resumed session from local history', {
          previousSessionId: session.id,
          nextSessionId: target.id,
        })

        return {
          session: target,
          statusLine: this.i18n.t('cli.resume.status', {
            id: formatShortSessionId(target.id),
          }),
        }
      }

      case 'clear': {
        session.clearConversation(now)
        addCommandInput()
        addCommandOutput(this.i18n.t('cli.clear.output'), {
          title: this.i18n.t('transcript.conversation'),
          tone: 'success',
        })
        return persist(this.i18n.t('cli.clear.status'))
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
  return `- ${localizeToolName(tool, i18n)} [${tool.category}]: ${localizeToolDescription(tool, i18n)}`
}

function trimLargeBlock(content: string, maxLength = 12_000): string {
  if (content.length <= maxLength) {
    return content
  }

  return `${content.slice(0, maxLength)}\n\n... diff truncated ...`
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
  const marker = session.id === currentSessionId ? '*' : ' '
  const updatedAt = session.updatedAt.toISOString().replace('T', ' ').slice(5, 16)
  const messageCount = `${session.getMessages().length}m`

  return `${index + 1}. ${marker} [${formatShortSessionId(session.id)}]  ${session.mode.padEnd(5, ' ')}  ${messageCount.padStart(4, ' ')}  ${updatedAt}  ${session.title}`
}

function resolveResumeTarget(
  rawQuery: string,
  currentSessionId: string,
  sessions: ConversationSession[],
): ConversationSession | null {
  const query = rawQuery.trim()

  if (!query) {
    return sessions.find((item) => item.id !== currentSessionId) ?? null
  }

  const byIndex = Number.parseInt(query, 10)
  if (!Number.isNaN(byIndex) && byIndex >= 1 && byIndex <= sessions.length) {
    return sessions[byIndex - 1] ?? null
  }

  return sessions.find((item) => item.id.startsWith(query)) ?? null
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
