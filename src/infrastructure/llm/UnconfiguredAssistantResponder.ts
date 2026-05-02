import type { AppI18n } from '../../application/i18n/AppI18n'
import type {
  AssistantApprovalCommand,
  AssistantReply,
  AssistantResponderCommand,
  AssistantResponderPort,
  AssistantStreamChunk,
} from '../../application/ports/AssistantResponderPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'

export class UnconfiguredAssistantResponder implements AssistantResponderPort {
  constructor(
    private readonly logger: LoggerPort,
    private readonly i18n: AppI18n,
  ) {}

  async generateReply(command: AssistantResponderCommand): Promise<AssistantReply> {
    this.logger.info('Rejected assistant reply because model configuration is missing', {
      mode: command.session.mode,
      workspace: command.workspace.rootPath,
    })

    return {
      content: this.buildContent(),
    }
  }

  async *streamReply(command: AssistantResponderCommand): AsyncIterable<AssistantStreamChunk> {
    const content = (await this.generateReply(command)).content
    yield { kind: 'text', delta: content, done: false }
    yield { kind: 'text', delta: '', done: true }
  }

  async *streamApprovalDecision(
    _command: AssistantApprovalCommand,
  ): AsyncIterable<AssistantStreamChunk> {
    yield { kind: 'text', delta: '', done: true }
  }

  private buildContent(): string {
    return [
      this.i18n.t('status.notConfigured'),
      '',
      this.i18n.t('unconfigured.replyHelpTitle'),
      this.i18n.t('unconfigured.replyHelpConfig'),
      this.i18n.t('unconfigured.replyHelpInit'),
    ].join('\n')
  }
}
