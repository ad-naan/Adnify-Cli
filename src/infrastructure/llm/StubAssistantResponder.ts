import type { AppI18n } from '../../application/i18n/AppI18n'
import type {
  AssistantApprovalCommand,
  AssistantReply,
  AssistantResponderCommand,
  AssistantResponderPort,
  AssistantStreamChunk,
} from '../../application/ports/AssistantResponderPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'

/**
 * AI 响应桩。
 * 作用是先把交互链路打通，后续替换为真实模型实现时，应用层和领域层无需重写。
 */
export class StubAssistantResponder implements AssistantResponderPort {
  constructor(
    private readonly logger: LoggerPort,
    private readonly i18n: AppI18n,
  ) {}

  async generateReply(command: AssistantResponderCommand): Promise<AssistantReply> {
    return { content: this.buildReplyContent(command) }
  }

  async *streamReply(command: AssistantResponderCommand): AsyncIterable<AssistantStreamChunk> {
    this.logger.debug('Streaming stub assistant reply', {
      mode: command.session.mode,
      workspace: command.workspace.rootPath,
    })

    const content = this.buildReplyContent(command)
    const words = content.split(/(?<=\s)/)

    for (const word of words) {
      if (command.abortSignal?.aborted) {
        throw new Error('Request aborted')
      }
      await new Promise((resolve) => setTimeout(resolve, 30))
      if (command.abortSignal?.aborted) {
        throw new Error('Request aborted')
      }
      yield { kind: 'text', delta: word, done: false }
    }

    yield { kind: 'text', delta: '', done: true }
  }

  async *streamApprovalDecision(
    _command: AssistantApprovalCommand,
  ): AsyncIterable<AssistantStreamChunk> {
    yield { kind: 'text', delta: '', done: true }
  }

  private buildReplyContent(command: AssistantResponderCommand): string {
    this.logger.debug('Generating stub assistant reply', {
      mode: command.session.mode,
      workspace: command.workspace.rootPath,
    })

    const prompt = command.prompt.toLowerCase()
    const suggestions: string[] = []

    if (prompt.includes('ddd') || prompt.includes('架构') || prompt.includes('architecture')) {
      suggestions.push(this.i18n.t('stub.suggestion.architecture'))
    }

    if (prompt.includes('readme') || prompt.includes('文档')) {
      suggestions.push(this.i18n.t('stub.suggestion.readme'))
    }

    if (prompt.includes('工具') || prompt.includes('tool')) {
      suggestions.push(this.i18n.t('stub.suggestion.tools'))
    }

    if (suggestions.length === 0) {
      suggestions.push(this.i18n.t('stub.suggestion.default'))
    }

    return [
      this.i18n.t('stub.received', { prompt: command.prompt }),
      this.i18n.t('stub.currentMode', { mode: command.session.mode }),
      this.i18n.t('stub.packageManager', { value: command.workspace.packageManager }),
      this.i18n.t('stub.toolCount', { count: command.toolCatalog.length }),
      '',
      this.i18n.t('stub.suggestionsTitle'),
      ...suggestions.map((item) => `- ${item}`),
    ].join('\n')
  }
}
