/** 模型发起的一次结构化工具调用。 */
export interface ModelToolCall {
  toolCallId: string
  toolName: string
  /**
   * 序列化后的参数。
   * 保持 string 而不是对象：`ToolExecutorPort.input` 本来就是 string，
   * 每个 handler 自己 parseJsonObject。在网关边界 stringify 一次，
   * 比改动全部 7 个 handler 的解析入口安全得多。
   */
  input: string
}

/**
 * Provider-neutral model history.
 * Native tool calls/results retain their ids so gateways can emit standard tool-role messages.
 */
export type ModelMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ModelToolCall[] }
  | {
      role: 'tool'
      content: string
      toolCallId: string
      toolName: string
      ok: boolean
    }

/** 暴露给模型的工具定义，`inputSchema` 为标准 JSON Schema。 */
export interface ModelToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ModelRequest {
  messages: ModelMessage[]
  model: string
  temperature?: number
  maxTokens?: number
  abortSignal?: AbortSignal
  /** 提供时走 provider 原生 function calling；省略则模型只能输出纯文本。 */
  tools?: ModelToolDefinition[]
}

export interface ModelStreamChunk {
  delta: string
  /** A retry scheduled before any response content was emitted. */
  retry?: {
    attempt: number
    maxRetries: number
    delayMs: number
    reason: string
  }
  /** 原生工具调用。走文本解析回退路径时该字段始终为空。 */
  toolCall?: ModelToolCall
  finishReason?: 'stop' | 'length' | 'error'
  /**
   * 本轮是否真的用上了原生工具通道。
   * 调用方靠它决定要不要启用 XML 文本解析回退 —— 指向任意端点的
   * openai-compatible 有相当一部分不支持 tools 参数。
   */
  usedNativeTools?: boolean
}

/**
 * 模型网关端口。
 * 负责与底层 LLM API 通信，只关心"消息进、文本与工具调用出"，不关心业务编排。
 */
export interface ModelGatewayPort {
  streamChat(request: ModelRequest): AsyncIterable<ModelStreamChunk>
}
