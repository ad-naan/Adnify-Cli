import type { AssistantPromptSet } from '../../application/dto/AssistantPromptSet'
import type { AppI18n } from '../../application/i18n/AppI18n'
import type {
  AssistantReply,
  AssistantResponderCommand,
  AssistantResponderPort,
  AssistantStreamChunk,
} from '../../application/ports/AssistantResponderPort'
import type { CliConfigPort } from '../../application/ports/CliConfigPort'
import type { LoggerPort } from '../../application/ports/LoggerPort'
import type { ModelGatewayPort, ModelMessage } from '../../application/ports/ModelGatewayPort'
import type { ToolExecutorPort } from '../../application/ports/ToolExecutorPort'
import {
  createCliCommandOutputContent,
  createCliNoticeContent,
} from '../../application/support/CliTranscriptMarkup'
import { parseToolCallMarkup } from '../../application/support/ToolCallMarkup'
import type { ModelConfig } from '../../domain/assistant/value-objects/ModelConfig'
import type { ConversationSession } from '../../domain/session/aggregates/ConversationSession'
import type { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'

export class ModelAssistantResponder implements AssistantResponderPort {
  private readonly maxAgentTurns = 4

  constructor(
    private gateway: ModelGatewayPort,
    private config: ModelConfig,
    private readonly cliConfig: CliConfigPort,
    private readonly toolExecutor: ToolExecutorPort,
    private readonly logger: LoggerPort,
    private readonly i18n: AppI18n,
  ) {}

  updateGateway(gateway: ModelGatewayPort, config: ModelConfig): void {
    this.gateway = gateway
    this.config = config
  }

  async generateReply(command: AssistantResponderCommand): Promise<AssistantReply> {
    const chunks: string[] = []
    for await (const chunk of this.streamReply(command)) {
      chunks.push(chunk.delta)
    }

    return { content: chunks.join('') }
  }

  async *streamReply(command: AssistantResponderCommand): AsyncIterable<AssistantStreamChunk> {
    const messages = this.buildMessages(command)

    this.logger.debug('Sending request to model gateway', {
      model: this.config.model,
      provider: this.config.provider,
      messageCount: messages.length,
      mode: command.session.mode,
    })

    try {
      let activeMessages = [...messages]

      for (let turn = 0; turn < this.maxAgentTurns; turn += 1) {
        const responseText = await this.collectResponseText(activeMessages, command.abortSignal)
        const toolCall = parseToolCallMarkup(responseText)

        if (!toolCall) {
          yield {
            kind: 'text',
            delta: responseText,
            done: true,
          }
          return
        }

        yield {
          kind: 'transcript',
          delta: '',
          transcript: createCliNoticeContent(
            [
              this.i18n.locale === 'en'
                ? 'Executing assistant tool request.'
                : '正在执行助手工具请求。',
              `tool: ${toolCall.name}`,
              `input: ${this.truncateForTranscript(toolCall.input, 400)}`,
            ].join('\n'),
            {
              title: `${this.i18n.t('transcript.tools')} · ${toolCall.name}`,
              tone: 'info',
            },
          ),
          done: false,
        }

        const toolResult = await this.toolExecutor.execute({
          toolId: toolCall.name,
          input: toolCall.input,
          workspace: command.workspace,
        })

        this.logger.info('Executed assistant tool call', {
          toolId: toolResult.toolId,
          ok: toolResult.ok,
          mode: command.session.mode,
        })

        yield {
          kind: 'transcript',
          delta: '',
          transcript: createCliCommandOutputContent(
            [
              toolResult.ok
                ? this.i18n.locale === 'en'
                  ? 'Tool completed successfully.'
                  : '工具执行成功完成。'
                : this.i18n.locale === 'en'
                  ? 'Tool execution failed.'
                  : '工具执行失败。',
              '',
              this.truncateForTranscript(toolResult.content, 1600),
            ].join('\n'),
            {
              title: `${this.i18n.t('transcript.tools')} · ${toolResult.toolId}`,
              tone: toolResult.ok ? 'success' : 'danger',
            },
          ),
          done: false,
        }

        activeMessages = [
          ...activeMessages,
          { role: 'assistant', content: responseText },
          {
            role: 'user',
            content: [
              `Tool result for ${toolResult.toolId}:`,
              toolResult.ok ? 'status: ok' : 'status: failed',
              toolResult.content,
              '',
              'Continue the task. If another tool is required, emit one tool call only.',
            ].join('\n'),
          },
        ]
      }

      yield {
        kind: 'text',
        delta:
          this.i18n.locale === 'en'
            ? 'I reached the current tool-execution turn limit. Please refine the request or continue.'
            : '已达到当前工具执行轮次上限，请继续细化需求或再次发起执行。',
        done: true,
      }
    } catch (error) {
      this.logger.error('Model gateway error', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async collectResponseText(
    messages: ModelMessage[],
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const chunks: string[] = []

    for await (const chunk of this.gateway.streamChat({
      messages,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      abortSignal,
    })) {
      chunks.push(chunk.delta)
    }

    return chunks.join('').trim()
  }

  private buildMessages(command: AssistantResponderCommand): ModelMessage[] {
    const systemPrompt = this.buildSystemPrompt(
      command.session,
      command.workspace,
      command.toolCatalog,
      this.cliConfig.getAssistantPromptSet(),
    )

    const messages: ModelMessage[] = [{ role: 'system', content: systemPrompt }]

    for (const message of command.session.getMessages()) {
      if (message.role === 'system') {
        continue
      }

      messages.push({ role: message.role, content: message.content })
    }

    if (!messages.some((message) => message.role === 'user' && message.content === command.prompt)) {
      messages.push({ role: 'user', content: command.prompt })
    }

    return messages
  }

  private buildSystemPrompt(
    session: ConversationSession,
    workspace: WorkspaceContext,
    toolCatalog: AssistantResponderCommand['toolCatalog'],
    promptSet: AssistantPromptSet,
  ): string {
    const modePrompt = promptSet.modes[session.mode]
    const toolBlock =
      toolCatalog
        .map((tool) => `- ${tool.name} [${tool.category}] (${tool.riskLevel}): ${tool.description}`)
        .join('\n') || this.i18n.t('modelPrompt.noTools')

    const workspaceBlock = [
      this.i18n.t('modelPrompt.currentMode', { mode: session.mode }),
      this.i18n.t('modelPrompt.workspaceRoot', { value: workspace.rootPath }),
      this.i18n.t('modelPrompt.packageManager', { value: workspace.packageManager }),
      this.i18n.t('modelPrompt.gitRepository', {
        value: this.i18n.t(workspace.isGitRepository ? 'common.yes' : 'common.no'),
      }),
      this.i18n.t('modelPrompt.topLevelEntries', {
        value: workspace.topLevelEntries.join(', ') || this.i18n.t('workspace.none'),
      }),
    ].join('\n')

    return [
      promptSet.core.trim(),
      '',
      this.i18n.t('modelPrompt.respondIn', {
        language: this.i18n.t('modelPrompt.language.self'),
      }),
      '',
      '## Mode Instructions',
      modePrompt.trim(),
      '',
      '## Runtime Workspace Context',
      workspaceBlock,
      '',
      '## Available Tool Definitions',
      toolBlock,
      '',
      '## Tool Calling Protocol',
      `When you need a tool, respond with exactly one ${'<adnify_tool_call name="tool-id">...</adnify_tool_call>'} block and nothing else.`,
      'The inner content must be valid JSON.',
      'For file-ops, use JSON like {"action":"read","path":"src/main.tsx"}, {"action":"list","path":"src"}, {"action":"write","path":"src/example.ts","content":"...","allowWrite":true}, or {"action":"update","path":"src/example.ts","oldText":"before","newText":"after","allowWrite":true}.',
      'For shell-runner, use JSON like {"argv":["rg","query","src"]}.',
      'Shell commands are restricted to a whitelist: rg, git status/diff/log/show/branch/rev-parse (no approval needed), plus bun test, bun run build/typecheck/test/lint, bunx tsc (approval required).',
      'Risky actions pause for user approval: file-ops write/update/patch, and the verification commands above. If a result says the user denied the action, do not retry the same call — explain your intent and propose a different approach.',
      'After the tool result is returned, continue the task normally.',
      'Available executable tools in this build: workspace-read, search-index, file-ops, shell-runner.',
    ].join('\n')
  }

  private truncateForTranscript(content: string, maxLength: number): string {
    const normalized = content.trim()
    if (normalized.length <= maxLength) {
      return normalized
    }

    return `${normalized.slice(0, maxLength)}\n\n[truncated]`
  }
}
