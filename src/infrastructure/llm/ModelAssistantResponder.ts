import type { AssistantPromptSet } from '../../application/dto/AssistantPromptSet'
import type { AppI18n } from '../../application/i18n/AppI18n'
import type {
  AssistantApprovalCommand,
  AssistantReply,
  AssistantResponderCommand,
  AssistantResponderPort,
  AssistantStreamChunk,
  PendingToolApproval,
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
import type { ToolDescriptor } from '../../domain/tooling/entities/ToolDescriptor'
import type { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'

interface ApprovalDecision {
  required: boolean
  reason?: string
}

interface PendingApprovalState {
  approval: PendingToolApproval
  activeMessages: ModelMessage[]
  responseText: string
  workspace: WorkspaceContext
  nextTurn: number
}

export class ModelAssistantResponder implements AssistantResponderPort {
  private readonly maxAgentTurns = 4
  private readonly pendingApprovals = new Map<string, PendingApprovalState>()

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
    this.pendingApprovals.delete(command.session.id)

    const messages = this.buildMessages(command)

    this.logger.debug('Sending request to model gateway', {
      model: this.config.model,
      provider: this.config.provider,
      messageCount: messages.length,
      mode: command.session.mode,
    })

    try {
      yield* this.runConversationLoop({
        sessionId: command.session.id,
        activeMessages: [...messages],
        workspace: command.workspace,
        toolCatalog: command.toolCatalog,
        startTurn: 0,
        abortSignal: command.abortSignal,
      })
    } catch (error) {
      this.logger.error('Model gateway error', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async *streamApprovalDecision(
    command: AssistantApprovalCommand,
  ): AsyncIterable<AssistantStreamChunk> {
    const pendingState = this.pendingApprovals.get(command.sessionId)

    if (!pendingState) {
      throw new Error(
        this.i18n.locale === 'en'
          ? 'No pending tool approval was found for this session.'
          : '当前会话没有待处理的工具审批请求。',
      )
    }

    this.pendingApprovals.delete(command.sessionId)

    if (command.approved) {
      const toolResult = await this.toolExecutor.execute({
        toolId: pendingState.approval.toolId,
        input: pendingState.approval.input,
        workspace: pendingState.workspace,
      })

      this.logger.info('Executed assistant tool call after approval', {
        toolId: toolResult.toolId,
        ok: toolResult.ok,
      })

      yield {
        kind: 'transcript',
        delta: '',
        transcript: createCliCommandOutputContent(
          [
            this.i18n.locale === 'en'
              ? 'Tool completed successfully after approval.'
              : '工具已在审批通过后执行完成。',
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

      yield* this.runConversationLoop({
        sessionId: command.sessionId,
        activeMessages: this.appendToolFollowupMessages(
          pendingState.activeMessages,
          pendingState.responseText,
          toolResult.toolId,
          toolResult.ok ? 'ok' : 'failed',
          toolResult.content,
        ),
        workspace: pendingState.workspace,
        toolCatalog: this.cliConfig.getToolCatalog(),
        startTurn: pendingState.nextTurn,
        abortSignal: command.abortSignal,
      })
      return
    }

    yield {
      kind: 'transcript',
      delta: '',
      transcript: createCliCommandOutputContent(
        this.i18n.locale === 'en'
          ? 'User denied this tool request. The assistant must continue without running it.'
          : '用户拒绝了这次工具请求，助手需要在不执行工具的情况下继续。',
        {
          title: `${this.i18n.t('transcript.tools')} · ${pendingState.approval.toolId}`,
          tone: 'warning',
        },
      ),
      done: false,
    }

    yield* this.runConversationLoop({
      sessionId: command.sessionId,
      activeMessages: [
        ...pendingState.activeMessages,
        { role: 'assistant', content: pendingState.responseText },
        {
          role: 'user',
          content: [
            `Tool request for ${pendingState.approval.toolId} was denied by the user.`,
            'Continue without executing it.',
            'If another tool is required, emit one tool call only.',
          ].join('\n'),
        },
      ],
      workspace: pendingState.workspace,
      toolCatalog: this.cliConfig.getToolCatalog(),
      startTurn: pendingState.nextTurn,
      abortSignal: command.abortSignal,
    })
  }

  private async *runConversationLoop(params: {
    sessionId: string
    activeMessages: ModelMessage[]
    workspace: WorkspaceContext
    toolCatalog: ToolDescriptor[]
    startTurn: number
    abortSignal?: AbortSignal
  }): AsyncIterable<AssistantStreamChunk> {
    let activeMessages = [...params.activeMessages]

    for (let turn = params.startTurn; turn < this.maxAgentTurns; turn += 1) {
      const responseText = await this.collectResponseText(activeMessages, params.abortSignal)
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

      const approvalDecision = this.resolveApprovalDecision(
        toolCall.name,
        toolCall.input,
        params.toolCatalog,
      )

      if (approvalDecision.required) {
        const descriptor = params.toolCatalog.find((tool) => tool.id === toolCall.name)
        const approvalReason =
          approvalDecision.reason ??
          (this.i18n.locale === 'en'
            ? 'This tool call needs user approval before execution.'
            : '该工具调用需要先获得用户审批后才能执行。')

        const approval: PendingToolApproval = {
          id: `${params.sessionId}:${turn}:${toolCall.name}`,
          toolId: toolCall.name,
          toolName: descriptor?.name ?? toolCall.name,
          input: toolCall.input,
          reason: approvalReason,
        }

        this.pendingApprovals.set(params.sessionId, {
          approval,
          activeMessages,
          responseText,
          workspace: params.workspace,
          nextTurn: turn + 1,
        })

        this.logger.info('Blocked assistant tool call pending approval', {
          toolId: toolCall.name,
          reason: approvalReason,
        })

        yield {
          kind: 'transcript',
          delta: '',
          transcript: createCliCommandOutputContent(approvalReason, {
            title: `${this.i18n.t('transcript.tools')} · ${toolCall.name}`,
            tone: 'warning',
          }),
          done: false,
        }

        yield {
          kind: 'approval',
          delta: '',
          approval,
          done: true,
        }
        return
      }

      const toolResult = await this.toolExecutor.execute({
        toolId: toolCall.name,
        input: toolCall.input,
        workspace: params.workspace,
      })

      this.logger.info('Executed assistant tool call', {
        toolId: toolResult.toolId,
        ok: toolResult.ok,
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

      activeMessages = this.appendToolFollowupMessages(
        activeMessages,
        responseText,
        toolResult.toolId,
        toolResult.ok ? 'ok' : 'failed',
        toolResult.content,
      )
    }

    yield {
      kind: 'text',
      delta:
        this.i18n.locale === 'en'
          ? 'I reached the current tool-execution turn limit. Please refine the request or continue.'
          : '已达到当前工具执行轮次上限，请继续细化需求或再次发起执行。',
      done: true,
    }
  }

  private appendToolFollowupMessages(
    activeMessages: ModelMessage[],
    responseText: string,
    toolId: string,
    status: 'ok' | 'failed',
    content: string,
  ): ModelMessage[] {
    return [
      ...activeMessages,
      { role: 'assistant', content: responseText },
      {
        role: 'user',
        content: [
          `Tool result for ${toolId}:`,
          `status: ${status}`,
          content,
          '',
          'Continue the task. If another tool is required, emit one tool call only.',
        ].join('\n'),
      },
    ]
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
      'Safe read-only tools can run directly. Careful and dangerous actions may be paused for approval before execution.',
      'For file-ops, use JSON like {"action":"read","path":"src/main.tsx"}, {"action":"list","path":"src"}, {"action":"write","path":"src/example.ts","content":"...","allowWrite":true}, or {"action":"update","path":"src/example.ts","oldText":"before","newText":"after","allowWrite":true}.',
      'For glob-search, use JSON like {"pattern":"src/**/*.ts","limit":20} or {"pattern":"*.test.ts","path":"src"}.',
      'For shell-runner, use JSON like {"argv":["rg","query","src"]}.',
      'For web-fetch, use JSON like {"url":"https://example.com/docs"}.',
      'For web-search, use JSON like {"query":"Bun Ink CLI patterns","limit":5} or {"query":"OpenAI API docs","domain":"platform.openai.com"}.',
      'After the tool result is returned, continue the task normally.',
      'Available executable tools in this build: workspace-read, search-index, glob-search, file-ops, shell-runner, web-fetch, web-search.',
    ].join('\n')
  }

  private resolveApprovalDecision(
    toolId: string,
    input: string,
    toolCatalog: ToolDescriptor[],
  ): ApprovalDecision {
    const descriptor = toolCatalog.find((tool) => tool.id === toolId)

    if (descriptor?.riskLevel === 'dangerous') {
      return {
        required: true,
        reason:
          this.i18n.locale === 'en'
            ? `${descriptor.name} is marked as dangerous and requires explicit approval before execution.`
            : `${descriptor.name} 被标记为 dangerous，需要在执行前获得明确审批。`,
      }
    }

    if (toolId !== 'file-ops') {
      return { required: false }
    }

    let action = 'read'
    try {
      const parsed = JSON.parse(input) as { action?: unknown }
      if (typeof parsed.action === 'string' && parsed.action.trim()) {
        action = parsed.action.trim().toLowerCase()
      }
    } catch {
      return { required: false }
    }

    if (action === 'write' || action === 'update' || action === 'patch') {
      return {
        required: true,
        reason:
          this.i18n.locale === 'en'
            ? `file-ops action "${action}" changes workspace files and requires approval before execution.`
            : `file-ops 的 "${action}" 操作会修改工作区文件，需要在执行前审批。`,
      }
    }

    return { required: false }
  }

  private truncateForTranscript(content: string, maxLength: number): string {
    const normalized = content.trim()
    if (normalized.length <= maxLength) {
      return normalized
    }

    return `${normalized.slice(0, maxLength)}\n\n[truncated]`
  }
}
