import type { WorkspaceContext } from '../../domain/workspace/entities/WorkspaceContext'
import type { ConversationSession } from '../../domain/session/aggregates/ConversationSession'

/**
 * 执行途中的一条进度消息。
 *
 * 只有耗时长、内部又分多步的工具才会发（目前是 task 的子代理批次）。
 * 绝大多数工具跑得够快，从头到尾一个结果就够了。
 */
export interface ToolProgressEvent {
  toolId: string
  /** 给用户看的一行字，已经是成品文案，调用方直接上屏。 */
  message: string
  /** 子步骤失败并不代表整个工具失败 —— 批次里挂一个，其余照跑。 */
  ok?: boolean
}

export interface ToolExecutionRequest {
  toolId: string
  input: string
  workspace: WorkspaceContext
  /** Session that initiated the operation, persisted into recovery checkpoints when available. */
  sessionId?: string
  /** Live session aggregate, used only by host-owned runtime controls such as mode switching. */
  session?: ConversationSession
  /** Propagates user cancellation into long-running tools such as sub-agent batches. */
  abortSignal?: AbortSignal
  approvalGranted?: boolean
  /**
   * 执行中途的进度回调。
   *
   * 工具执行是「一次调用返回一个结果」的模型，中间没有向界面推送的通道；
   * 派 4 个子代理时界面会静默几十秒，看起来像卡死了。
   * 可选，不传就是原来的行为。
   */
  onProgress?: (event: ToolProgressEvent) => void
}

export interface ToolExecutionResult {
  toolId: string
  ok: boolean
  content: string
}

export interface ToolExecutorPort {
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>
}
