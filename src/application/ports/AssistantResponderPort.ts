import type { ConversationSession } from '../../domain/session/aggregates/ConversationSession'
import type { ToolDescriptor } from '../../domain/tooling/entities/ToolDescriptor'
import type { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'
import type { ToolProgressEvent, ToolTodoItem } from './ToolExecutorPort'
import type { AssistantMode } from '../../domain/assistant/value-objects/AssistantMode'

export interface AssistantReply {
  content: string
}

export interface PendingToolApproval {
  id: string
  toolId: string
  toolName: string
  input: string
  reason: string
}

export interface AssistantStreamChunk {
  kind?: 'text' | 'transcript' | 'approval' | 'task' | 'todo' | 'retry'
  delta: string
  transcript?: string
  approval?: PendingToolApproval
  workflowPhase?: 'plan' | 'execute'
  assistantMode?: AssistantMode
  taskProgress?: ToolProgressEvent['task']
  todos?: ToolTodoItem[]
  retry?: { attempt: number; maxRetries: number; delayMs: number; reason: string }
  done: boolean
}

export interface AssistantResponderCommand {
  prompt: string
  session: ConversationSession
  workspace: WorkspaceContext
  toolCatalog: ToolDescriptor[]
  abortSignal?: AbortSignal
  memoryBlock?: string
}

export interface AssistantApprovalCommand {
  sessionId: string
  approved: boolean
  abortSignal?: AbortSignal
}

export interface AssistantResponderPort {
  generateReply(command: AssistantResponderCommand): Promise<AssistantReply>
  streamReply(command: AssistantResponderCommand): AsyncIterable<AssistantStreamChunk>
  streamApprovalDecision(command: AssistantApprovalCommand): AsyncIterable<AssistantStreamChunk>
}
