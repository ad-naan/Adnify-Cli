import type { ConversationSession } from '../../domain/session/aggregates/ConversationSession'
import type { AppI18n } from '../i18n/AppI18n'
import type {
  AssistantResponderPort,
  PendingToolApproval,
} from '../ports/AssistantResponderPort'
import type { CliConfigPort } from '../ports/CliConfigPort'
import type { ClockPort } from '../ports/ClockPort'
import type { IdGeneratorPort } from '../ports/IdGeneratorPort'
import type { LoggerPort } from '../ports/LoggerPort'
import type { SessionRepositoryPort } from '../ports/SessionRepositoryPort'
import type { WorkspaceContextPort } from '../ports/WorkspaceContextPort'
import type { ToolProgressEvent, ToolTodoItem } from '../ports/ToolExecutorPort'
import type { AssistantMode } from '../../domain/assistant/value-objects/AssistantMode'
import { createSessionTitle } from '../support/createSessionTitle'

export interface SubmitPromptCommand {
  sessionId: string
  prompt: string
  abortSignal?: AbortSignal
  memoryBlock?: string
}

export interface SubmitApprovalDecisionCommand {
  sessionId: string
  approved: boolean
  abortSignal?: AbortSignal
}

export interface SubmitPromptResult {
  session: ConversationSession
  statusLine: string
  pendingApproval?: PendingToolApproval | null
}

export interface StreamingCallbacks {
  /** Called as soon as the user message has been accepted, before workspace/API work starts. */
  onUserMessage?: (session: ConversationSession) => void
  onChunk: (delta: string) => void
  onTranscript?: (content: string) => void
  /** Promotes text emitted before a tool to a stable assistant segment. */
  onAssistantSegment?: (content: string) => void
  onTaskProgress?: (progress: NonNullable<ToolProgressEvent['task']>) => void
  /** Full checklist snapshot from todo-write, rendered in the persistent todo dock. */
  onTodoUpdate?: (todos: ToolTodoItem[]) => void
  onRetry?: (retry: { attempt: number; maxRetries: number; delayMs: number; reason: string }) => void
  onApproval?: (approval: PendingToolApproval) => void
  onWorkflowPhase?: (phase: 'plan' | 'execute') => void
  onAssistantMode?: (mode: AssistantMode) => void
  onDone: (fullContent: string) => void
  onError: (error: Error) => void
}

export class SubmitPromptUseCase {
  constructor(
    private readonly sessionRepository: SessionRepositoryPort,
    private readonly workspaceContextPort: WorkspaceContextPort,
    private assistantResponder: AssistantResponderPort,
    private readonly config: CliConfigPort,
    private readonly idGenerator: IdGeneratorPort,
    private readonly clock: ClockPort,
    private readonly logger: LoggerPort,
    private readonly i18n: AppI18n,
  ) {}

  updateResponder(responder: AssistantResponderPort): void {
    this.assistantResponder = responder
  }

  async execute(command: SubmitPromptCommand): Promise<SubmitPromptResult> {
    const session = await this.getSession(command.sessionId)
    const prompt = command.prompt.trim()

    if (!prompt) {
      return { session, statusLine: this.i18n.t('status.inputIgnored') }
    }

    const now = this.clock.now()
    this.updateSessionTitleIfNeeded(session, prompt, now)
    session.addUserMessage(this.idGenerator.next(), now, prompt)

    const workspace = await this.workspaceContextPort.inspect(session.workspacePath)
    const reply = await this.assistantResponder.generateReply({
      prompt,
      session,
      workspace,
      toolCatalog: this.config.getToolCatalog(),
    })

    session.addAssistantMessage(this.idGenerator.next(), this.clock.now(), reply.content)
    await this.sessionRepository.save(session)

    this.logger.info('Prompt submitted', {
      sessionId: session.id,
      mode: session.mode,
      promptLength: prompt.length,
    })

    return { session, statusLine: this.i18n.t('status.responseCompleted') }
  }

  async executeStreaming(
    command: SubmitPromptCommand,
    callbacks: StreamingCallbacks,
  ): Promise<SubmitPromptResult> {
    const session = await this.getSession(command.sessionId)
    const prompt = command.prompt.trim()

    if (!prompt) {
      return { session, statusLine: this.i18n.t('status.inputIgnored') }
    }

    const now = this.clock.now()
    this.updateSessionTitleIfNeeded(session, prompt, now)
    session.addUserMessage(this.idGenerator.next(), now, prompt)
    callbacks.onUserMessage?.(session.clone())

    const workspace = await this.workspaceContextPort.inspect(session.workspacePath)
    const memoryBlock = command.memoryBlock
    return this.consumeAssistantStream(
      session,
      prompt.length,
      this.assistantResponder.streamReply({
        prompt,
        session,
        workspace,
        toolCatalog: this.config.getToolCatalog(),
        abortSignal: command.abortSignal,
        memoryBlock,
      }),
      callbacks,
      command.abortSignal,
    )
  }

  async executeApprovalDecision(
    command: SubmitApprovalDecisionCommand,
    callbacks: StreamingCallbacks,
  ): Promise<SubmitPromptResult> {
    const session = await this.getSession(command.sessionId)

    return this.consumeAssistantStream(
      session,
      0,
      this.assistantResponder.streamApprovalDecision({
        sessionId: command.sessionId,
        approved: command.approved,
        abortSignal: command.abortSignal,
      }),
      callbacks,
      command.abortSignal,
    )
  }

  private async consumeAssistantStream(
    session: ConversationSession,
    promptLength: number,
    stream: AsyncIterable<{
      delta: string
      transcript?: string
      approval?: PendingToolApproval
      workflowPhase?: 'plan' | 'execute'
      assistantMode?: AssistantMode
      taskProgress?: ToolProgressEvent['task']
      todos?: ToolTodoItem[]
      retry?: { attempt: number; maxRetries: number; delayMs: number; reason: string }
    }>,
    callbacks: StreamingCallbacks,
    abortSignal?: AbortSignal,
  ): Promise<SubmitPromptResult> {
    const chunks: string[] = []
    let segmentChunks: string[] = []
    let pendingApproval: PendingToolApproval | null = null

    const commitAssistantSegment = (interrupted = false) => {
      const content = segmentChunks.join('')
      segmentChunks = []
      if (!content) return

      const persistedContent = interrupted ? `${content}\n\n[Response interrupted]` : content
      session.addAssistantMessage(this.idGenerator.next(), this.clock.now(), persistedContent)
      callbacks.onAssistantSegment?.(persistedContent)
    }

    try {
      for await (const chunk of stream) {
        if (chunk.workflowPhase) {
          callbacks.onWorkflowPhase?.(chunk.workflowPhase)
        }

        if (chunk.assistantMode) {
          callbacks.onAssistantMode?.(chunk.assistantMode)
        }

        if (chunk.taskProgress) {
          callbacks.onTaskProgress?.(chunk.taskProgress)
        }

        if (chunk.todos) {
          callbacks.onTodoUpdate?.(chunk.todos)
        }

        if (chunk.retry) {
          callbacks.onRetry?.(chunk.retry)
        }

        if (chunk.transcript) {
          // Text before a tool belongs before that tool in both the live UI and persisted history.
          commitAssistantSegment()
          session.addSystemMessage(this.idGenerator.next(), this.clock.now(), chunk.transcript)
          callbacks.onTranscript?.(chunk.transcript)
        }

        if (chunk.approval) {
          pendingApproval = chunk.approval
          callbacks.onApproval?.(chunk.approval)
        }

        if (chunk.delta) {
          chunks.push(chunk.delta)
          segmentChunks.push(chunk.delta)
          callbacks.onChunk(chunk.delta)
        }
      }

      const fullContent = chunks.join('')

      if (pendingApproval) {
        await this.sessionRepository.save(session)
        return {
          session,
          statusLine: this.i18n.t('status.approvalRequired'),
          pendingApproval,
        }
      }

      commitAssistantSegment()
      await this.sessionRepository.save(session)

      callbacks.onDone(fullContent)

      this.logger.info('Streaming prompt completed', {
        sessionId: session.id,
        mode: session.mode,
        promptLength,
        replyLength: fullContent.length,
      })

      return { session, statusLine: this.i18n.t('status.responseCompleted') }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      callbacks.onError(err)

      if (segmentChunks.length > 0) {
        commitAssistantSegment(true)
        await this.sessionRepository.save(session)
      }

      this.logger.error('Streaming prompt failed', {
        sessionId: session.id,
        error: err.message,
      })

      return {
        session,
        statusLine: abortSignal?.aborted
          ? this.i18n.t('status.executionAborted')
          : this.i18n.t('status.responseFailed', { message: err.message }),
      }
    }
  }

  private async getSession(sessionId: string): Promise<ConversationSession> {
    const session = await this.sessionRepository.findById(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return session
  }

  private updateSessionTitleIfNeeded(
    session: ConversationSession,
    prompt: string,
    changedAt: Date,
  ): void {
    if (session.getMessages().length > 0) {
      return
    }

    if (session.title !== this.i18n.t('session.defaultTitle')) {
      return
    }

    session.renameTitle(createSessionTitle(prompt), changedAt)
  }
}
